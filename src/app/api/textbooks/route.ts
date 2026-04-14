import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getCurrentUser } from "@/lib/get-session";

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

  // Grade filter — parse safely and skip if invalid
  if (grade) {
    const gradeNum = parseInt(grade, 10);
    if (!isNaN(gradeNum)) where.grade = gradeNum;
  }

  if (subject) where.subject = subject;

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
