import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getCurrentUser } from "@/lib/get-session";
import { rateLimit } from "@/lib/rate-limit";
import { validateCsrfOrigin } from "@/lib/csrf";
import { isValidSection, MAX_SECTION_LENGTH, normalizeSection } from "@/lib/section";
import { PRIMARY_MAX_GRADE, SECONDARY_MIN_GRADE, isSecondaryGrade } from "@/lib/teacher-band";
import { generateTempPassword, generateUsername, hashPassword } from "@/lib/password";

// ─── POST: create a single student ──
// The school issues sign-in details: a username made from the name and a
// temporary password, returned ONCE for the admin to hand over. The student
// replaces the password at first sign-in. Students need no email or phone.
export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user || !["SUPER_ADMIN", "SCHOOL_ADMIN"].includes(user.role)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  }
  if (!validateCsrfOrigin(req)) {
    return NextResponse.json({ error: "Invalid request origin" }, { status: 403 });
  }
  if (user.role === "SCHOOL_ADMIN" && !user.schoolId) {
    return NextResponse.json({ error: "School admin account not configured" }, { status: 403 });
  }

  // Elementary schools have no students on the school side — their teachers
  // run single-screen classroom games with no pupil accounts.
  if (user.school?.level === "ELEMENTARY") {
    return NextResponse.json(
      { error: "Elementary schools do not register students." },
      { status: 403 },
    );
  }

  let body: { name?: string; grade?: string | number; section?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const name = typeof body.name === "string" ? body.name.trim() : "";
  if (name.length < 2) {
    return NextResponse.json({ error: "Please enter the student's full name." }, { status: 400 });
  }

  const gradeNum =
    body.grade === undefined || body.grade === "" ? null : parseInt(String(body.grade), 10);
  // Student accounts are for grades 9-12; grades 1-8 have no student accounts.
  if (gradeNum !== null && !isSecondaryGrade(gradeNum)) {
    return NextResponse.json({ error: "Grade must be between 9 and 12." }, { status: 400 });
  }
  // Section is required. A grade can run twenty sections, and both the class
  // rosters a teacher sees and the cohort scoping behind them are keyed on it,
  // so a student with no section would belong to no class at all.
  const section = normalizeSection(body.section);
  if (!isValidSection(section)) {
    return NextResponse.json(
      { error: `Enter the student's section (up to ${MAX_SECTION_LENGTH} characters), for example A.` },
      { status: 400 }
    );
  }

  const username = await generateUsername(name);
  const tempPassword = generateTempPassword();

  const student = await db.user.create({
    data: {
      name,
      username,
      passwordHash: await hashPassword(tempPassword),
      mustChangePassword: true,
      role: "STUDENT",
      grade: gradeNum,
      section,
      // School admins add to their own school; super admins create unassigned.
      schoolId: user.schoolId ?? null,
    },
    select: { id: true, name: true, username: true, grade: true, section: true },
  });

  return NextResponse.json({ student, tempPassword }, { status: 201 });
}

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
  // School level: "elementary" (grades 1-8) or "secondary" (9-12). An explicit
  // grade is narrower, so it wins when both are sent.
  const level = searchParams.get("level") || "";
  const section = normalizeSection(searchParams.get("section")) ?? "";
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
            { username: { contains: search.toLowerCase() } },
            { email: { contains: search, mode: "insensitive" as const } },
            // Telegram accounts have no email; admins find them by the permanent ID.
            { telegramId: { contains: search } },
          ],
        }
      : {}),
    ...(grade
      ? { grade: parseInt(grade, 10) }
      : level === "elementary"
      ? { grade: { lte: PRIMARY_MAX_GRADE } }
      : level === "secondary"
      ? { grade: { gte: SECONDARY_MIN_GRADE } }
      : {}),
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

  const scopeWhere = { role: "STUDENT" as const, ...(schoolId ? { schoolId } : {}) };
  const [totalStudents, elementaryStudents, secondaryStudents] = await Promise.all([
    db.user.count({ where: scopeWhere }),
    db.user.count({ where: { ...scopeWhere, grade: { lte: PRIMARY_MAX_GRADE } } }),
    db.user.count({ where: { ...scopeWhere, grade: { gte: SECONDARY_MIN_GRADE } } }),
  ]);

  const avgPoints = Math.round(avgPointsResult._avg.totalPoints ?? 0);
  const totalPages = Math.ceil(total / limit);

  const formattedStudents = students.map((s) => ({
    id: s.id,
    name: s.name,
    username: s.username,
    email: s.email,
    telegramId: s.telegramId,
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
      elementaryStudents,
      secondaryStudents,
      activeThisWeek,
      avgPoints,
    },
  });
}
