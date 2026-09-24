import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getCurrentUser } from "@/lib/get-session";
import { validateCsrfOrigin } from "@/lib/csrf";
import { mergeChapterInto } from "@/lib/chapter-merge";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await getCurrentUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!["SUPER_ADMIN", "SCHOOL_ADMIN"].includes(user.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  if (!validateCsrfOrigin(request)) {
    return NextResponse.json({ error: "Invalid request origin" }, { status: 403 });
  }

  const { id: textbookId } = await params;

  let body: { sourceChapterId?: string; targetChapterId?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { sourceChapterId, targetChapterId } = body;

  if (!sourceChapterId || typeof sourceChapterId !== "string") {
    return NextResponse.json({ error: "sourceChapterId is required" }, { status: 400 });
  }

  if (!targetChapterId || typeof targetChapterId !== "string") {
    return NextResponse.json({ error: "targetChapterId is required" }, { status: 400 });
  }

  if (sourceChapterId === targetChapterId) {
    return NextResponse.json(
      { error: "sourceChapterId and targetChapterId must be different" },
      { status: 400 },
    );
  }

  // 1. Verify textbook exists and belongs to admin's school
  const textbook = await db.textbook.findUnique({
    where: { id: textbookId },
    select: { id: true, schoolId: true },
  });

  if (!textbook) {
    return NextResponse.json({ error: "Textbook not found" }, { status: 404 });
  }

  if (
    user.role === "SCHOOL_ADMIN" &&
    user.schoolId &&
    textbook.schoolId !== user.schoolId
  ) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // 2. Verify both chapters belong to the textbook
  const [sourceChapter, targetChapter] = await Promise.all([
    db.chapter.findFirst({
      where: { id: sourceChapterId, textbookId },
      select: { id: true, title: true, content: true, chapterNumber: true },
    }),
    db.chapter.findFirst({
      where: { id: targetChapterId, textbookId },
      select: { id: true, title: true, content: true, chapterNumber: true },
    }),
  ]);

  if (!sourceChapter) {
    return NextResponse.json(
      { error: "Source chapter not found or does not belong to this textbook" },
      { status: 404 },
    );
  }

  if (!targetChapter) {
    return NextResponse.json(
      { error: "Target chapter not found or does not belong to this textbook" },
      { status: 404 },
    );
  }

  // 4. Merge in a transaction — questions, activities AND embedded chunks
  //    move to the target (see lib/chapter-merge for what used to be lost).
  const result = await db.$transaction(
    (tx) => mergeChapterInto(tx, { textbookId, sourceChapterId, targetChapterId }),
    { timeout: 30_000 },
  );

  return NextResponse.json({
    success: true,
    targetChapter: result,
    deletedChapterId: sourceChapterId,
  });
}
