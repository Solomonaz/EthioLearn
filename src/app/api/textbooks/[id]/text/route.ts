import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getCurrentUser } from "@/lib/get-session";
import { canReadTextbook } from "@/lib/library-access";

/**
 * GET /api/textbooks/[id]/text?chapter=N — a book's chapters for the library's
 * text reader: the list of chapters, plus the full text of chapter N (the
 * first chapter when N is missing). Used for books that have no reader PDF.
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;

  const tb = await db.textbook.findUnique({
    where: { id },
    select: { schoolId: true, grade: true, approvalStatus: true },
  });
  if (!tb || !canReadTextbook(user, tb)) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const chapters = await db.chapter.findMany({
    where: { textbookId: id },
    orderBy: { chapterNumber: "asc" },
    select: { chapterNumber: true, title: true },
  });
  if (chapters.length === 0) return NextResponse.json({ chapters: [], chapter: null });

  const requested = Number(request.nextUrl.searchParams.get("chapter"));
  const number = chapters.some((c) => c.chapterNumber === requested) ? requested : chapters[0].chapterNumber;
  const chapter = await db.chapter.findFirst({
    where: { textbookId: id, chapterNumber: number },
    select: { chapterNumber: true, title: true, content: true },
  });
  return NextResponse.json(
    { chapters, chapter },
    { headers: { "Cache-Control": "private, max-age=300" } },
  );
}
