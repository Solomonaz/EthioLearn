import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getCurrentUser } from "@/lib/get-session";

interface RouteParams {
  params: Promise<{ id: string }>;
}

const MAX_CONTENT_LENGTH = 200_000; // 200K chars for full book

export async function POST(request: NextRequest, { params }: RouteParams) {
  const user = await getCurrentUser();
  if (!user || !["SUPER_ADMIN", "SCHOOL_ADMIN"].includes(user.role)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  }

  const { id: textbookId } = await params;

  // Verify textbook + school isolation
  const textbook = await db.textbook.findUnique({
    where: { id: textbookId },
    select: { id: true, schoolId: true },
  });

  if (!textbook) {
    return NextResponse.json({ error: "Textbook not found" }, { status: 404 });
  }

  if (
    user.role === "SCHOOL_ADMIN" &&
    textbook.schoolId &&
    user.schoolId &&
    textbook.schoolId !== user.schoolId
  ) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
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
      { error: "Book content must be at least 100 characters" },
      { status: 400 }
    );
  }

  if (content.length > MAX_CONTENT_LENGTH) {
    return NextResponse.json(
      { error: `Book content must be under ${MAX_CONTENT_LENGTH.toLocaleString()} characters` },
      { status: 400 }
    );
  }

  const updated = await db.textbook.update({
    where: { id: textbookId },
    data: { content: content.trim() },
    select: {
      id: true,
      title: true,
      content: true,
    },
  });

  return NextResponse.json({
    textbook: {
      id: updated.id,
      title: updated.title,
      contentLength: updated.content?.length ?? 0,
    },
  });
}

export async function GET(_request: NextRequest, { params }: RouteParams) {
  const user = await getCurrentUser();
  if (!user || !["SUPER_ADMIN", "SCHOOL_ADMIN"].includes(user.role)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  }

  const { id: textbookId } = await params;

  const textbook = await db.textbook.findUnique({
    where: { id: textbookId },
    select: { id: true, schoolId: true, content: true },
  });

  if (!textbook) {
    return NextResponse.json({ error: "Textbook not found" }, { status: 404 });
  }

  if (
    user.role === "SCHOOL_ADMIN" &&
    textbook.schoolId &&
    user.schoolId &&
    textbook.schoolId !== user.schoolId
  ) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  return NextResponse.json({
    hasContent: !!textbook.content && textbook.content.length > 0,
    contentLength: textbook.content?.length ?? 0,
  });
}
