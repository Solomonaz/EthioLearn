import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getCurrentUser } from "@/lib/get-session";
import { validateCsrfOrigin } from "@/lib/csrf";
import { isValidSection, MAX_SECTION_LENGTH, normalizeSection } from "@/lib/section";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getCurrentUser();
  if (!user || !["SUPER_ADMIN", "SCHOOL_ADMIN"].includes(user.role)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  }

  const { id } = await params;
  const schoolId = user.schoolId;

  // SCHOOL_ADMIN must have an assigned school — reject unconfigured accounts
  if (user.role === "SCHOOL_ADMIN" && !schoolId) {
    return NextResponse.json({ error: "School admin account not configured" }, { status: 403 });
  }

  const student = await db.user.findFirst({
    where: {
      id,
      role: "STUDENT" as const,
      ...(schoolId ? { schoolId } : {}),
    },
    include: {
      school: { select: { name: true } },
      quizzes: {
        where: { completedAt: { not: null } },
        orderBy: { completedAt: "desc" },
        take: 10,
        include: {
          answers: {
            take: 1,
            include: {
              question: {
                include: {
                  chapter: {
                    include: {
                      textbook: { select: { subject: true, title: true } },
                    },
                  },
                },
              },
            },
          },
        },
      },
      pointLedger: {
        orderBy: { createdAt: "desc" },
        take: 20,
      },
    },
  });

  if (!student) {
    return NextResponse.json({ error: "Student not found" }, { status: 404 });
  }

  // ── Compute stats from quizzes ──────────────────────────────────────────────

  const totalQuizzes = student.quizzes.length;
  const avgScore =
    totalQuizzes > 0
      ? Math.round(
          student.quizzes.reduce((sum, q) => sum + q.score, 0) / totalQuizzes
        )
      : 0;

  // ── Subject mastery ─────────────────────────────────────────────────────────

  const subjectMap = new Map<
    string,
    { quizzes: number; scoreSum: number; totalPoints: number }
  >();

  for (const quiz of student.quizzes) {
    const answer = quiz.answers[0];
    const subject =
      answer?.question?.chapter?.textbook?.subject ?? "Unknown";
    const existing = subjectMap.get(subject) ?? {
      quizzes: 0,
      scoreSum: 0,
      totalPoints: 0,
    };
    existing.quizzes += 1;
    existing.scoreSum += quiz.score;
    existing.totalPoints += quiz.totalPointsEarned;
    subjectMap.set(subject, existing);
  }

  const subjectMastery = Array.from(subjectMap.entries()).map(
    ([subject, data]) => ({
      subject,
      quizzes: data.quizzes,
      avgScore:
        data.quizzes > 0 ? Math.round(data.scoreSum / data.quizzes) : 0,
      totalPoints: data.totalPoints,
    })
  );

  // ── Achievements (data-driven from UserAchievement table) ───────────────────

  const earnedRecords = await db.userAchievement.findMany({
    where: { userId: student.id },
    select: { code: true },
  });
  const earnedCodes = new Set(earnedRecords.map((r) => r.code));

  const { ACHIEVEMENTS } = await import("@/lib/achievements");
  const achievements = ACHIEVEMENTS.map((def) => ({
    id: def.code,
    name: def.name,
    desc: def.desc,
    icon: def.icon,
    earned: earnedCodes.has(def.code),
  }));

  // ── Format recent quizzes ───────────────────────────────────────────────────

  const recentQuizzes = student.quizzes.map((q) => {
    const answer = q.answers[0];
    const chapter = answer?.question?.chapter ?? null;
    return {
      id: q.id,
      score: q.score,
      totalQuestions: q.totalQuestions,
      correctAnswers: q.correctAnswers,
      totalPointsEarned: q.totalPointsEarned,
      completedAt: q.completedAt,
      subject: chapter?.textbook?.subject ?? null,
      chapterTitle: chapter?.title ?? null,
      chapterNumber: chapter?.chapterNumber ?? null,
    };
  });

  return NextResponse.json({
    student: {
      id: student.id,
      name: student.name,
      username: student.username,
      email: student.email,
      grade: student.grade,
      section: student.section,
      xpLevel: student.xpLevel,
      totalPoints: student.totalPoints,
      avatarUrl: student.avatarUrl,
      streakDays: student.streakDays,
      lastActiveAt: student.lastActiveAt,
      createdAt: student.createdAt,
      school: student.school,
      isActive: student.isActive,
      suspendedAt: student.suspendedAt,
      suspendReason: student.suspendReason,
    },
    stats: {
      totalQuizzes,
      avgScore,
    },
    subjectMastery,
    recentQuizzes,
    achievements,
    pointLedger: student.pointLedger,
  });
}

