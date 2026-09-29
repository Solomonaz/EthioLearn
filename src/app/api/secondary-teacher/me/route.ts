import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getCurrentUser } from "@/lib/get-session";
import { validateCsrfOrigin } from "@/lib/csrf";
import { getTeacherAiStatus } from "@/lib/teacher-ai-allowance";

/**
 * Secondary teacher profile — read + update the signed-in teacher's own
 * account. Name, contact email and avatar are editable; phone, school, band
 * and join date are read-only (band and school are set at provisioning by an
 * admin and must stay authoritative).
 *
 * Separate from /api/teacher/me because the two surfaces report different
 * things: that one counts classroom game sets, which this band has none of.
 */

async function getSecondaryTeacher() {
  const user = await getCurrentUser();
  if (!user || user.role !== "SECONDARY_TEACHER") return null;
  return user;
}

export async function GET() {
  const user = await getSecondaryTeacher();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 403 });

  const [assignmentCount, ai] = await Promise.all([
    db.teachingAssignment.count({ where: { teacherId: user.id } }),
    getTeacherAiStatus(user),
  ]);

  return NextResponse.json({
    user: {
      id: user.id,
      name: user.name,
      email: user.email,
      // Hide internal telegram@ identifiers from the client.
      phone: user.phoneNumber?.startsWith("telegram@") ? null : user.phoneNumber,
      avatarUrl: user.avatarUrl,
      school: user.school ? { name: user.school.name } : null,
      createdAt: user.createdAt,
    },
    stats: { assignmentCount },
    // The school plan's AI allowance, so the assistant can show what is left.
    ai,
  });
}

export async function PATCH(request: Request) {
  if (!validateCsrfOrigin(request)) {
    return NextResponse.json({ error: "Invalid request origin" }, { status: 403 });
  }

  const user = await getSecondaryTeacher();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 403 });

  let body: { name?: string; email?: string; avatarUrl?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { name, email, avatarUrl } = body;

  if (name !== undefined) {
    if (typeof name !== "string" || name.trim().length < 2 || name.trim().length > 50) {
      return NextResponse.json(
        { error: "Name must be between 2 and 50 characters" },
        { status: 400 },
      );
    }
  }

  // The email is how staff sign in (Google, or a password reset link) and
  // their school admin set it, so it is not self-editable — changing it would
  // hand the account to whoever owns the new address.
  if (email !== undefined) {
    return NextResponse.json(
      { error: "Your email is managed by your school administrator." },
      { status: 400 },
    );
  }

  if (avatarUrl !== undefined && avatarUrl !== null && typeof avatarUrl !== "string") {
    return NextResponse.json({ error: "Invalid avatar" }, { status: 400 });
  }

  const updateData: Record<string, unknown> = {};
  if (name !== undefined) updateData.name = name.trim();
  if (avatarUrl !== undefined) updateData.avatarUrl = avatarUrl || null;

  if (Object.keys(updateData).length === 0) {
    return NextResponse.json({ error: "No fields to update" }, { status: 400 });
  }

  const updated = await db.user.update({
    where: { id: user.id },
    data: updateData,
    select: { id: true, name: true, email: true, avatarUrl: true },
  });

  return NextResponse.json({ user: updated });
}
