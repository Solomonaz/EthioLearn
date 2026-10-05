import { NextResponse } from "next/server";
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { getCurrentUser } from "@/lib/get-session";
import { resolveGradeScope } from "@/lib/grade-scope";

/**
 * GET /api/library — textbooks a student can open in the PDF reader.
 *
 * Every book with something to read: a reader PDF, or chapters (shown as
 * text). Books uploaded from a PDF keep only their extracted text unless an
 * admin also attaches a reader PDF, so requiring a PDF hid most of them.
 *
 * Same visibility as the rest of the app: approved books from the national
 * library plus the student's own school, within the student's study scope
 * (their grade and the lower grades of the same cycle — a grade 12 student
 * sees grades 9–12, everything the national exam covers).
 */
export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const where: Prisma.TextbookWhereInput = {
    approvalStatus: "APPROVED",
    AND: [{ OR: [{ readerFile: { not: null } }, { chapters: { some: {} } }] }],
  };
  const scope = resolveGradeScope(user);
  if (scope !== null) {
    if (scope.length === 0) return NextResponse.json({ books: [] });
    where.grade = { in: scope };
  }
  if (user.role !== "SUPER_ADMIN") {
    where.OR = user.schoolId ? [{ schoolId: null }, { schoolId: user.schoolId }] : [{ schoolId: null }];
  }

  const books = await db.textbook.findMany({
    where,
    orderBy: [{ grade: "desc" }, { subject: "asc" }],
    select: { id: true, title: true, subject: true, grade: true, readerFile: true, readerFileSize: true, chapterCount: true },
  });
  // The stored file key stays on the server; the page only needs to know which reader to open.
  return NextResponse.json({ books: books.map(({ readerFile, ...b }) => ({ ...b, hasPdf: !!readerFile })) });
}
