import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getCurrentUser } from "@/lib/get-session";
import { validateCsrfOrigin } from "@/lib/csrf";

/**
 * Teacher profile — read + update the signed-in teacher's own account.
 *
 * Teachers edit their display name, contact email and avatar; phone, school and
 * join date are read-only. Access is TEACHER-only (the env Super Admin has no DB
 * row and is redirected away from the teacher surface, so it is not handled).
 */

async function getTeacher() {
  const user = await getCurrentUser();
  if (!user || user.role !== "TEACHER") return null;
  return user;
}

export async function GET() {
  const user = await getTeacher();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 403 });

  // A small, friendly stat for the profile card.
  const gameSets = await db.gameContent.count({
    where: { type: "MCQ", createdById: user.id },
  });

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
    stats: { gameSets },
  });
}

export async function PATCH(request: Request) {
  if (!validateCsrfOrigin(request)) {
    return NextResponse.json({ error: "Invalid request origin" }, { status: 403 });
  }

  const user = await getTeacher();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 403 });

  let body: { name?: string; email?: string; avatarUrl?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { name, email, avatarUrl } = body;

  // ── Validate ──────────────────────────────────────────────────────────
  if (name !== undefined) {
    if (typeof name !== "string" || name.trim().length < 2 || name.trim().length > 50) {
      return NextResponse.json(
        { error: "Name must be between 2 and 50 characters" },
        { status: 400 },
      );
    }
  }

  if (email !== undefined && email !== null && email !== "") {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (typeof email !== "string" || !emailRegex.test(email)) {
      return NextResponse.json({ error: "Invalid email format" }, { status: 400 });
    }
    const existing = await db.user.findFirst({
      where: { email, id: { not: user.id } },
      select: { id: true },
    });
    if (existing) {
      return NextResponse.json(
        { error: "Email is already taken by another user" },
        { status: 409 },
      );
    }
  }

  if (avatarUrl !== undefined && avatarUrl !== null && typeof avatarUrl !== "string") {
    return NextResponse.json({ error: "Invalid avatar" }, { status: 400 });
  }

  // ── Build update ──────────────────────────────────────────────────────
  const updateData: Record<string, unknown> = {};
  if (name !== undefined) updateData.name = name.trim();
  if (email !== undefined) updateData.email = email === "" ? null : email;
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
