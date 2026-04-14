import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getCurrentUser } from "@/lib/get-session";
import { calculateQuizPoints, calculateXPLevel } from "@/lib/points";
import { Difficulty } from "@prisma/client";
import { notifyLevelUp } from "@/lib/notifications";
import { checkAndAwardAchievements } from "@/lib/achievements";
import { normalizeOption } from "@/lib/utils";
import { validateCsrfOrigin } from "@/lib/csrf";

// ── Anti-gaming constants (SRS §4.9.2) ───────────────────────────────────────
const MAX_SCORED_QUIZZES_PER_DAY = 20;
const MIN_SCORE_FOR_POINTS = 30; // below 30% → no leaderboard points

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

    // ── Anti-gaming: accuracy & daily cap checks (SRS §4.9.2) ───────────────
    const pointsBlocked = exceedsDailyLimit || score < MIN_SCORE_FOR_POINTS;

    const { total: rawPointsEarned, breakdown, speedBonus, streakBonus } =
      calculateQuizPoints(pointsInput, {
        totalTimeTakenMs,
        questionCount: gradedAnswers.length,
        streakDays: newStreak,
      });

    // Zero out points if anti-gaming rules triggered
    const totalPointsEarned = pointsBlocked ? 0 : rawPointsEarned;
    const effectiveSpeedBonus = pointsBlocked ? 0 : speedBonus;
    const effectiveStreakBonus = pointsBlocked ? 0 : streakBonus;

    // Save quiz answers
    await db.quizAnswer.createMany({
      data: gradedAnswers.map((a, i) => ({
        quizId,
        questionId: a.questionId,
        studentAnswer: a.studentAnswer,
        isCorrect: a.isCorrect,
        timeTakenMs: a.timeTakenMs,
        pointsEarned: pointsBlocked ? 0 : (breakdown[i] ?? 0),
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
          : "Score below 30% threshold"
        : undefined,
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
        pointsEarned: pointsBlocked ? 0 : (breakdown[i] ?? 0),
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
