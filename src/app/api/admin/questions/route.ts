import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getCurrentUser } from "@/lib/get-session";
import { Difficulty, QuestionType } from "@prisma/client";

export async function GET(request: NextRequest) {
  const user = await getCurrentUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!["SUPER_ADMIN", "SCHOOL_ADMIN"].includes(user.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { searchParams } = new URL(request.url);
  const textbookId = searchParams.get("textbookId") ?? undefined;
  const chapterId = searchParams.get("chapterId") ?? undefined;
  const difficulty = searchParams.get("difficulty") ?? undefined;
  const search = searchParams.get("search") ?? undefined;
  const page = Math.max(1, parseInt(searchParams.get("page") ?? "1", 10));
  const limit = Math.min(100, Math.max(1, parseInt(searchParams.get("limit") ?? "20", 10)));

  const validDifficulties: string[] = ["EASY", "MEDIUM", "HARD"];

  const where = {
    chapter: {
      textbook: { schoolId: user.schoolId ?? undefined },
      ...(chapterId ? { id: chapterId } : {}),
      ...(textbookId ? { textbookId } : {}),
    },
    ...(difficulty && validDifficulties.includes(difficulty)
      ? { difficulty: difficulty as Difficulty }
      : {}),
    ...(search
      ? { questionText: { contains: search, mode: "insensitive" as const } }
      : {}),
  };

  const [questions, total] = await Promise.all([
    db.question.findMany({
      where,
      include: {
        chapter: {
          select: {
            id: true,
            title: true,
            chapterNumber: true,
            textbook: {
              select: {
                id: true,
                title: true,
                subject: true,
                grade: true,
              },
            },
          },
        },
      },
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * limit,
      take: limit,
    }),
    db.question.count({ where }),
  ]);

  // Fetch textbooks for filter dropdowns
  const textbooks = await db.textbook.findMany({
    where: user.schoolId ? { schoolId: user.schoolId } : {},
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      title: true,
      subject: true,
      grade: true,
      chapters: {
        select: { id: true, title: true, chapterNumber: true },
        orderBy: { chapterNumber: "asc" },
      },
    },
  });

  return NextResponse.json({
    questions,
    total,
    page,
    totalPages: Math.ceil(total / limit),
    textbooks,
  });
}

interface CreateQuestionBody {
  chapterId?: string;
  questionText?: string;
  options?: unknown;
  correctAnswer?: string;
  difficulty?: string;
  explanation?: string;
  type?: string;
}

export async function POST(request: NextRequest) {
  const user = await getCurrentUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!["SUPER_ADMIN", "SCHOOL_ADMIN"].includes(user.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  let body: CreateQuestionBody;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { chapterId, questionText, options, correctAnswer, difficulty, explanation, type } = body;

  if (!chapterId || typeof chapterId !== "string" || chapterId.trim() === "") {
    return NextResponse.json({ error: "chapterId is required" }, { status: 400 });
  }

  if (!questionText || typeof questionText !== "string" || questionText.trim() === "") {
    return NextResponse.json({ error: "questionText is required" }, { status: 400 });
  }

  if (!Array.isArray(options) || options.length < 2) {
    return NextResponse.json(
      { error: "options must be an array with at least 2 items" },
      { status: 400 },
    );
  }

  const optionStrings = options as string[];

  if (!correctAnswer || typeof correctAnswer !== "string") {
    return NextResponse.json({ error: "correctAnswer is required" }, { status: 400 });
  }

  if (!optionStrings.includes(correctAnswer)) {
    return NextResponse.json(
      { error: "correctAnswer must be one of the options" },
      { status: 400 },
    );
  }

  // Verify the chapter belongs to this school
  const chapter = await db.chapter.findUnique({
    where: { id: chapterId },
    select: { id: true, textbook: { select: { schoolId: true } } },
  });

  if (!chapter) {
    return NextResponse.json({ error: "Chapter not found" }, { status: 404 });
  }

  if (
    user.role === "SCHOOL_ADMIN" &&
    user.schoolId &&
    chapter.textbook.schoolId !== user.schoolId
  ) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const validDifficulties: string[] = ["EASY", "MEDIUM", "HARD"];
  const validTypes: string[] = ["MCQ", "TRUE_FALSE", "FILL_IN_BLANK", "MATCH_PAIRS", "ORDERING"];

  const question = await db.question.create({
    data: {
      chapterId,
      questionText: questionText.trim(),
      options: optionStrings,
      correctAnswer,
      difficulty:
        difficulty && validDifficulties.includes(difficulty)
          ? (difficulty as Difficulty)
          : Difficulty.MEDIUM,
      explanation: explanation ?? null,
      type:
        type && validTypes.includes(type) ? (type as QuestionType) : QuestionType.MCQ,
    },
    include: {
      chapter: {
        select: {
          id: true,
          title: true,
          chapterNumber: true,
          textbook: {
            select: { id: true, title: true, subject: true, grade: true },
          },
        },
      },
    },
  });

  return NextResponse.json({ question }, { status: 201 });
}
