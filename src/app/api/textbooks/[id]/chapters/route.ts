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

  const textbook = await db.textbook.findUnique({
    where: { id },
    select: { id: true, title: true, grade: true, subject: true },
  });

  if (!textbook) {
    return NextResponse.json({ error: "Textbook not found" }, { status: 404 });
  }

  const chapters = await db.chapter.findMany({
    where: { textbookId: id },
    include: {
      _count: { select: { questions: true } },
    },
    orderBy: { chapterNumber: "asc" },
  });

  return NextResponse.json({ textbook, chapters });
}
