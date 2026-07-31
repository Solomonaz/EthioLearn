import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getCurrentUser } from "@/lib/get-session";

/**
 * GET /api/battles/options
 *
 * Battle create-room options scoped to the CURRENT student's profile grade:
 * returns that grade plus only the subjects that actually have battle-ready
 * questions (PUBLISHED MCQs in a COMPLETED textbook) for that grade, each with
 * its available MCQ count. Battles are MCQ-only, so the count mirrors exactly
 * what the create route (POST /api/battles) will draw from.
 */
export async function GET() {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const grade = (user as { grade?: number | null }).grade ?? null;
  if (!grade) {
    // No grade on profile → nothing to scope battles to.
    return NextResponse.json({ grade: null, subjects: [] });
  }

  const textbooks = await db.textbook.findMany({
    where: { grade, processingStatus: "COMPLETED" },
    select: { subject: true, chapters: { select: { id: true } } },
  });

  // Merge counts by subject (a grade may have more than one textbook per subject).
  const bySubject = new Map<string, { name: string; count: number }>();
  for (const tb of textbooks) {
    const chapterIds = tb.chapters.map((c) => c.id);
    if (chapterIds.length === 0) continue;

    const count = await db.question.count({
      where: {
        chapterId: { in: chapterIds },
        type: "MCQ",
        status: "PUBLISHED",
      },
    });
    if (count <= 0) continue;

    const key = tb.subject.toLowerCase();
    const existing = bySubject.get(key);
    if (existing) existing.count += count;
    else bySubject.set(key, { name: tb.subject, count });
  }

  const subjects = [...bySubject.values()].sort((a, b) =>
    a.name.localeCompare(b.name)
  );

  return NextResponse.json({ grade, subjects });
}
