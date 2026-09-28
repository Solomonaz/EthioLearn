import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getCurrentUser } from "@/lib/get-session";
import { getTeacherAiStatus } from "@/lib/teacher-ai-allowance";

export async function GET() {
  const user = await getCurrentUser();
  if (!user || !["SUPER_ADMIN", "SCHOOL_ADMIN"].includes(user.role)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  }

  // An elementary school has no students, so its admin's dashboard is about
  // its teachers instead.
  if (user.role === "SCHOOL_ADMIN" && user.schoolId && user.school?.level === "ELEMENTARY") {
    return NextResponse.json(await elementaryDashboard(user.schoolId));
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

/**
 * Teacher activity for an elementary school admin. Classroom games run on one
 * shared screen and are not logged per play, so activity is read from what
 * teachers leave behind: when they last signed in, the game sets they built,
 * and the AI credits they spent this month.
 */
async function elementaryDashboard(schoolId: string) {
  const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const teachers = await db.user.findMany({
    where: { schoolId, role: "TEACHER" },
    orderBy: [{ isActive: "desc" }, { lastActiveAt: { sort: "desc", nulls: "last" } }],
    select: {
      id: true,
      name: true,
      isActive: true,
      lastActiveAt: true,
      _count: { select: { gameContents: true } },
    },
  });

  // One status lookup gives the school-wide limit; usage is summed per teacher.
  const monthStart = new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), 1));
  const [usage, status] = await Promise.all([
    db.teacherAiUse.groupBy({
      by: ["teacherId"],
      where: { schoolId, createdAt: { gte: monthStart } },
      _sum: { credits: true },
    }),
    teachers[0] ? getTeacherAiStatus({ id: teachers[0].id, schoolId }) : null,
  ]);
  const creditsBy = new Map(usage.map((u) => [u.teacherId, u._sum.credits ?? 0]));

  const active = teachers.filter((t) => t.isActive);
  return {
    level: "ELEMENTARY" as const,
    stats: {
      totalTeachers: active.length,
      activeTeachers: active.filter((t) => t.lastActiveAt && t.lastActiveAt >= weekAgo).length,
      gameSets: teachers.reduce((n, t) => n + t._count.gameContents, 0),
      aiCreditsThisMonth: usage.reduce((n, u) => n + (u._sum.credits ?? 0), 0),
    },
    aiCreditLimit: status?.limit ?? null,
    subscriptionActive: status?.schoolActive ?? null,
    teachers: teachers.map((t) => ({
      id: t.id,
      name: t.name,
      isActive: t.isActive,
      lastActiveAt: t.lastActiveAt,
      gameSets: t._count.gameContents,
      aiCredits: creditsBy.get(t.id) ?? 0,
    })),
  };
}
