import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getCurrentUser } from "@/lib/get-session";
import { calculateQuizPoints, calculateXPLevel } from "@/lib/points";
import { Difficulty } from "@prisma/client";
import { notifyLevelUp } from "@/lib/notifications";
import { checkAndAwardAchievements } from "@/lib/achievements";
import { normalizeOption } from "@/lib/utils";

interface SubmittedAnswer {
  questionId: string;
  studentAnswer: string;
  timeTakenMs: number;
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { id: quizId } = await params;
    const body = await request.json();
    const { answers }: { answers: SubmittedAnswer[] } = body;

    if (!answers || !Array.isArray(answers)) {
      return NextResponse.json(
        { error: "Answers array is required" },
        { status: 400 }
      );
    }

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

    // Fetch all questions for grading
    const questionIds = answers.map((a) => a.questionId);
    const questions = await db.question.findMany({
      where: { id: { in: questionIds } },
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
          questionText: "",
          options: [] as unknown,
        };
      }

      const normalizedCorrect = normalizeOption(question.correctAnswer as unknown);
      const isCorrect = answer.studentAnswer === normalizedCorrect;

      return {
        questionId: answer.questionId,
        studentAnswer: answer.studentAnswer,
        isCorrect,
        timeTakenMs: answer.timeTakenMs,
        difficulty: question.difficulty,
        correctAnswer: normalizedCorrect,
        explanation: question.explanation || "",
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
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    yesterday.setHours(0, 0, 0, 0);
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

    const { total: totalPointsEarned, breakdown, speedBonus, streakBonus } =
      calculateQuizPoints(pointsInput, {
        totalTimeTakenMs,
        questionCount: gradedAnswers.length,
        streakDays: newStreak,
      });

    const correctCount = gradedAnswers.filter((a) => a.isCorrect).length;
    const score = Math.round((correctCount / gradedAnswers.length) * 100);

    // Save quiz answers
    await db.quizAnswer.createMany({
      data: gradedAnswers.map((a, i) => ({
        quizId,
        questionId: a.questionId,
        studentAnswer: a.studentAnswer,
        isCorrect: a.isCorrect,
        timeTakenMs: a.timeTakenMs,
        pointsEarned: breakdown[i],
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

    // Create point ledger entry
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

    // Update user total points and XP level
    const oldStreak = user.streakDays || 0;
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

    // Achievement: quiz count milestones
    const totalQuizzesDone = await db.quiz.count({
      where: { studentId: user.id, completedAt: { not: null } },
    });

    // Count total hard quizzes for achievements
    const firstQuestionDiff = gradedAnswers[0]
      ? questionMap.get(gradedAnswers[0].questionId)?.difficulty
      : undefined;

    const newTotal = oldTotal + totalPointsEarned;

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
    }).catch(console.error);

    // Level-up notification (still fire inline since it's already deduped)
    if (newXPLevel > updatedUser.xpLevel) {
      notifyLevelUp(user.id, newXPLevel).catch(console.error);
    }

    // Get chapter info for retry
    const firstAnswer = gradedAnswers[0];
    const firstQuestion = firstAnswer ? questionMap.get(firstAnswer.questionId) : null;
    const retryChapterId = firstQuestion?.chapterId ?? null;
    const retryDifficulty = firstQuestion?.difficulty ?? "MEDIUM";

    // Return results with explanations
    return NextResponse.json({
      quizId,
      score,
      totalQuestions: gradedAnswers.length,
      correctAnswers: correctCount,
      totalPointsEarned,
      speedBonus,
      streakBonus,
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
        pointsEarned: breakdown[i],
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
