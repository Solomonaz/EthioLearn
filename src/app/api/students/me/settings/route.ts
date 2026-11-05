import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireCompleteProfile } from "@/lib/get-session";
import { validateCsrfOrigin } from "@/lib/csrf";
import { normalizeSection } from "@/lib/section";
import { GRADE_LOCKED_MESSAGE, isElementaryGrade, isSecondaryGrade } from "@/lib/teacher-band";

export async function GET() {
  const user = await requireCompleteProfile();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  return NextResponse.json({
    user: {
      id: user.id,
      name: user.name,
      username: user.username,
      email: user.email,
      hasPassword: !!user.passwordHash,
      grade: user.grade,
      section: user.section,
      avatarUrl: user.avatarUrl,
      totalPoints: user.totalPoints,
      xpLevel: user.xpLevel,
      createdAt: user.createdAt,
      telegramLinked: !!(user as any).telegramId,
      schoolManaged: !!user.schoolId,
    },
  });
}

export async function PATCH(req: Request) {
  const user = await requireCompleteProfile();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!validateCsrfOrigin(req)) {
    return NextResponse.json({ error: "Invalid request origin" }, { status: 403 });
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { name, email, grade, section, avatarUrl } = body as {
    name?: string;
    email?: string;
    grade?: number;
    section?: string;
    avatarUrl?: string;
  };

  // ── School students do not own their identity fields ──────────────────
  // Same rule as PATCH /api/students/me/profile — see the note there. Two
  // routes write the same three columns, so both have to enforce it; locking
  // only one leaves the other as the way round it.
  //
  // Email and avatar stay the student's own: neither is how a teacher
  // identifies them in a class list.
  if (user.schoolId) {
    const restricted = (["name", "grade", "section"] as const).filter(
      (f) => body[f] !== undefined,
    );
    if (restricted.length > 0) {
      return NextResponse.json(
        {
          error:
            "Your name, grade and section are managed by your school. Ask your school administrator to change them.",
          fields: restricted,
        },
        { status: 403 },
      );
    }
  }

  // Validate name
  if (name !== undefined) {
    if (typeof name !== "string" || name.trim().length < 2 || name.trim().length > 50) {
      return NextResponse.json(
        { error: "Name must be between 2 and 50 characters" },
        { status: 400 },
      );
    }
  }

  // Validate email. It is a sign-in identity (password or Google), so it is
  // stored lower-case, a new address counts as unverified, and a student who
  // signs in with nothing else may not remove it.
  const normalizedEmail =
    typeof email === "string" && email.trim() ? email.trim().toLowerCase() : email;
  if (email === "" || email === null) {
    const hasOtherWay = !!(user.username || user.googleId || user.telegramId || user.facebookId);
    if (user.email && !hasOtherWay) {
      return NextResponse.json(
        { error: "You sign in with this email, so it can't be removed." },
        { status: 400 },
      );
    }
  }
  if (email !== undefined && email !== null && email !== "") {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(String(normalizedEmail))) {
      return NextResponse.json(
        { error: "Invalid email format" },
        { status: 400 },
      );
    }

    // Check uniqueness
    const existing = await db.user.findFirst({
      where: {
        email: normalizedEmail,
        id: { not: user.id },
      },
    });
    if (existing) {
      return NextResponse.json(
        { error: "Email is already taken by another user" },
        { status: 409 },
      );
    }
  }

  // Validate grade. Re-sending the current grade unchanged is always fine.
  if (grade !== undefined && grade !== user.grade) {
    // Grades 1-8 students can't change their grade; only an admin can, since
    // it moves them between the play area and the grades 9-12 dashboard.
    if (isElementaryGrade(user.grade)) {
      return NextResponse.json(
        { error: GRADE_LOCKED_MESSAGE },
        { status: 403 },
      );
    }
    // Grades 9-12 students may move within 9-12 only.
    if (!isSecondaryGrade(grade)) {
      return NextResponse.json(
        { error: "Grade must be between 9 and 12" },
        { status: 400 },
      );
    }
  }

  // Build update data — only include provided fields
  const updateData: Record<string, unknown> = {};
  if (name !== undefined) updateData.name = name.trim();
  if (email !== undefined && (normalizedEmail || null) !== user.email) {
    updateData.email = normalizedEmail || null;
    updateData.emailVerifiedAt = null;
  }
  if (grade !== undefined) updateData.grade = grade;
  // Normalised, so a self-managed student cannot store "b" against the "B"
  // every other writer holds.
  if (section !== undefined) updateData.section = normalizeSection(section) || null;
  if (avatarUrl !== undefined) updateData.avatarUrl = avatarUrl || null;

  if (Object.keys(updateData).length === 0) {
    return NextResponse.json(
      { error: "No fields to update" },
      { status: 400 },
    );
  }

  const updated = await db.user.update({
    where: { id: user.id },
    data: updateData,
    select: {
      id: true,
      name: true,
      phoneNumber: true,
      email: true,
      grade: true,
      section: true,
      avatarUrl: true,
      totalPoints: true,
      xpLevel: true,
      createdAt: true,
    },
  });

  return NextResponse.json({ user: updated });
}
