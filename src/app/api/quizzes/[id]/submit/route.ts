import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getCurrentUser } from "@/lib/get-session";
import { calculateQuizPoints, calculateXPLevel, getAccuracyFactor } from "@/lib/points";
import { Difficulty } from "@prisma/client";
import { notifyLevelUp } from "@/lib/notifications";
import { checkAndAwardAchievements } from "@/lib/achievements";
import { normalizeOption } from "@/lib/utils";
import { validateCsrfOrigin } from "@/lib/csrf";

// ── Anti-gaming constants (SRS §4.9.2) ───────────────────────────────────────
const MAX_SCORED_QUIZZES_PER_DAY = 20;
// Below this score → no points at all. Set above the 25% four-option guessing
// baseline so random clicking can't reliably clear it.
const MIN_SCORE_FOR_POINTS = 50;
// Only quizzes at/above this score contribute to the *redeemable* (prize)
// balance — so prizes reflect demonstrated mastery, not sheer quiz volume.
const QUALITY_SCORE_FOR_REWARDS = 60;
// Server-side floor: a legitimate answer needs at least this long to read +
// answer. Measured from Quiz.startedAt (un-fakeable by the client). Finishing
// faster than questionCount × this ⇒ points blocked.
const MIN_MS_PER_QUESTION = 3000;
// Re-answering a question the student has ALREADY mastered earns only this
// fraction of the points for the leaderboard (and nothing toward prizes) — so
// retaking the same quiz over and over can't be used to farm points.
const REVIEW_POINTS_FACTOR = 0.25;

interface SubmittedAnswer {
  questionId: string;
  studentAnswer: string;
  timeTakenMs: number;
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!validateCsrfOrigin(request)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { id: quizId } = await params;
    const body = await request.json();
    let { answers }: { answers: SubmittedAnswer[] } = body;

    if (!answers || !Array.isArray(answers)) {
      return NextResponse.json(
        { error: "Answers array is required" },
        { status: 400 }
      );
    }

    // Sanitize client-supplied timeTakenMs: clamp to [0, 30s] per answer
    const MAX_TIME_PER_QUESTION_MS = 30_000;
    answers = answers.map((a) => ({
      ...a,
      timeTakenMs: Math.max(0, Math.min(Number(a.timeTakenMs) || 0, MAX_TIME_PER_QUESTION_MS)),
    }));

    // Verify quiz belongs to user and is not completed
    const quiz = await db.quiz.findUnique({
      where: { id: quizId },
    });

    if (!quiz) {
      return NextResponse.json({ error: "Quiz not found" }, { status: 404 });
    }

    if (quiz.studentId !== user.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
    }

    if (quiz.completedAt) {
      return NextResponse.json(
        { error: "Quiz already submitted" },
        { status: 400 }
      );
    }

    // ── Anti-gaming: daily scored quiz cap (SRS §4.9.2) ──────────────────────
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const tomorrowStart = new Date(todayStart);
    tomorrowStart.setDate(tomorrowStart.getDate() + 1);

    const todayCompletedCount = await db.quiz.count({
      where: {
        studentId: user.id,
        completedAt: { gte: todayStart, lt: tomorrowStart },
      },
    });
    const exceedsDailyLimit = todayCompletedCount >= MAX_SCORED_QUIZZES_PER_DAY;

    // Fetch all questions for grading
    const questionIds = answers.map((a) => a.questionId);
    const questions = await db.question.findMany({
      where: { id: { in: questionIds } },
      select: {
        id: true,
        type: true,
        difficulty: true,
        correctAnswer: true,
        explanation: true,
        videoUrl: true,
        questionText: true,
        options: true,
        chapterId: true,
      },
    });

    const questionMap = new Map(questions.map((q) => [q.id, q]));

