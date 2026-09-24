import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getCurrentUser } from "@/lib/get-session";
import { calculateQuizPoints, calculateXPLevel, getAccuracyFactor, getContentGradeFactor } from "@/lib/points";
import { getBelowGradeScope } from "@/lib/grade-scope";
import { Difficulty } from "@prisma/client";
import { notifyLevelUp } from "@/lib/notifications";
import { checkAndAwardAchievements } from "@/lib/achievements";
import { normalizeOption } from "@/lib/utils";
import { validateCsrfOrigin } from "@/lib/csrf";
import { answerKey, normalizeMathText } from "@/lib/math-notation";

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
// Students may study below their enrollment grade (a grade 8 needs grade 7, a
// grade 12 needs 9–11 — see lib/grade-scope). That content is legitimate, and
// for exam years it is literally what the exam tests, so it is NOT devalued.
// But it is also the easiest material available to them, so the number of
// below-grade questions that can SCORE in a day is capped. Past the ceiling
// the quiz still runs and still records progress and mastery — it just stops
// paying points. Tune this number; 60 ≈ six 10-question quizzes of revision,
// generous for real exam prep and short of an afternoon of grinding.
const MAX_BELOW_GRADE_SCORED_QUESTIONS_PER_DAY = 60;

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
          chapterId: null as string | null,
        };
      }

      // Both sides through the same maths conversion: a quiz started before a
      // question's LaTeX was converted to Unicode still submits the old text.
      const normalizedCorrect = normalizeMathText(String(question.correctAnswer || "").trim());
      const studentAns = normalizeMathText(String(answer.studentAnswer || "").trim());
      let isCorrect = false;

      if (question.type === "FILL_IN_BLANK") {
        // Notation-blind: \(7^5\), 7^5 and 7⁵ are one answer; H₂O = H2O.
        const c = answerKey(normalizedCorrect);
        const s = answerKey(studentAns);
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
        chapterId: question.chapterId,
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

    // ── Single-player practice earns no points at all ───────────────────────
    // This route only ever handles SOLO and TIMED quizzes — battles score
    // through the socket server (see server.ts), never here. Both are
    // unsupervised and infinitely repeatable, which made them the farming
    // surface every constant above was fighting. Rather than keep tuning those
    // heuristics, practice simply stops paying: no leaderboard/XP points, no
    // prize points, no streak bonus.
    //
    // The Daily Challenge is the one exception. It is one curated quiz per day,
    // so it cannot be farmed by definition, and it is the reason students come
    // back daily — it scores exactly as it always has.
    const isPractice = !quiz.isDailyChallenge;

    const pointsBlocked =
      exceedsDailyLimit || score < MIN_SCORE_FOR_POINTS || tooFast || isPractice;

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

    // ── Content-grade weighting (see lib/grade-scope) ───────────────────────
    // A student's study scope spans several grades — a grade 8 may open grade
    // 7, a grade 12 may open 9–11 — so the questions in one quiz can come from
    // below their enrollment grade. Resolve each question's grade through
    // chapter → textbook, then apply the two guards: content off the student's
    // exam matrix scores at a fraction and never toward prizes, and below-grade
    // content is capped by volume per day.
    const answerChapterIds = [
      ...new Set(
        gradedAnswers.map((a) => a.chapterId).filter((c): c is string => !!c),
      ),
    ];
    const chapterRows = answerChapterIds.length
      ? await db.chapter.findMany({
          where: { id: { in: answerChapterIds } },
          select: { id: true, textbook: { select: { grade: true } } },
        })
      : [];
    const gradeByChapter = new Map(
      chapterRows.map((c) => [c.id, c.textbook?.grade ?? null]),
    );

    // Only students are grade-scoped; staff taking a quiz score unweighted.
    const userGrade = user.role === "STUDENT" ? user.grade ?? null : null;
    const belowGrades = getBelowGradeScope(userGrade);
    const contentGrades = gradedAnswers.map((a) =>
      a.chapterId ? gradeByChapter.get(a.chapterId) ?? null : null,
    );

    // Below-grade scoring budget left today. Counted over already-completed
    // quizzes, so starting a fresh quiz can't reset it.
    let belowGradeBudget = Number.POSITIVE_INFINITY;
    if (belowGrades.length > 0) {
      const belowAnsweredToday = await db.quizAnswer.count({
        where: {
          quiz: {
            studentId: user.id,
            completedAt: { gte: todayStart, lt: tomorrowStart },
          },
          question: { chapter: { textbook: { grade: { in: belowGrades } } } },
        },
      });
      belowGradeBudget = Math.max(
        0,
        MAX_BELOW_GRADE_SCORED_QUESTIONS_PER_DAY - belowAnsweredToday,
      );
    }

    // Per-answer grade factor. Below-grade answers draw the daily budget down
    // in order; once it is spent, the remainder score zero.
    let belowGradeUsed = 0;
    let belowGradeCapped = 0;
    const gradeFactor = gradedAnswers.map((a, i) => {
      const contentGrade = contentGrades[i];
      if (contentGrade == null || userGrade == null) return 1;
      if (contentGrade < userGrade) {
        if (belowGradeUsed >= belowGradeBudget) {
          belowGradeCapped++;
          return 0;
        }
        belowGradeUsed++;
      }
      return getContentGradeFactor(userGrade, contentGrade);
    });

    // Performance bonuses scale with content value too — a flawless run through
    // below-grade revision shouldn't pay the same perfect-score bonus as one
    // through the student's own grade.
    const meanGradeFactor =
      gradeFactor.length > 0
        ? gradeFactor.reduce((s, f) => s + f, 0) / gradeFactor.length
        : 1;

    // Per-answer review weight: new-correct = full, repeat-correct = review,
    // wrong = 0 — then scaled by where the content sits for this student.
    const reviewWeight = gradedAnswers.map((a, i) =>
      a.isCorrect
        ? (masteredBefore.has(a.questionId) ? REVIEW_POINTS_FACTOR : 1) *
          gradeFactor[i]
        : 0,
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
    // Base points from newly-mastered questions only — the sole source of prize
    // points. Restricted further to full-value content: on the student's exam
    // matrix AND inside the daily below-grade ceiling. Off-matrix revision
    // still earns leaderboard points (at REVIEW rate) but never prize points.
    const newBase = breakdown.reduce((s, b, i) => {
      const a = gradedAnswers[i];
      const freshlyMastered = a.isCorrect && !masteredBefore.has(a.questionId);
      return s + (freshlyMastered && gradeFactor[i] === 1 ? (b ?? 0) : 0);
    }, 0);

    // Scale points by accuracy (60% → 0.6×, 100% → 1.0×) so a marginal pass
    // earns proportionally less. Zeroed entirely when an anti-gaming rule fires.
    const accuracyFactor = pointsBlocked
      ? 0
      : getAccuracyFactor(score, MIN_SCORE_FOR_POINTS);

    // Leaderboard/XP points: review-weighted base + novelty-scaled performance
    // bonuses + login-streak bonus, all scaled by accuracy.
    const totalPointsEarned = Math.round(
      (weightedBase +
        performanceBonuses * noveltyFactor * meanGradeFactor +
        streakBonus) *
        accuracyFactor,
    );
    const effectiveSpeedBonus = Math.round(
      speedBonus * noveltyFactor * meanGradeFactor * accuracyFactor,
    );
    const effectiveStreakBonus = Math.round(streakBonus * accuracyFactor);

    // Prize-eligible points: only NEW mastery on quality quizzes contributes.
    // A fully fresh quiz earns close to its full value here; a pure retake earns
    // zero (newBase and noveltyFactor are both 0). The login-streak bonus is
    // excluded — prizes come from mastery, not from showing up.
    const redeemableEarned =
      !pointsBlocked && score >= QUALITY_SCORE_FOR_REWARDS
        ? Math.round(
            (newBase + performanceBonuses * noveltyFactor * meanGradeFactor) *
              accuracyFactor,
          )
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
    if (!pointsBlocked && quiz.isDailyChallenge && correctCount >= 3) {
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
        // Practice is checked first: a solo quiz scored 90% is not blocked for
        // being "below 50%", and saying so would be actively misleading.
        ? isPractice
          ? "Practice quizzes don't award points — play a Battle or today's Daily Challenge to earn."
          : exceedsDailyLimit
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
      // Grade-scope weighting — lets the results screen explain why a revision
      // quiz paid less than the raw difficulty would suggest.
      offMatrixQuestions: gradeFactor.filter((f) => f > 0 && f < 1).length,
      belowGradeCappedQuestions: belowGradeCapped,
      belowGradeCapReached: belowGradeCapped > 0,
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
