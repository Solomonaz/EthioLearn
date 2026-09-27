import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getCurrentUser } from "@/lib/get-session";
import { validateCsrfOrigin } from "@/lib/csrf";
import { canManageTextbook } from "@/lib/textbook-access";

interface RouteParams {
  params: Promise<{ id: string; chapterId: string }>;
}

const MAX_CONTENT_LENGTH = 50_000;

export async function POST(request: NextRequest, { params }: RouteParams) {
  const user = await getCurrentUser();
  if (!user || !["SUPER_ADMIN", "SCHOOL_ADMIN"].includes(user.role)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  }

  if (!validateCsrfOrigin(request)) {
    return NextResponse.json({ error: "Invalid request origin" }, { status: 403 });
  }

  const { id: textbookId, chapterId } = await params;

  // Verify textbook belongs to admin's school
  const textbook = await db.textbook.findUnique({
    where: { id: textbookId },
    select: { id: true, schoolId: true },
  });

  if (!textbook) {
    return NextResponse.json({ error: "Textbook not found" }, { status: 404 });
  }

  if (!canManageTextbook(user, textbook.schoolId)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // Verify chapter belongs to textbook
  const chapter = await db.chapter.findFirst({
    where: { id: chapterId, textbookId },
    select: { id: true },
  });

  if (!chapter) {
    return NextResponse.json({ error: "Chapter not found" }, { status: 404 });
  }

  let body: { content?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { content } = body;

  if (!content || typeof content !== "string" || content.trim().length < 100) {
    return NextResponse.json(
      { error: "Content must be at least 100 characters" },
      { status: 400 }
    );
  }

  if (content.length > MAX_CONTENT_LENGTH) {
    return NextResponse.json(
      { error: `Content must be under ${MAX_CONTENT_LENGTH.toLocaleString()} characters` },
      { status: 400 }
    );
  }

  const updated = await db.chapter.update({
    where: { id: chapterId },
    data: { content: content.trim() },
    select: {
      id: true,
      title: true,
      chapterNumber: true,
      content: true,
    },
  });

  return NextResponse.json({
    chapter: {
      ...updated,
      contentLength: updated.content?.length ?? 0,
    },
  });
}
