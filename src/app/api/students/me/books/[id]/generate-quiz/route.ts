/**
 * POST /api/students/me/books/[id]/generate-quiz
 * Generates quiz questions from a student's personal book content
 * using the AI question generation pipeline.
 *
 * SRS §4.8.2 — Processing & Quiz Generation (lighter touch for student books)
 */
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireCompleteProfile } from "@/lib/get-session";
import { validateCsrfOrigin } from "@/lib/csrf";

// Rate limiting: 3 quiz generations per book per day
const DAILY_GEN_LIMIT = 3;

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!validateCsrfOrigin(req)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const user = await requireCompleteProfile();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id: bookId } = await params;

  // Parse request body
  let body: { difficulty?: string; questionCount?: number; questionType?: string } = {};
  try {
    body = await req.json();
  } catch { /* empty body is OK */ }

  const difficulty = (["EASY", "MEDIUM", "HARD"].includes(body.difficulty ?? ""))
    ? (body.difficulty as "EASY" | "MEDIUM" | "HARD")
    : "MEDIUM";
  const questionCount = Math.min(20, Math.max(5, Number(body.questionCount) || 10));
  const questionType = body.questionType ?? "MCQ";

  // Verify book belongs to this student and is fully processed
  const book = await db.studentBook.findUnique({ where: { id: bookId } });
  if (!book || book.uploadedById !== user.id) {
    return NextResponse.json({ error: "Book not found" }, { status: 404 });
  }
  if (book.processingStatus !== "COMPLETED") {
    return NextResponse.json(
      { error: "Book is not yet processed. Please upload the file first." },
      { status: 400 }
    );
  }
  if (!book.content || book.content.trim().length < 100) {
    return NextResponse.json(
      { error: "Book has insufficient content for quiz generation." },
      { status: 400 }
    );
  }

  // Use AI provider to generate questions from book content
  const { generateQuestionsFromText } = await import("@/lib/student-book-ai");
  const questions = await generateQuestionsFromText({
    text: book.content,
    title: book.title,
    difficulty,
    questionCount,
    questionType,
  });

  if (!questions || questions.length === 0) {
    return NextResponse.json(
      { error: "Failed to generate questions from this book. Please try again." },
      { status: 500 }
    );
  }

  // Increment quiz count on book
  await db.studentBook.update({
    where: { id: bookId },
    data: { quizCount: { increment: 1 } },
  });

  return NextResponse.json({
    bookId,
    bookTitle: book.title,
    questions,
    questionCount: questions.length,
  });
}
