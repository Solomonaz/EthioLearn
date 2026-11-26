import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { getCurrentUser } from "@/lib/get-session";
import { featureDenial } from "@/lib/entitlements";
import { addisWeekStart } from "@/lib/study-time";

export async function GET(request: Request) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const denied = await featureDenial(user, "leaderboard");
  if (denied) return denied;

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
  // School students rank within their school; students without a school rank
  // among other students without a school (never mixed into schools' boards).
  const base: Prisma.UserWhereInput = { role: "STUDENT", schoolId: user.schoolId ?? null };

  if (type === "class") {
    if (user.grade != null) base.grade = user.grade;
    if (user.section != null) base.section = user.section;
  } else if (type === "grade") {
    if (user.grade != null) base.grade = user.grade;
  } else {
    // school (default)
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
        // Same scope and subject filter as the list above.
        ...withSubjectFilter(buildUserScopeWhere(user, type), subject),
        totalPoints: { gt: user.totalPoints },
      },
    });
    currentUserRank = countAbove + 1;
  }

  return NextResponse.json({ leaderboard, currentUserRank });
}

// ── Weekly leaderboard ────────────────────────────────────────────────────────
// A calendar week: Monday 00:00 to Monday 00:00 Addis Ababa time, so it really
// does reset every Monday. Ranked on points EARNED that week from the point
// ledger — Daily Challenge, battle wins, streak bonuses and quiz points — not
// only quiz rows (battle wins never had one). With a subject filter, only quiz
// points can be attributed to a subject, so that view ranks quiz points.

const EARNING_ACTIONS = ["QUIZ_COMPLETE", "DAILY_CHALLENGE", "BATTLE_WIN", "STREAK_BONUS"];
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

type Totals = { userId: string; points: number }[];

async function weeklyTotals(
  scopeUserIds: string[],
  from: Date,
  to: Date,
  subject: string,
  take?: number,
): Promise<Totals> {
  if (scopeUserIds.length === 0) return [];
  if (subject) {
    const rows = await db.quiz.groupBy({
      by: ["studentId"],
      where: {
        completedAt: { gte: from, lt: to },
        studentId: { in: scopeUserIds },
        totalPointsEarned: { gt: 0 },
        answers: { some: { question: { chapter: { textbook: { subject } } } } },
      },
      _sum: { totalPointsEarned: true },
      orderBy: { _sum: { totalPointsEarned: "desc" } },
      ...(take ? { take } : {}),
    });
    return rows.map((r) => ({ userId: r.studentId, points: r._sum.totalPointsEarned ?? 0 }));
  }
  const rows = await db.pointLedger.groupBy({
    by: ["userId"],
    where: {
      createdAt: { gte: from, lt: to },
      userId: { in: scopeUserIds },
      actionType: { in: EARNING_ACTIONS },
      points: { gt: 0 },
    },
    _sum: { points: true },
    orderBy: { _sum: { points: "desc" } },
    ...(take ? { take } : {}),
  });
  return rows.map((r) => ({ userId: r.userId, points: r._sum.points ?? 0 }));
}

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
  const weekStart = addisWeekStart();
  const weekEnd = new Date(weekStart.getTime() + WEEK_MS);
  const lastWeekStart = new Date(weekStart.getTime() - WEEK_MS);

  const scopeUsers = await db.user.findMany({
    where: buildUserScopeWhere(user, type),
    select: { id: true },
  });
  const scopeUserIds = scopeUsers.map((u) => u.id);

  const [ranked, lastWeek] = await Promise.all([
    weeklyTotals(scopeUserIds, weekStart, weekEnd, subject, 50),
    weeklyTotals(scopeUserIds, lastWeekStart, weekStart, "", 3),
  ]);

  const ids = [...new Set([...ranked, ...lastWeek].map((r) => r.userId))];
  const userDetails = ids.length
    ? await db.user.findMany({
        where: { id: { in: ids } },
        select: { id: true, name: true, grade: true, section: true, avatarUrl: true, xpLevel: true },
      })
    : [];
  const userMap = new Map(userDetails.map((u) => [u.id, u]));

  const leaderboard = ranked
    .map((w, index) => {
      const u = userMap.get(w.userId);
      if (!u) return null;
      return {
        rank: index + 1,
        userId: u.id,
        name: u.name,
        grade: u.grade,
        section: u.section,
        avatarUrl: u.avatarUrl,
        totalPoints: w.points,
        xpLevel: u.xpLevel,
        isCurrentUser: u.id === user.id,
      };
    })
    .filter((e): e is NonNullable<typeof e> => e !== null);

  let currentUserRank: number | null = null;
  const currentUserEntry = leaderboard.find((e) => e.isCurrentUser);
  if (currentUserEntry) {
    currentUserRank = currentUserEntry.rank;
  } else if (leaderboard.length >= 50) {
    // Outside the top 50: rank = how many in scope earned more this week.
    const all = await weeklyTotals(scopeUserIds, weekStart, weekEnd, subject);
    const mine = all.find((r) => r.userId === user.id)?.points ?? 0;
    if (mine > 0) currentUserRank = all.filter((r) => r.points > mine).length + 1;
  }

  const lastWeekTop = lastWeek
    .map((w, i) => {
      const u = userMap.get(w.userId);
      return u ? { rank: i + 1, userId: u.id, name: u.name, points: w.points, isCurrentUser: u.id === user.id } : null;
    })
    .filter((e): e is NonNullable<typeof e> => e !== null);

  return NextResponse.json({
    leaderboard,
    currentUserRank,
    weekStartsAt: weekStart.toISOString(),
    resetsAt: weekEnd.toISOString(),
    lastWeekTop,
  });
}
