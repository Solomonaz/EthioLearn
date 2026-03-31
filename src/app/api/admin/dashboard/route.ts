import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getCurrentUser } from "@/lib/get-session";

export async function GET() {
  const user = await getCurrentUser();
  if (!user || !["SUPER_ADMIN", "SCHOOL_ADMIN"].includes(user.role)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  }

  const schoolId = user.schoolId;
  const schoolFilter = schoolId ? { schoolId } : {};
  const studentFilter = schoolId
    ? { schoolId, role: "STUDENT" as const }
    : { role: "STUDENT" as const };

  const [
    totalStudents,
    activeStudents,
    totalQuizzes,
    totalTextbooks,
    recentQuizzes,
    topStudents,
    subjectStats,
  ] = await Promise.all([
    db.user.count({ where: studentFilter }),

    db.user.count({
      where: {
        ...studentFilter,
        lastActiveAt: {
          gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000),
        },
      },
    }),

    db.quiz.count({
      where: {
        completedAt: { not: null },
        student: studentFilter,
      },
    }),

    db.textbook.count({ where: schoolFilter }),

    db.quiz.findMany({
      where: {
        completedAt: { not: null },
        student: studentFilter,
      },
      orderBy: { completedAt: "desc" },
      take: 10,
      select: {
        id: true,
        score: true,
        totalQuestions: true,
        correctAnswers: true,
        totalPointsEarned: true,
        completedAt: true,
        student: { select: { name: true, grade: true } },
      },
    }),

    db.user.findMany({
      where: studentFilter,
      orderBy: { totalPoints: "desc" },
      take: 10,
      select: {
        id: true,
        name: true,
        grade: true,
        section: true,
        totalPoints: true,
        xpLevel: true,
        avatarUrl: true,
        _count: { select: { quizzes: true } },
      },
    }),

    // Per-subject average score breakdown
    db.quiz.groupBy({
      by: ["studentId"],
      where: {
        completedAt: { not: null },
        student: studentFilter,
      },
      _avg: { score: true },
      _count: true,
    }),
  ]);

  const avgScore =
    subjectStats.length > 0
      ? Math.round(
          subjectStats.reduce((acc, s) => acc + (s._avg.score ?? 0), 0) /
            subjectStats.length
        )
      : 0;

  return NextResponse.json({
    stats: {
      totalStudents,
      activeStudents,
      totalQuizzes,
      totalTextbooks,
      avgScore,
    },
    recentQuizzes,
    topStudents,
  });
}