    // Grade each answer
    const gradedAnswers = answers.map((answer) => {
      const question = questionMap.get(answer.questionId);
      if (!question) {
        return {
          questionId: answer.questionId,
          studentAnswer: answer.studentAnswer,
          isCorrect: false,
          timeTakenMs: answer.timeTakenMs,
          difficulty: "MEDIUM" as Difficulty,
          correctAnswer: "",
          explanation: "",
          videoUrl: null as string | null,
          questionText: "",
          options: [] as unknown,
        };
      }

      const normalizedCorrect = String(question.correctAnswer || "").trim();
      const studentAns = String(answer.studentAnswer || "").trim();
      let isCorrect = false;

      if (question.type === "FILL_IN_BLANK") {
        const c = normalizedCorrect.toLowerCase().replace(/[.,!?;:]/g, "").trim();
        const s = studentAns.toLowerCase().replace(/[.,!?;:]/g, "").trim();
        if (s === c) {
          isCorrect = true;
        } else if (s.length >= 4 && (c.includes(s) || s.includes(c))) {
          isCorrect = true;
        }
      } else if (question.type === "MATCH_PAIRS") {
        const correctPairs = new Set(normalizedCorrect.split("|").filter(Boolean).map(p => p.trim()));
        const studentPairs = studentAns.split("|").filter(Boolean).map(p => p.trim());
        isCorrect = studentPairs.length === correctPairs.size &&
                    studentPairs.every(p => correctPairs.has(p));
      } else {
        isCorrect = studentAns === normalizedCorrect;
      }

      return {
        questionId: answer.questionId,
        studentAnswer: answer.studentAnswer,
        isCorrect,
        timeTakenMs: answer.timeTakenMs,
        difficulty: question.difficulty,
        correctAnswer: normalizedCorrect,
        explanation: question.explanation || "",
        videoUrl: question.videoUrl ?? null,
        questionText: question.questionText,
        options: (question.options as unknown[]).map(normalizeOption),
      };
    });

    // Calculate points (with speed bonus + streak bonus)
    const pointsInput = gradedAnswers.map((a) => ({
      isCorrect: a.isCorrect,
      difficulty: a.difficulty,
    }));
    const totalTimeTakenMs = answers.reduce((sum, a) => sum + (a.timeTakenMs ?? 0), 0);

    // Calculate streak before points (need it for streak bonus)
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const lastActive = user.lastActiveAt ? new Date(user.lastActiveAt) : null;
    const lastActiveDay = lastActive
      ? new Date(lastActive.setHours(0, 0, 0, 0))
      : null;

    let newStreak = 1;
    if (lastActiveDay) {
      const diffDays = Math.floor(
        (today.getTime() - lastActiveDay.getTime()) / (1000 * 60 * 60 * 24)
      );
      if (diffDays === 0) {
        newStreak = user.streakDays || 1;
      } else if (diffDays === 1) {
        newStreak = (user.streakDays || 0) + 1;
      } else {
        newStreak = 1;
      }
    }

    const correctCount = gradedAnswers.filter((a) => a.isCorrect).length;
    const score = Math.round((correctCount / gradedAnswers.length) * 100);

    // ── Anti-gaming: daily cap, accuracy floor, and an un-fakeable time gate ──
    // Elapsed is measured server-side from Quiz.startedAt, so a client can't
    // spoof it by lying about per-answer times.
    const elapsedMs = Date.now() - new Date(quiz.startedAt).getTime();
    const tooFast = elapsedMs < gradedAnswers.length * MIN_MS_PER_QUESTION;
    const pointsBlocked =
      exceedsDailyLimit || score < MIN_SCORE_FOR_POINTS || tooFast;

    const { total: rawPointsEarned, breakdown, speedBonus, streakBonus } =
      calculateQuizPoints(pointsInput, {
        totalTimeTakenMs,
        questionCount: gradedAnswers.length,
        streakDays: newStreak,
      });

    // ── Repeat/mastery weighting ────────────────────────────────────────────
    // Which of these questions has the student already answered correctly in a
    // previous completed quiz? Re-answering a known question is revision, not
    // new learning — it earns only a small "review" credit and never counts
    // toward the prize (redeemable) balance. This is what stops retaking the
    // same quiz from farming points once the answers are memorised.
    const priorCorrect = await db.quizAnswer.findMany({
      where: {
        questionId: { in: questionIds },
        isCorrect: true,
        quiz: { studentId: user.id, completedAt: { not: null } },
      },
      select: { questionId: true },
      distinct: ["questionId"],
    });
    const masteredBefore = new Set(priorCorrect.map((a) => a.questionId));

