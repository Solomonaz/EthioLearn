import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { getCurrentUser } from "@/lib/get-session";
import { validateCsrfOrigin } from "@/lib/csrf";

/**
 * A teacher's teaching assignments — the (subject, grade) pairs they teach.
 * Ethiopian teachers commonly teach several, e.g. Science/Gr3 + Math/Gr4.
 * TEACHER-only (the env Super Admin is redirected away from /teacher).
 */

async function getTeacher() {
  const user = await getCurrentUser();
  if (!user || user.role !== "TEACHER") return null;
  return user;
}

export async function GET() {
  const user = await getTeacher();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 403 });

  const assignments = await db.teachingAssignment.findMany({
    where: { teacherId: user.id },
    orderBy: [{ grade: "asc" }, { subject: "asc" }],
    select: { id: true, subject: true, grade: true },
  });

  return NextResponse.json({ assignments });
}

export async function POST(request: Request) {
  if (!validateCsrfOrigin(request)) {
    return NextResponse.json({ error: "Invalid request origin" }, { status: 403 });
  }

  const user = await getTeacher();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 403 });

  let body: { subject?: string; grade?: number };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const subject = typeof body.subject === "string" ? body.subject.trim() : "";
  const grade = body.grade;

  if (subject.length < 1 || subject.length > 40) {
    return NextResponse.json(
      { error: "Subject must be between 1 and 40 characters" },
      { status: 400 },
    );
  }
  if (!Number.isInteger(grade) || (grade as number) < 1 || (grade as number) > 12) {
    return NextResponse.json(
      { error: "Grade must be an integer between 1 and 12" },
      { status: 400 },
    );
  }

  try {
    const created = await db.teachingAssignment.create({
      data: { teacherId: user.id, subject, grade: grade as number },
      select: { id: true, subject: true, grade: true },
    });
    return NextResponse.json({ assignment: created }, { status: 201 });
  } catch (e) {
    // Unique constraint (teacherId, subject, grade) — already added.
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      return NextResponse.json(
        { error: "You already teach that subject at that grade" },
        { status: 409 },
      );
    }
    throw e;
  }
}
