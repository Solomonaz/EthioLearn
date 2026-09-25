import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getCurrentUser } from "@/lib/get-session";
import { validateCsrfOrigin } from "@/lib/csrf";
import { cleanChapterTitle } from "@/lib/display-text";

type RouteParams = { params: Promise<{ id: string; chapterId: string }> };

async function getAuthorizedTextbook(
  textbookId: string,
  userRole: string,
  userSchoolId: string | null | undefined
) {
  const textbook = await db.textbook.findUnique({
    where: { id: textbookId },
    select: { id: true, schoolId: true },
  });

  if (!textbook) return { textbook: null, error: "Textbook not found", status: 404 };

  if (
    userRole === "SCHOOL_ADMIN" &&
    userSchoolId &&
    textbook.schoolId !== userSchoolId
  ) {
    return { textbook: null, error: "Forbidden", status: 403 };
  }

  return { textbook, error: null, status: 200 };
}

export async function PATCH(request: NextRequest, { params }: RouteParams) {
  const user = await getCurrentUser();
  if (!user || !["SUPER_ADMIN", "SCHOOL_ADMIN"].includes(user.role)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  }

  if (!validateCsrfOrigin(request)) {
    return NextResponse.json({ error: "Invalid request origin" }, { status: 403 });
  }

  const { id: textbookId, chapterId } = await params;

  const { textbook, error, status } = await getAuthorizedTextbook(
    textbookId,
    user.role,
    user.schoolId
  );
  if (!textbook) {
    return NextResponse.json({ error }, { status });
  }

  const chapter = await db.chapter.findFirst({
    where: { id: chapterId, textbookId },
    select: { id: true, chapterNumber: true, title: true },
  });

  if (!chapter) {
    return NextResponse.json({ error: "Chapter not found" }, { status: 404 });
  }

  let body: { action?: string; title?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { action, title } = body;

  if (!action || !["move_up", "move_down", "rename"].includes(action)) {
    return NextResponse.json(
      { error: "action must be one of: move_up, move_down, rename" },
      { status: 400 }
    );
  }

  if (action === "rename") {
    if (!title || typeof title !== "string" || title.trim().length === 0) {
      return NextResponse.json(
        { error: "title is required and must be a non-empty string" },
        { status: 400 }
      );
    }

    const updated = await db.chapter.update({
      where: { id: chapterId },
      data: { title: cleanChapterTitle(title) },
      select: { id: true, chapterNumber: true, title: true },
    });

    return NextResponse.json({ chapter: updated });
  }

  // move_up or move_down
  const targetNumber =
    action === "move_up"
      ? chapter.chapterNumber - 1
      : chapter.chapterNumber + 1;

  const sibling = await db.chapter.findUnique({
    where: {
      textbookId_chapterNumber: {
        textbookId,
        chapterNumber: targetNumber,
      },
    },
    select: { id: true, chapterNumber: true },
  });

  if (!sibling) {
    const msg =
      action === "move_up"
        ? "Chapter is already first"
        : "Chapter is already last";
    return NextResponse.json({ error: msg }, { status: 400 });
  }

  // Swap chapterNumbers using a temp value to avoid unique constraint conflicts
  const TEMP_NUMBER = 99999;

  await db.$transaction([
    // Move current chapter to temp slot
    db.chapter.update({
      where: { id: chapter.id },
      data: { chapterNumber: TEMP_NUMBER },
    }),
    // Move sibling into current chapter's old slot
    db.chapter.update({
      where: { id: sibling.id },
      data: { chapterNumber: chapter.chapterNumber },
    }),
    // Move current chapter from temp slot into sibling's old slot
    db.chapter.update({
      where: { id: chapter.id },
      data: { chapterNumber: targetNumber },
    }),
  ]);

  const updated = await db.chapter.findUnique({
    where: { id: chapterId },
    select: { id: true, chapterNumber: true, title: true },
  });

  return NextResponse.json({ chapter: updated });
}

export async function DELETE(request: NextRequest, { params }: RouteParams) {
  const user = await getCurrentUser();
  if (!user || !["SUPER_ADMIN", "SCHOOL_ADMIN"].includes(user.role)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  }

  if (!validateCsrfOrigin(request)) {
    return NextResponse.json({ error: "Invalid request origin" }, { status: 403 });
  }

  const { id: textbookId, chapterId } = await params;

  const { textbook, error, status } = await getAuthorizedTextbook(
    textbookId,
    user.role,
    user.schoolId
  );
  if (!textbook) {
    return NextResponse.json({ error }, { status });
  }

  const chapter = await db.chapter.findFirst({
    where: { id: chapterId, textbookId },
    select: {
      id: true,
      chapterNumber: true,
      title: true,
      _count: { select: { questions: true } },
    },
  });

  if (!chapter) {
    return NextResponse.json({ error: "Chapter not found" }, { status: 404 });
  }

  if (chapter._count.questions > 0) {
    return NextResponse.json(
      {
        error: `Cannot delete chapter with ${chapter._count.questions} question(s). Remove all questions first.`,
      },
      { status: 409 }
    );
  }

  await db.chapter.delete({ where: { id: chapterId } });

  return NextResponse.json({ success: true });
}