    // Per-answer review weight: new-correct = full, repeat-correct = review, wrong = 0.
    const reviewWeight = gradedAnswers.map((a) =>
      a.isCorrect ? (masteredBefore.has(a.questionId) ? REVIEW_POINTS_FACTOR : 1) : 0,
    );
    const weightedBaseArr = breakdown.map((b, i) => (b ?? 0) * reviewWeight[i]);
    const weightedBase = weightedBaseArr.reduce((s, n) => s + n, 0);
    const sumBreakdown = breakdown.reduce((s, n) => s + (n ?? 0), 0);
    // Perfect + speed bonuses are performance bonuses → scaled by how much of the
    // quiz was genuinely new. The daily login-streak bonus is not (it rewards
    // showing up, not the quiz content).
    const performanceBonuses = rawPointsEarned - sumBreakdown - streakBonus;
    const newCorrectCount = gradedAnswers.filter(
      (a) => a.isCorrect && !masteredBefore.has(a.questionId),
    ).length;
    const noveltyFactor =
      gradedAnswers.length > 0 ? newCorrectCount / gradedAnswers.length : 0;
    // Base points from newly-mastered questions only — the sole source of prize points.
    const newBase = breakdown.reduce(
      (s, b, i) =>
        s + (gradedAnswers[i].isCorrect && !masteredBefore.has(gradedAnswers[i].questionId) ? (b ?? 0) : 0),
      0,
    );

    // Scale points by accuracy (60% → 0.6×, 100% → 1.0×) so a marginal pass
    // earns proportionally less. Zeroed entirely when an anti-gaming rule fires.
    const accuracyFactor = pointsBlocked
      ? 0
      : getAccuracyFactor(score, MIN_SCORE_FOR_POINTS);

    // Leaderboard/XP points: review-weighted base + novelty-scaled performance
    // bonuses + login-streak bonus, all scaled by accuracy.
    const totalPointsEarned = Math.round(
      (weightedBase + performanceBonuses * noveltyFactor + streakBonus) * accuracyFactor,
    );
    const effectiveSpeedBonus = Math.round(speedBonus * noveltyFactor * accuracyFactor);
    const effectiveStreakBonus = Math.round(streakBonus * accuracyFactor);

    // Prize-eligible points: only NEW mastery on quality quizzes contributes.
    // A fully fresh quiz earns close to its full value here; a pure retake earns
    // zero (newBase and noveltyFactor are both 0). The login-streak bonus is
    // excluded — prizes come from mastery, not from showing up.
    const redeemableEarned =
      !pointsBlocked && score >= QUALITY_SCORE_FOR_REWARDS
        ? Math.round((newBase + performanceBonuses * noveltyFactor) * accuracyFactor)
        : 0;

    const repeatCount = gradedAnswers.filter((a) => masteredBefore.has(a.questionId)).length;
    const answerPoints = weightedBaseArr.map((b) => Math.round(b * accuracyFactor));

    // Save quiz answers
    await db.quizAnswer.createMany({
      data: gradedAnswers.map((a, i) => ({
        quizId,
        questionId: a.questionId,
        studentAnswer: a.studentAnswer,
        isCorrect: a.isCorrect,
        timeTakenMs: a.timeTakenMs,
        pointsEarned: answerPoints[i] ?? 0,
      })),
    });

    // Update quiz record
    await db.quiz.update({
      where: { id: quizId },
      data: {
        score,
        correctAnswers: correctCount,
        totalPointsEarned,
        completedAt: new Date(),
      },
    });

    // If it's a Daily Challenge, award extra points only for 60%+ performance
    let challengePoints = 0;
    const quizAny = quiz as any;
    if (!pointsBlocked && quizAny.isDailyChallenge && correctCount >= 3) {
      const { today: dStart, tomorrow } = (() => {
        const d = new Date();
        d.setHours(0, 0, 0, 0);
        const next = new Date(d);
        next.setDate(next.getDate() + 1);
        return { today: d, tomorrow: next };
      })();

      const existingDone = await db.pointLedger.findFirst({
        where: {
          userId: user.id,
          actionType: "DAILY_CHALLENGE",
          createdAt: { gte: dStart, lt: tomorrow },
        },
      });

      if (!existingDone) {
        challengePoints = 50;
        await db.pointLedger.create({
          data: {
            userId: user.id,
            actionType: "DAILY_CHALLENGE",
            points: challengePoints,
            quizId,
            description: "Daily challenge performance bonus",
          },
        });
        await db.user.update({
          where: { id: user.id },
          data: { totalPoints: { increment: challengePoints } },
        });
      }
    }

    // Create point ledger entry for quiz completion
    if (totalPointsEarned > 0) {
      await db.pointLedger.create({
        data: {
          userId: user.id,
          actionType: "QUIZ_COMPLETE",
          points: totalPointsEarned,
          quizId,
          description: `Quiz completed: ${correctCount}/${gradedAnswers.length} correct`,
        },
      });
    }