// ── PATCH: update student (identity, class, status, reset points) ──────────
//
// Name, grade and section are the school's to set, not the student's — the
// student-facing routes refuse those three outright and tell the child to ask
// their administrator. This is where that administrator does it, so the two
// halves have to line up: locking students out without giving admins the edit
// would leave a typo in a name permanently uncorrectable.

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!validateCsrfOrigin(req)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const user = await getCurrentUser();
  if (!user || !["SUPER_ADMIN", "SCHOOL_ADMIN"].includes(user.role)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  }

  const { id } = await params;
  const schoolId = user.schoolId;

  if (user.role === "SCHOOL_ADMIN" && !schoolId) {
    return NextResponse.json({ error: "School admin account not configured" }, { status: 403 });
  }

  // Verify the student belongs to admin's school
  const student = await db.user.findFirst({
    where: { id, role: "STUDENT", ...(schoolId ? { schoolId } : {}) },
    select: { id: true, isActive: true },
  });

  if (!student) {
    return NextResponse.json({ error: "Student not found" }, { status: 404 });
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { name, grade, section, isActive, resetStreak, suspend, suspendReason } =
    body as {
      name?: string;
      grade?: string;
      section?: string;
      isActive?: boolean;
      resetStreak?: boolean;
      suspend?: boolean;
      suspendReason?: string;
    };

  const updateData: Record<string, unknown> = {};

  if (name !== undefined) {
    const trimmed = String(name).trim().replace(/\s+/g, " ");
    if (trimmed.length < 2 || trimmed.length > 50) {
      return NextResponse.json(
        { error: "Name must be between 2 and 50 characters." },
        { status: 400 },
      );
    }
    updateData.name = trimmed;
  }

  // User.grade is an Int. Sending a string here made Prisma throw
  // "Expected Int, provided String" and the whole update failed.
  if (grade !== undefined) {
    const parsed = parseInt(String(grade), 10);
    if (Number.isNaN(parsed) || parsed < 1 || parsed > 12) {
      return NextResponse.json(
        { error: "Grade must be a whole number between 1 and 12." },
        { status: 400 },
      );
    }
    updateData.grade = parsed;
  }

  // Sections must go through the same normalisation as every other writer.
  // Storing "b" here while teachers hold "B" silently drops the student off
  // their class roster, because the cohort query compares the two exactly.
  if (section !== undefined) {
    const normalized = normalizeSection(section);
    if (!isValidSection(normalized)) {
      return NextResponse.json(
        {
          error: `Enter the student's section (up to ${MAX_SECTION_LENGTH} characters), for example A.`,
        },
        { status: 400 },
      );
    }
    updateData.section = normalized;
  }
  if (typeof isActive === "boolean") updateData.isActive = isActive;
  if (resetStreak === true) updateData.streakDays = 0;
  if (typeof suspend === "boolean") {
    if (suspend) {
      updateData.suspendedAt = new Date();
      if (suspendReason) updateData.suspendReason = String(suspendReason);
    } else {
      updateData.suspendedAt = null;
      updateData.suspendReason = null;
    }
  }

  if (Object.keys(updateData).length === 0) {
    return NextResponse.json({ error: "No fields to update" }, { status: 400 });
  }

  const updated = await db.user.update({
    where: { id },
    data: updateData,
    select: {
      id: true,
      name: true,
      username: true,
      email: true,
      grade: true,
      section: true,
      isActive: true,
      streakDays: true,
      totalPoints: true,
      xpLevel: true,
    },
  });

  return NextResponse.json({ student: updated });
}
