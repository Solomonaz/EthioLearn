import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getCurrentUser } from "@/lib/get-session";
import { rateLimit } from "@/lib/rate-limit";
import { validateCsrfOrigin } from "@/lib/csrf";
import { isValidSection, MAX_SECTION_LENGTH, normalizeSection } from "@/lib/section";

// Normalize an Ethiopian phone number to +251XXXXXXXXX, or null if invalid.
function normalizePhone(raw: string): string | null {
  const trimmed = raw.trim().replace(/\s+/g, "");
  let n = trimmed;
  if (trimmed.startsWith("0")) n = "+251" + trimmed.slice(1);
  else if (trimmed.startsWith("251")) n = "+" + trimmed;
  else if (!trimmed.startsWith("+251")) return null;
  return /^\+251[0-9]{9}$/.test(n) ? n : null;
}

// ─── POST: create a single student ──
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

  let body: { name?: string; phone?: string; phoneNumber?: string; grade?: string | number; section?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const name = typeof body.name === "string" ? body.name.trim() : "";
  if (name.length < 2) {
    return NextResponse.json({ error: "Please enter the student's full name." }, { status: 400 });
  }

  const rawPhone = String(body.phone ?? body.phoneNumber ?? "");
  const phoneNumber = normalizePhone(rawPhone);
  if (!phoneNumber) {
    return NextResponse.json(
      { error: "Enter a valid Ethiopian phone number (e.g. 9XXXXXXXX)." },
      { status: 400 }
    );
  }

  const gradeNum =
    body.grade === undefined || body.grade === "" ? null : parseInt(String(body.grade), 10);
  if (gradeNum !== null && (isNaN(gradeNum) || gradeNum < 1 || gradeNum > 12)) {
    return NextResponse.json({ error: "Grade must be between 1 and 12." }, { status: 400 });
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

  const existing = await db.user.findUnique({ where: { phoneNumber }, select: { id: true } });
  if (existing) {
    return NextResponse.json(
      { error: "A user with this phone number already exists." },
      { status: 409 }
    );
  }

  const student = await db.user.create({
    data: {
      name,
      phoneNumber,
      role: "STUDENT",
      grade: gradeNum,
      section,
      // School admins add to their own school; super admins create unassigned.
      schoolId: user.schoolId ?? null,
    },
    select: { id: true, name: true, phoneNumber: true, grade: true, section: true },
  });

  return NextResponse.json({ student }, { status: 201 });
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