    // Credit 7-day streak bonus to ledger (only once per day when streak hits 7+)
    // SRS §4.7.1: "7-Day Login Streak +100 — Resets on miss"
    if (!pointsBlocked && effectiveStreakBonus > 0) {
      // Only credit once per day (check if already credited today)
      const streakBonusToday = await db.pointLedger.findFirst({
        where: {
          userId: user.id,
          actionType: "STREAK_BONUS",
          createdAt: { gte: todayStart, lt: tomorrowStart },
        },
      });
      if (!streakBonusToday) {
        await db.pointLedger.create({
          data: {
            userId: user.id,
            actionType: "STREAK_BONUS",
            points: effectiveStreakBonus,
            quizId,
            description: `${newStreak}-day login streak bonus`,
          },
        });
      }
    }

    // Update user total points and XP level
    const oldTotal = user.totalPoints;

    const updatedUser = await db.user.update({
      where: { id: user.id },
      data: {
        totalPoints: { increment: totalPointsEarned },
        redeemablePoints: { increment: redeemableEarned },
        lastActiveAt: new Date(),
      },
    });

    const newXPLevel = calculateXPLevel(updatedUser.totalPoints);
    if (newXPLevel !== updatedUser.xpLevel) {
      await db.user.update({
        where: { id: user.id },
        data: { xpLevel: newXPLevel },
      });
    }

    // Update streak
    await db.user.update({
      where: { id: user.id },
      data: { streakDays: newStreak },
    });

    // Achievement counts
    const totalQuizzesDone = await db.quiz.count({
      where: { studentId: user.id, completedAt: { not: null } },
    });

    const firstQuestionDiff = gradedAnswers[0]
      ? questionMap.get(gradedAnswers[0].questionId)?.difficulty
      : undefined;

    const newTotal = oldTotal + totalPointsEarned;

    // Get chapter info for retry and achievement checks
    const firstAnswer = gradedAnswers[0];
    const firstQuestion = firstAnswer ? questionMap.get(firstAnswer.questionId) : null;
    const retryChapterId = firstQuestion?.chapterId ?? null;
    const retryDifficulty = firstQuestion?.difficulty ?? "MEDIUM";

    // Award achievements (fire-and-forget)
    checkAndAwardAchievements(user.id, {
      totalQuizzes: totalQuizzesDone,
      score,
      streak: newStreak,
      totalPoints: newTotal,
      oldPoints: oldTotal,
      difficulty: firstQuestionDiff ?? undefined,
      totalTimeTakenMs,
      questionCount: gradedAnswers.length,
      mode: quiz.mode,
      chapterId: retryChapterId ?? undefined,
    }).catch(console.error);

    // Level-up notification
    if (newXPLevel > updatedUser.xpLevel) {
      notifyLevelUp(user.id, newXPLevel).catch(console.error);
    }

    // Return results with explanations
    return NextResponse.json({
      quizId,
      score,
      totalQuestions: gradedAnswers.length,
      correctAnswers: correctCount,
      totalPointsEarned,
      speedBonus: effectiveSpeedBonus,
      streakBonus: effectiveStreakBonus,
      pointsBlocked,
      pointsBlockedReason: pointsBlocked
        ? exceedsDailyLimit
          ? "Daily quiz limit reached (20 scored quizzes/day)"
          : tooFast
            ? "Answered too fast to count — take your time to earn points"
            : `Score below ${MIN_SCORE_FOR_POINTS}% — no points awarded`
        : undefined,
      redeemablePointsEarned: redeemableEarned,
      newRedeemablePoints: updatedUser.redeemablePoints,
      qualityThreshold: QUALITY_SCORE_FOR_REWARDS,
      repeatQuestions: repeatCount,
      newQuestions: newCorrectCount,
      pointsReducedForRepeats: repeatCount > 0,
      newTotalPoints: updatedUser.totalPoints,
      newXPLevel,
      retryChapterId,
      retryDifficulty,
      retryQuestionCount: gradedAnswers.length,
      answers: gradedAnswers.map((a, i) => ({
        questionId: a.questionId,
        questionText: a.questionText,
        options: a.options,
        studentAnswer: a.studentAnswer,
        correctAnswer: a.correctAnswer,
        isCorrect: a.isCorrect,
        explanation: a.explanation,
        videoUrl: a.videoUrl,
        pointsEarned: answerPoints[i] ?? 0,
      })),
    });
  } catch (error) {
    console.error("Quiz submit error:", error);
    return NextResponse.json(
      { error: "Failed to submit quiz" },
      { status: 500 }
    );
  }
}
