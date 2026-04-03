import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getCurrentUser } from "@/lib/get-session";

interface RouteParams {
  params: Promise<{ id: string; chapterId: string }>;
}

interface QuestionInput {
  questionText: string;
  type: "MCQ" | "TRUE_FALSE";
  options: string[];
  correctAnswer: string;
  difficulty: "EASY" | "MEDIUM" | "HARD";
  explanation?: string;
}

export async function POST(request: NextRequest, { params }: RouteParams) {
  const user = await getCurrentUser();
  if (!user || !["SUPER_ADMIN", "SCHOOL_ADMIN"].includes(user.role)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  }

  const { id: textbookId, chapterId } = await params;

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

  let targetChapterId = chapterId;

  if (chapterId === "all") {
    // Cumulative save - find first chapter to link questions to
    const firstChapter = await db.chapter.findFirst({
      where: { textbookId },
      orderBy: { chapterNumber: "asc" },
      select: { id: true },
    });

    if (!firstChapter) {
      return NextResponse.json({ error: "No chapters found to save questions to" }, { status: 400 });
    }
    targetChapterId = firstChapter.id;
  } else {
    // Verify chapter belongs to textbook
    const chapter = await db.chapter.findFirst({
      where: { id: chapterId, textbookId },
      select: { id: true },
    });

    if (!chapter) {
      return NextResponse.json({ error: "Chapter not found" }, { status: 404 });
    }
    targetChapterId = chapter.id;
  }

  let body: { questions?: QuestionInput[]; publish?: boolean };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { questions, publish = true } = body;

  if (!Array.isArray(questions) || questions.length === 0) {
    return NextResponse.json(
      { error: "questions array is required and must not be empty" },
      { status: 400 }
    );
  }

  if (questions.length > 50) {
    return NextResponse.json(
      { error: "Cannot save more than 50 questions at once" },
      { status: 400 }
    );
  }

  // Validate and prepare question data
  const validDifficulties = ["EASY", "MEDIUM", "HARD"];
  const validTypes = ["MCQ", "TRUE_FALSE"];

  const questionData = questions
    .filter((q) => {
      if (!q.questionText?.trim()) return false;
      if (!q.correctAnswer?.trim()) return false;
      if (!Array.isArray(q.options) || q.options.length < 2) return false;
      if (!q.options.includes(q.correctAnswer)) return false;
      return true;
    })
    .map((q) => ({
      chapterId: targetChapterId,
      questionText: q.questionText.trim(),
      type: validTypes.includes(q.type) ? q.type : ("MCQ" as const),
      difficulty: validDifficulties.includes(q.difficulty)
        ? q.difficulty
        : ("MEDIUM" as const),
      options: q.options,
      correctAnswer: q.correctAnswer,
      explanation: q.explanation?.trim() || null,
      status: publish ? ("PUBLISHED" as const) : ("DRAFT" as const),
    }));

  if (questionData.length === 0) {
    return NextResponse.json(
      { error: "No valid questions to save" },
      { status: 400 }
    );
  }

  // Batch create
  const result = await db.question.createMany({
    data: questionData,
  });

  // Update chapter question count
  const totalQuestions = await db.question.count({
    where: { chapterId: targetChapterId, status: "PUBLISHED" },
  });

  await db.chapter.update({
    where: { id: targetChapterId },
    data: { questionCount: totalQuestions },
  });

  return NextResponse.json({
    saved: result.count,
    total: questions.length,
    skipped: questions.length - result.count,
    status: publish ? "PUBLISHED" : "DRAFT",
  });
}
