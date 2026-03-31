import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getCurrentUser } from "@/lib/get-session";

export async function GET() {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  return NextResponse.json({
    user: {
      id: user.id,
      name: user.name,
      phoneNumber: user.phoneNumber,
      email: user.email,
      grade: user.grade,
      section: user.section,
      avatarUrl: user.avatarUrl,
      totalPoints: user.totalPoints,
      xpLevel: user.xpLevel,
      createdAt: user.createdAt,
    },
  });
}

export async function PATCH(req: Request) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
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

  // Validate name
  if (name !== undefined) {
    if (typeof name !== "string" || name.trim().length < 2 || name.trim().length > 50) {
      return NextResponse.json(
        { error: "Name must be between 2 and 50 characters" },
        { status: 400 },
      );
    }
  }

  // Validate email
  if (email !== undefined && email !== null && email !== "") {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return NextResponse.json(
        { error: "Invalid email format" },
        { status: 400 },
      );
    }

    // Check uniqueness
    const existing = await db.user.findFirst({
      where: {
        email,
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

  // Validate grade
  if (grade !== undefined && grade !== null) {
    if (typeof grade !== "number" || grade < 1 || grade > 12) {
      return NextResponse.json(
        { error: "Grade must be between 1 and 12" },
        { status: 400 },
      );
    }
  }

  // Build update data — only include provided fields
  const updateData: Record<string, unknown> = {};
  if (name !== undefined) updateData.name = name.trim();
  if (email !== undefined) updateData.email = email === "" ? null : email;
  if (grade !== undefined) updateData.grade = grade;
  if (section !== undefined) updateData.section = section || null;
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
