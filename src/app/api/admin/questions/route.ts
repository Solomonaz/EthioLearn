import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getCurrentUser } from "@/lib/get-session";
import { Difficulty, Prisma, QuestionType } from "@prisma/client";
import { validateCsrfOrigin } from "@/lib/csrf";
import { canManageTextbook, visibleTextbookWhere } from "@/lib/textbook-access";

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
  const type = searchParams.get("type") ?? undefined;
  const search = searchParams.get("search") ?? undefined;
  const sort = searchParams.get("sort") ?? "newest";
  const unusedOnly = searchParams.get("unused") === "1";
  // DRAFT = imported or generated questions students can't see yet.
  const statusParam = searchParams.get("status");
  const status = statusParam === "DRAFT" || statusParam === "PUBLISHED" ? statusParam : undefined;
  // The dashboard asks for textbooks once and skips them on every later page /
  // filter change, so paging doesn't re-walk every textbook's chapters.
  const withTextbooks = searchParams.get("textbooks") !== "0";
  const page = Math.max(1, parseInt(searchParams.get("page") ?? "1", 10));
  const limit = Math.min(100, Math.max(1, parseInt(searchParams.get("limit") ?? "20", 10)));

  const validDifficulties: string[] = ["EASY", "MEDIUM", "HARD"];
  const validTypes: string[] = ["MCQ", "TRUE_FALSE", "FILL_IN_BLANK", "MATCH_PAIRS", "ORDERING"];

  // Everything except difficulty — the stats strip and the difficulty pill
  // counts describe this scope, so picking a pill doesn't zero the others.
  const baseScope: Prisma.QuestionWhereInput = {
    chapter: {
      textbook: visibleTextbookWhere(user),
      ...(chapterId ? { id: chapterId } : {}),
      ...(textbookId ? { textbookId } : {}),
    },
    ...(type && validTypes.includes(type) ? { type: type as QuestionType } : {}),
    ...(search
      ? { questionText: { contains: search, mode: "insensitive" as const } }
      : {}),
    ...(unusedOnly ? { quizAnswers: { none: {} } } : {}),
  };
  const scopeWhere: Prisma.QuestionWhereInput = { ...baseScope, ...(status ? { status } : {}) };

  const where: Prisma.QuestionWhereInput = {
    ...scopeWhere,
    ...(difficulty && validDifficulties.includes(difficulty)
      ? { difficulty: difficulty as Difficulty }
      : {}),
  };

  // Usage comes from real quiz answers — Question.usageCount / avgAccuracy are
  // never written, so they'd read 0 / null forever.
  const orderBy: Prisma.QuestionOrderByWithRelationInput[] =
    sort === "oldest"
      ? [{ createdAt: "asc" }]
      : sort === "mostUsed"
        ? [{ quizAnswers: { _count: "desc" } }, { createdAt: "desc" }]
        : sort === "leastUsed"
          ? [{ quizAnswers: { _count: "asc" } }, { createdAt: "desc" }]
          : [{ createdAt: "desc" }];

  const [questionsRaw, total, byDifficulty, unused, answered, correct, drafts] = await Promise.all([
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
                schoolId: true,
              },
            },
          },
        },
      },
      orderBy,
      skip: (page - 1) * limit,
      take: limit,
    }),
    db.question.count({ where }),
    db.question.groupBy({ by: ["difficulty"], where: scopeWhere, _count: { _all: true } }),
    db.question.count({ where: { ...scopeWhere, quizAnswers: { none: {} } } }),
    db.quizAnswer.count({ where: { question: scopeWhere } }),
    db.quizAnswer.count({ where: { question: scopeWhere, isCorrect: true } }),
    // Unaffected by the status filter, so the "Drafts" tab always shows its count.
    db.question.count({ where: { ...baseScope, status: "DRAFT" } }),
  ]);

  // Per-question answer counts + accuracy for just this page.
  const answerRows = questionsRaw.length
    ? await db.quizAnswer.groupBy({
        by: ["questionId", "isCorrect"],
        where: { questionId: { in: questionsRaw.map((q) => q.id) } },
        _count: { _all: true },
      })
    : [];
  const usage = new Map<string, { answers: number; correct: number }>();
  for (const row of answerRows) {
    const u = usage.get(row.questionId) ?? { answers: 0, correct: 0 };
    u.answers += row._count._all;
    if (row.isCorrect) u.correct += row._count._all;
    usage.set(row.questionId, u);
  }
  const questions = questionsRaw.map((q) => {
    const u = usage.get(q.id);
    return {
      ...q,
      canManage: canManageTextbook(user, q.chapter.textbook.schoolId),
      answerCount: u?.answers ?? 0,
      accuracy: u && u.answers > 0 ? u.correct / u.answers : null,
    };
  });

  const difficultyCounts = { EASY: 0, MEDIUM: 0, HARD: 0 };
  for (const row of byDifficulty) difficultyCounts[row.difficulty] = row._count._all;
  const stats = {
    total: difficultyCounts.EASY + difficultyCounts.MEDIUM + difficultyCounts.HARD,
    byDifficulty: difficultyCounts,
    unused,
    answered,
    avgAccuracy: answered > 0 ? correct / answered : null,
    drafts,
  };

  if (!withTextbooks) {
    return NextResponse.json({
      questions,
      total,
      page,
      totalPages: Math.ceil(total / limit),
      stats,
    });
  }

  // Fetch textbooks for filter dropdowns.
  //
  // `chunkingStatus` and the per-chapter chunk count drive the AI-generation
  // warning: a chapter with no chunks has not been through the processing
  // pipeline, so generation falls back to the chapter's opening slice instead
  // of sampling across the whole chapter (see lib/generation-content).
  const textbooksRaw = await db.textbook.findMany({
    where: visibleTextbookWhere(user),
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      title: true,
      subject: true,
      grade: true,
      chunkingStatus: true,
      schoolId: true,
      chapters: {
        select: {
          id: true,
          title: true,
          chapterNumber: true,
          _count: { select: { chunks: true } },
        },
        orderBy: { chapterNumber: "asc" },
      },
    },
  });

  const textbooks = textbooksRaw.map((t) => ({
    ...t,
    isLibrary: !t.schoolId,
    canManage: canManageTextbook(user, t.schoolId),
    chapters: t.chapters.map(({ _count, ...ch }) => ({
      ...ch,
      chunkCount: _count.chunks,
    })),
  }));

  return NextResponse.json({
    questions,
    total,
    page,
    totalPages: Math.ceil(total / limit),
    stats,
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
  videoUrl?: string;
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

  if (!validateCsrfOrigin(request)) {
    return NextResponse.json({ error: "Invalid request origin" }, { status: 403 });
  }

  let body: CreateQuestionBody;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { chapterId, questionText, options, correctAnswer, difficulty, explanation, videoUrl, type } = body;

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

  if (!canManageTextbook(user, chapter.textbook.schoolId)) {
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
      videoUrl: videoUrl ?? null,
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
