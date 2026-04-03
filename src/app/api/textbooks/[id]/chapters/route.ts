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

  // Fetch question counts by difficulty for all chapters in this textbook
  const difficultyCounts = await (db as any).question.groupBy({
    by: ["chapterId", "difficulty"],
    where: {
      chapterId: { in: chapters.map((c: any) => c.id) },
      status: "PUBLISHED",
    },
    _count: true,
  });

  // Map difficulty counts to chapters
  const chaptersWithDetails = chapters.map((ch: any) => {
    const chDiffs = difficultyCounts.filter((d: any) => d.chapterId === ch.id);
    const counts = {
      EASY: chDiffs.find((d: any) => d.difficulty === "EASY")?._count || 0,
      MEDIUM: chDiffs.find((d: any) => d.difficulty === "MEDIUM")?._count || 0,
      HARD: chDiffs.find((d: any) => d.difficulty === "HARD")?._count || 0,
    };
    return {
      ...ch,
      difficultyCounts: counts,
    };
  });

  // Calculate textbook totals
  const textbookTotals = {
    totalQuestions: chapters.reduce((acc: number, ch: any) => acc + ch._count.questions, 0),
    difficultyCounts: {
      EASY: difficultyCounts.filter((d: any) => d.difficulty === "EASY").reduce((acc: number, d: any) => acc + d._count, 0),
      MEDIUM: difficultyCounts.filter((d: any) => d.difficulty === "MEDIUM").reduce((acc: number, d: any) => acc + d._count, 0),
      HARD: difficultyCounts.filter((d: any) => d.difficulty === "HARD").reduce((acc: number, d: any) => acc + d._count, 0),
    },
  };

  return NextResponse.json({ textbook, chapters: chaptersWithDetails, textbookTotals });
}
