import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { getCurrentUser } from "@/lib/get-session";
import { validateCsrfOrigin } from "@/lib/csrf";
import {
  isAnyTeacher,
  PRIMARY_MAX_GRADE,
  SECONDARY_MAX_GRADE,
  SECONDARY_MIN_GRADE,
} from "@/lib/teacher-band";
import { isValidSection, MAX_SECTION_LENGTH, normalizeSection } from "@/lib/section";
import { canonicalSubject } from "@/lib/subject";

/**
 * A teacher's teaching assignments — what they actually teach. Ethiopian
 * teachers commonly hold several, e.g. Maths/Gr9/A + Physics/Gr10/C.
 *
 * Shared by BOTH teacher bands (the table itself is band-agnostic), so what a
 * row must carry depends on the caller's role:
 *   • TEACHER           → subject + grade 1-8, section always null. The
 *                         grades 1-8 surface is otherwise untouched.
 *   • SECONDARY_TEACHER → subject + grade 9-12 + a REQUIRED section, because a
 *                         grade can run twenty sections and no one teacher
 *                         takes them all.
 *
 * The env Super Admin is redirected away from every teacher surface.
 */

async function getTeacher() {
  const user = await getCurrentUser();
  if (!user || !isAnyTeacher(user.role)) return null;
  return user;
}

export async function GET() {
  const user = await getTeacher();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 403 });

  const assignments = await db.teachingAssignment.findMany({
    where: { teacherId: user.id },
    orderBy: [{ grade: "asc" }, { subject: "asc" }, { section: "asc" }],
    select: { id: true, subject: true, grade: true, section: true },
  });

  return NextResponse.json({ assignments });
}

export async function POST(request: Request) {
  if (!validateCsrfOrigin(request)) {
    return NextResponse.json({ error: "Invalid request origin" }, { status: 403 });
  }

  const user = await getTeacher();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 403 });

  let body: { subject?: string; grade?: number; section?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  let subject = typeof body.subject === "string" ? body.subject.trim() : "";
  const grade = body.grade;

  if (subject.length < 1 || subject.length > 40) {
    return NextResponse.json(
      { error: "Subject must be between 1 and 40 characters" },
      { status: 400 },
    );
  }
  const isSecondary = user.role === "SECONDARY_TEACHER";

  // Each band is bounded to its own grades.
  //
  // For the secondary band this is access control: their cohort views read
  // real students, so a grade outside the band would expose children they do
  // not teach.
  //
  // For the primary band it is data hygiene, not a hole — every secondary
  // route already refuses a TEACHER outright, so a grades 1-8 teacher who
  // claimed grade 11 got a row nothing would ever render. The bound stops the
  // junk row being written at all, and keeps this table honest for anything
  // that reads it later.
  const minGrade = isSecondary ? SECONDARY_MIN_GRADE : 1;
  const maxGrade = isSecondary ? SECONDARY_MAX_GRADE : PRIMARY_MAX_GRADE;
  if (
    !Number.isInteger(grade) ||
    (grade as number) < minGrade ||
    (grade as number) > maxGrade
  ) {
    return NextResponse.json(
      { error: `Grade must be an integer between ${minGrade} and ${maxGrade}` },
      { status: 400 },
    );
  }

  // Snap to the managed subject list, so this row lines up with how the
  // textbooks are filed rather than with however the teacher typed it.
  subject = await canonicalSubject(subject);

  // Grades 1-8 rows keep section null, which is what they have always meant:
  // the whole grade. Only the secondary band names a section, and there it is
  // required — the section, not the grade, is the real class.
  let section: string | null = null;
  if (isSecondary) {
    section = normalizeSection(body.section);
    if (!isValidSection(section)) {
      return NextResponse.json(
        {
          error: `Enter the section you teach (up to ${MAX_SECTION_LENGTH} characters), for example A`,
        },
        { status: 400 },
      );
    }
  }

  // Postgres does not treat two NULLs as equal, so the unique index cannot
  // catch a duplicate among the section-less grades 1-8 rows. Check those
  // explicitly, otherwise a 1-8 teacher could add the same pair twice — which
  // the old three-column unique index used to prevent.
  if (section === null) {
    const duplicate = await db.teachingAssignment.findFirst({
      where: { teacherId: user.id, subject, grade: grade as number, section: null },
      select: { id: true },
    });
    if (duplicate) {
      return NextResponse.json(
        { error: "You already teach that subject at that grade" },
        { status: 409 },
      );
    }
  }

  try {
    const created = await db.teachingAssignment.create({
      data: { teacherId: user.id, subject, grade: grade as number, section },
      select: { id: true, subject: true, grade: true, section: true },
    });
    return NextResponse.json({ assignment: created }, { status: 201 });
  } catch (e) {
    // Unique constraint (teacherId, subject, grade, section) — already added.
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      return NextResponse.json(
        {
          error: section
            ? "You already teach that subject to that section"
            : "You already teach that subject at that grade",
        },
        { status: 409 },
      );
    }
    throw e;
  }
}
