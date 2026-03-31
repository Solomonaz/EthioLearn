import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { getCurrentUser } from "@/lib/get-session";

export async function GET(request: Request) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const type = searchParams.get("type") ?? "school";
  const period = searchParams.get("period") ?? "alltime";
  const subject = searchParams.get("subject") ?? "";

  try {
    if (period === "weekly") {
      return await getWeeklyLeaderboard(user, type, subject);
    }
    return await getAllTimeLeaderboard(user, type, subject);
  } catch (error) {
    console.error("Leaderboard error:", error);
    return NextResponse.json(
      { error: "Failed to load leaderboard" },
      { status: 500 }
    );
  }
}

// ── Scope where builder ────────────────────────────────────────────────────────

function buildUserScopeWhere(
  user: {
    schoolId: string | null;
    grade: number | null;
    section: string | null;
  },
  type: string
): Prisma.UserWhereInput {
  const base: Prisma.UserWhereInput = { role: "STUDENT" };

  if (type === "class") {
    if (user.schoolId) base.schoolId = user.schoolId;
    if (user.grade != null) base.grade = user.grade;
    if (user.section != null) base.section = user.section;
  } else if (type === "grade") {
    if (user.schoolId) base.schoolId = user.schoolId;
    if (user.grade != null) base.grade = user.grade;
  } else {
    // school (default)
    if (user.schoolId) base.schoolId = user.schoolId;
  }

  return base;
}

// ── Subject filter for user query ──────────────────────────────────────────────

function withSubjectFilter(
  where: Prisma.UserWhereInput,
  subject: string
): Prisma.UserWhereInput {
  if (!subject) return where;
  return {
    ...where,
    quizzes: {
      some: {
        answers: {
          some: {
            question: {
              chapter: {
                textbook: { subject },
              },
            },
          },
        },
      },
    },
  };
}

// ── All-time leaderboard ───────────────────────────────────────────────────────

async function getAllTimeLeaderboard(
  user: {
    id: string;
    schoolId: string | null;
    grade: number | null;
    section: string | null;
    totalPoints: number;
  },
  type: string,
  subject: string
) {
  const scopeWhere = withSubjectFilter(
    buildUserScopeWhere(user, type),
    subject
  );

  const users = await db.user.findMany({
    where: scopeWhere,
    select: {
      id: true,
      name: true,
      grade: true,
      section: true,
      avatarUrl: true,
      totalPoints: true,
      xpLevel: true,
    },
    orderBy: { totalPoints: "desc" },
    take: 50,
  });

  const leaderboard = users.map((u, index) => ({
    rank: index + 1,
    userId: u.id,
    name: u.name,
    grade: u.grade,
    section: u.section,
    avatarUrl: u.avatarUrl,
    totalPoints: u.totalPoints,
    xpLevel: u.xpLevel,
    isCurrentUser: u.id === user.id,
  }));

  let currentUserRank: number | null = null;
  const currentUserEntry = leaderboard.find((e) => e.isCurrentUser);

  if (currentUserEntry) {
    currentUserRank = currentUserEntry.rank;
  } else {
    // User is outside top 50 — count those ranked above them
    const countAbove = await db.user.count({
      where: {
        ...buildUserScopeWhere(user, type),
        totalPoints: { gt: user.totalPoints },
      },
    });
    currentUserRank = countAbove + 1;
  }

  return NextResponse.json({ leaderboard, currentUserRank });
}

// ── Weekly leaderboard ────────────────────────────────────────────────────────

async function getWeeklyLeaderboard(
  user: {
    id: string;
    schoolId: string | null;
    grade: number | null;
    section: string | null;
  },
  type: string,
  subject: string
) {
  const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

  // Fetch user IDs in scope
  const scopeUsers = await db.user.findMany({
    where: buildUserScopeWhere(user, type),
    select: { id: true },
  });
  const scopeUserIds = scopeUsers.map((u) => u.id);

  // Build quiz where clause for weekly period
  const quizWhere: Prisma.QuizWhereInput = {
    completedAt: { gte: weekAgo },
    studentId: { in: scopeUserIds },
  };

  if (subject) {
    quizWhere.answers = {
      some: {
        question: {
          chapter: {
            textbook: { subject },
          },
        },
      },
    };
  }

  // Group quizzes by student, sum points earned this week
  const weeklyPoints = await db.quiz.groupBy({
    by: ["studentId"],
    where: quizWhere,
    _sum: { totalPointsEarned: true },
    orderBy: { _sum: { totalPointsEarned: "desc" } },
    take: 50,
  });

  if (weeklyPoints.length === 0) {
    return NextResponse.json({ leaderboard: [], currentUserRank: null });
  }

  // Fetch user details for the ranked IDs
  const rankedUserIds = weeklyPoints.map((w) => w.studentId);
  const userDetails = await db.user.findMany({
    where: { id: { in: rankedUserIds } },
    select: {
      id: true,
      name: true,
      grade: true,
      section: true,
      avatarUrl: true,
      totalPoints: true,
      xpLevel: true,
    },
  });

  const userMap = new Map(userDetails.map((u) => [u.id, u]));

  const leaderboard = weeklyPoints
    .map((w, index) => {
      const u = userMap.get(w.studentId);
      if (!u) return null;
      return {
        rank: index + 1,
        userId: u.id,
        name: u.name,
        grade: u.grade,
        section: u.section,
        avatarUrl: u.avatarUrl,
        totalPoints: w._sum.totalPointsEarned ?? 0,
        xpLevel: u.xpLevel,
        isCurrentUser: u.id === user.id,
      };
    })
    .filter((e): e is NonNullable<typeof e> => e !== null);

  let currentUserRank: number | null = null;
  const currentUserEntry = leaderboard.find((e) => e.isCurrentUser);

  if (currentUserEntry) {
    currentUserRank = currentUserEntry.rank;
  } else {
    // Compute user's weekly points to determine rank outside top 50
    const currentUserWeekly = await db.quiz.aggregate({
      where: { studentId: user.id, completedAt: { gte: weekAgo } },
      _sum: { totalPointsEarned: true },
    });
    const currentWeeklyPoints = currentUserWeekly._sum.totalPointsEarned ?? 0;

    if (currentWeeklyPoints > 0) {
      const higherScorers = await db.quiz.groupBy({
        by: ["studentId"],
        where: {
          completedAt: { gte: weekAgo },
          studentId: { in: scopeUserIds },
        },
        _sum: { totalPointsEarned: true },
        having: {
          totalPointsEarned: {
            _sum: { gt: currentWeeklyPoints },
          },
        },
      });
      currentUserRank = higherScorers.length + 1;
    }
  }

  return NextResponse.json({ leaderboard, currentUserRank });
}
