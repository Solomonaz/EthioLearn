import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getCurrentUser } from "@/lib/get-session";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;

  const textbook = await (db as any).textbook.findUnique({
    where: { id },
    select: { id: true, title: true, grade: true, subject: true },
  });

  if (!textbook) {
    return NextResponse.json({ error: "Textbook not found" }, { status: 404 });
  }

  const chapters = await (db as any).chapter.findMany({
    where: { textbookId: id },
    include: {
      _count: { select: { questions: { where: { status: "PUBLISHED" } } } },
    },
    orderBy: { chapterNumber: "asc" },
  });

  // Count PUBLISHED questions grouped by chapter × difficulty × type, so the
  // quiz launcher can show availability that reflects BOTH the chosen difficulty
  // AND the chosen question types (the quiz query filters on type — a count that
  // ignored type would over-promise, e.g. "8 available" then a 4-question quiz).
  const DIFFS = ["EASY", "MEDIUM", "HARD"] as const;
  const grouped = await (db as any).question.groupBy({
    by: ["chapterId", "difficulty", "type"],
    where: {
      chapterId: { in: chapters.map((c: any) => c.id) },
      status: "PUBLISHED",
    },
    _count: true,
  });

  // Build { EASY: {MCQ: n, …}, MEDIUM: {…}, HARD: {…} } + per-difficulty totals
  // from a set of grouped rows.
  const buildCounts = (rows: any[]) => {
    const difficultyCounts: Record<string, number> = { EASY: 0, MEDIUM: 0, HARD: 0 };
    const difficultyTypeCounts: Record<string, Record<string, number>> = {
      EASY: {}, MEDIUM: {}, HARD: {},
    };
    for (const r of rows) {
      const diff = r.difficulty as string;
      if (!DIFFS.includes(diff as any)) continue;
      difficultyCounts[diff] += r._count;
      difficultyTypeCounts[diff][r.type] =
        (difficultyTypeCounts[diff][r.type] || 0) + r._count;
    }
    return { difficultyCounts, difficultyTypeCounts };
  };

  const chaptersWithDetails = chapters.map((ch: any) => ({
    ...ch,
    ...buildCounts(grouped.filter((g: any) => g.chapterId === ch.id)),
  }));

  const totals = buildCounts(grouped);
  const textbookTotals = {
    totalQuestions: chapters.reduce((acc: number, ch: any) => acc + ch._count.questions, 0),
    difficultyCounts: totals.difficultyCounts,
    difficultyTypeCounts: totals.difficultyTypeCounts,
  };

  return NextResponse.json({ textbook, chapters: chaptersWithDetails, textbookTotals });
}
