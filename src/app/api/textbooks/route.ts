import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getCurrentUser } from "@/lib/get-session";
import { resolveGradeScope } from "@/lib/grade-scope";
import { subjectFilter } from "@/lib/subject";

export async function GET(request: Request) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const grade = searchParams.get("grade");
  const subject = searchParams.get("subject");

  // Only show textbooks that are fully created and ready for use.
  // processingStatus COMPLETED means the textbook record + chapters exist.
  const where: Record<string, unknown> = {
    processingStatus: "COMPLETED",
    // Require at least one chapter — bare shells with no chapters are useless
    chapters: { some: {} },
  };

  // ── Grade scoping (see lib/grade-scope) ──────────────────────────────────
  // A student may open their own grade plus the lower grades in the same cycle
  // — the grade 8 exam is drawn from grades 7–8, ESSLCE from grades 9–12. The
  // requested grade is only ever a *narrowing* of that scope: anything outside
  // it is dropped, so this can no longer be widened from the query string.
  //
  // `grade` may be a single value or a comma-separated set. A teacher setting
  // work for a grade 12 class asks for the whole ESSLCE cycle, because that
  // class may legitimately be set grade 11 revision — exactly what the
  // activities route already allows through `isInStudyScope`. Asking for one
  // grade here while the write path accepted four is what left revision
  // textbooks invisible in the picker.
  const requestedGrades = (grade ?? "")
    .split(",")
    .map((g) => parseInt(g.trim(), 10))
    .filter((g) => Number.isInteger(g));

  const scope = resolveGradeScope(
    user,
    requestedGrades.length === 1 ? requestedGrades[0] : null,
  );
  if (scope !== null) {
    // A student's scope is the ceiling. Several requested grades narrow it;
    // they can never widen it.
    const allowed =
      requestedGrades.length > 1
        ? scope.filter((g) => requestedGrades.includes(g))
        : scope;
    if (allowed.length === 0) {
      // Either a grade outside the student's scope, or a student with no grade
      // set yet — both show nothing rather than falling back to everything.
      return NextResponse.json({ textbooks: [] });
    }
    where.grade = { in: allowed };
  } else if (requestedGrades.length > 0) {
    // Non-students (admins, teachers) keep the free-form grade filter.
    where.grade = { in: requestedGrades };
  }

  // Case-insensitive: `Textbook.subject` is free text, so a book filed as
  // "biology" must still answer a request for "Biology".
  if (subject) where.subject = subjectFilter(subject);

  // School scoping:
  //   • Textbooks with schoolId = student's school  → that school's curriculum
  //   • Textbooks with schoolId = null              → global/system-wide books
  // Students without a schoolId can see all textbooks (single-tenant / dev mode)
  if (user.schoolId) {
    where.OR = [{ schoolId: user.schoolId }, { schoolId: null }];
  }

  const textbooks = await db.textbook.findMany({
    where,
    include: {
      _count: { select: { chapters: true } },
    },
    orderBy: [{ grade: "asc" }, { subject: "asc" }],
  });

  return NextResponse.json({ textbooks });
}
