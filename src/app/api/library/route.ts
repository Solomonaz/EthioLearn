import { NextResponse } from "next/server";
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { getCurrentUser } from "@/lib/get-session";
import { resolveGradeScope } from "@/lib/grade-scope";

/**
 * GET /api/library — textbooks a student can open in the PDF reader.
 * Signed-in students only (plus the super admin).
 *
 * Same visibility as the rest of the app: approved books from the national
 * library plus the student's own school, within the student's study scope
 * (their grade and the lower grades of the same cycle — a grade 12 student
 * sees grades 9–12, everything the national exam covers).
 */
export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  // The Library is a student feature; the super admin may look for checking.
  if (user.role !== "STUDENT" && user.role !== "SUPER_ADMIN") return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const where: Prisma.TextbookWhereInput = { approvalStatus: "APPROVED", readerFile: { not: null } };
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
    select: { id: true, title: true, subject: true, grade: true, readerFileSize: true, chapterCount: true },
  });
  return NextResponse.json({ books });
}
