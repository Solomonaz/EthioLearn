import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getCurrentUser } from "@/lib/get-session";
import { validateCsrfOrigin } from "@/lib/csrf";

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

  // 4. Run merge in a transaction
  const result = await db.$transaction(async (tx) => {
    // 4a. Move all questions from source to target
    await tx.question.updateMany({
      where: { chapterId: sourceChapterId },
      data: { chapterId: targetChapterId },
    });

    // 4b. Append source content to target content (if source has content)
    let newContent = targetChapter.content ?? null;
    if (sourceChapter.content) {
      newContent =
        newContent
          ? `${newContent}\n${sourceChapter.content}`
          : sourceChapter.content;
    }

    await tx.chapter.update({
      where: { id: targetChapterId },
      data: { content: newContent },
    });

    // 4c. Delete the source chapter
    await tx.chapter.delete({ where: { id: sourceChapterId } });

    // 4d. Renumber remaining chapters sequentially
    const remainingChapters = await tx.chapter.findMany({
      where: { textbookId },
      orderBy: { chapterNumber: "asc" },
      select: { id: true },
    });

    // Pass 1: set temp numbers to avoid unique constraint violations
    for (let i = 0; i < remainingChapters.length; i++) {
      await tx.chapter.update({
        where: { id: remainingChapters[i].id },
        data: { chapterNumber: 10000 + i },
      });
    }

    // Pass 2: set actual sequential numbers
    for (let i = 0; i < remainingChapters.length; i++) {
      await tx.chapter.update({
        where: { id: remainingChapters[i].id },
        data: { chapterNumber: i + 1 },
      });
    }

    // Fetch final state of the target chapter
    const updatedTarget = await tx.chapter.findUnique({
      where: { id: targetChapterId },
      select: { id: true, title: true, chapterNumber: true },
    });

    return updatedTarget;
  });

  return NextResponse.json({
    success: true,
    targetChapter: result,
    deletedChapterId: sourceChapterId,
  });
}
