import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getCurrentUser } from "@/lib/get-session";

export async function GET() {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Get recent quizzes
  const recentQuizzes = await db.quiz.findMany({
    where: { studentId: user.id, completedAt: { not: null } },
    orderBy: { completedAt: "desc" },
    take: 5,
    select: {
      id: true,
      mode: true,
      score: true,
      totalQuestions: true,
      correctAnswers: true,
      totalPointsEarned: true,
      completedAt: true,
    },
  });

  // Get aggregate stats
  const quizStats = await db.quiz.aggregate({
    where: { studentId: user.id, completedAt: { not: null } },
    _count: true,
    _avg: { score: true },
  });

  // Get total points from ledger
  const pointsSum = await db.pointLedger.aggregate({
    where: { userId: user.id },
    _sum: { points: true },
  });

  // Get available subjects for student's grade
  const textbooks = await db.textbook.findMany({
    where: user.grade ? { grade: user.grade } : {},
    select: {
      id: true,
      title: true,
      subject: true,
      grade: true,
      _count: { select: { chapters: true } },
    },
    orderBy: { subject: "asc" },
  });

  return NextResponse.json({
    user: {
      id: user.id,
      name: user.name,
      grade: user.grade,
      xpLevel: user.xpLevel,
      totalPoints: user.totalPoints,
      streakDays: user.streakDays,
      avatarUrl: user.avatarUrl,
    },
    stats: {
      totalQuizzes: quizStats._count,
      averageScore: Math.round(quizStats._avg.score || 0),
      totalPoints: pointsSum._sum.points || 0,
      streakDays: user.streakDays,
    },
    recentQuizzes,
    availableSubjects: textbooks,
  });
}
