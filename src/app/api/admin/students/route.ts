import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getCurrentUser } from "@/lib/get-session";
import { rateLimit } from "@/lib/rate-limit";

export async function GET(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user || !["SUPER_ADMIN", "SCHOOL_ADMIN"].includes(user.role)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  }

  // Rate-limit per admin user: 60 requests per minute
  const rl = rateLimit(`admin:students:${user.id}`, 60, 60_000);
  if (!rl.success) {
    return NextResponse.json(
      { error: "Too many requests. Please slow down." },
      { status: 429, headers: { "Retry-After": String(rl.retryAfter) } }
    );
  }

  // SCHOOL_ADMIN must have an assigned school — reject unconfigured accounts
  if (user.role === "SCHOOL_ADMIN" && !user.schoolId) {
    return NextResponse.json({ error: "School admin account not configured" }, { status: 403 });
  }

  const { searchParams } = req.nextUrl;
  const search = searchParams.get("search")?.trim() || "";
  const grade = searchParams.get("grade") || "";
  const section = searchParams.get("section")?.trim() || "";
  const sort = searchParams.get("sort") || "points";
  const page = Math.max(1, parseInt(searchParams.get("page") || "1", 10));
  const limit = Math.min(100, Math.max(1, parseInt(searchParams.get("limit") || "20", 10)));

  const schoolId = user.schoolId;

  const baseWhere = {
    role: "STUDENT" as const,
    ...(schoolId ? { schoolId } : {}),
    ...(search
      ? {
          OR: [
            { name: { contains: search, mode: "insensitive" as const } },
            { phoneNumber: { contains: search } },
          ],
        }
      : {}),
    ...(grade ? { grade: parseInt(grade, 10) } : {}),
    ...(section ? { section } : {}),
  };

  const orderBy =
    sort === "name"
      ? { name: "asc" as const }
      : sort === "recent"
      ? { lastActiveAt: "desc" as const }
      : { totalPoints: "desc" as const };

  const [students, total, activeThisWeek, avgPointsResult] = await Promise.all([
    db.user.findMany({
      where: baseWhere,
      include: {
        _count: { select: { quizzes: true } },
      },
      orderBy,
      skip: (page - 1) * limit,
      take: limit,
    }),

    db.user.count({ where: baseWhere }),

    db.user.count({
      where: {
        role: "STUDENT" as const,
        ...(schoolId ? { schoolId } : {}),
        lastActiveAt: {
          gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000),
        },
      },
    }),

    db.user.aggregate({
      where: {
        role: "STUDENT" as const,
        ...(schoolId ? { schoolId } : {}),
      },
      _avg: { totalPoints: true },
    }),
  ]);

  const totalStudents = await db.user.count({
    where: {
      role: "STUDENT" as const,
      ...(schoolId ? { schoolId } : {}),
    },
  });

  const avgPoints = Math.round(avgPointsResult._avg.totalPoints ?? 0);
  const totalPages = Math.ceil(total / limit);

  const formattedStudents = students.map((s) => ({
    id: s.id,
    name: s.name,
    phoneNumber: s.phoneNumber,
    grade: s.grade,
    section: s.section,
    xpLevel: s.xpLevel,
    totalPoints: s.totalPoints,
    avatarUrl: s.avatarUrl,
    streakDays: s.streakDays,
    lastActiveAt: s.lastActiveAt,
    createdAt: s.createdAt,
    quizCount: s._count.quizzes,
    isActive: s.isActive,
    suspendedAt: s.suspendedAt,
  }));

  return NextResponse.json({
    students: formattedStudents,
    total,
    page,
    totalPages,
    stats: {
      totalStudents,
      activeThisWeek,
      avgPoints,
    },
  });
}
