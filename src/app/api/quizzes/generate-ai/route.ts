import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getCurrentUser } from "@/lib/get-session";
import { rateLimit } from "@/lib/rate-limit";
import { generateQuestionsBatched, verifyQuestions, hasBlockingStructuralIssue, generationContentBudget } from "@/lib/ai-provider";
import { normalizeOption, shuffleArray } from "@/lib/utils";
import { getAdaptiveDifficultyInsights, AdaptiveInsights } from "@/lib/adaptive-learning";
import { getEntitlements, UPGRADE_MESSAGES } from "@/lib/entitlements";
import { isAiFeatureEnabled } from "@/lib/platform-settings";
import { isInStudyScope } from "@/lib/grade-scope";
import { selectGenerationContent } from "@/lib/generation-content";

class ApiError extends Error {
  status: number;
  code?: string;
  retryable?: boolean;
  constructor(message: string, status = 400, code?: string, retryable?: boolean) {
    super(message);
    this.status = status;
    this.code = code;
    this.retryable = retryable;
  }
}

export interface GenerationProgress {
  step: "init" | "content" | "generating" | "verifying" | "saving";
  message: string;
  percent: number;
}

/**
 * Core generation runner that can be called synchronously or streamed via SSE.
 */
async function runGeneration(
  user: { id: string; role: string; grade?: number | null },
  body: any,
  onProgress?: (info: GenerationProgress) => void
) {
  let { textbookId, chapterId, difficulty = "MIXED", questionCount = 10, mode = "SOLO", isDailyChallenge = false } = body;

  if (!textbookId) {
    throw new ApiError("Textbook ID is required", 400);
  }

  onProgress?.({
    step: "init",
    message: "Calibrating study scope and difficulty...",
    percent: 10,
  });

  // Resolve Adaptive Difficulty — honour the platform switch. When adaptive is
  // turned off, fall back to a fixed difficulty instead of calibrating.
  let adaptiveInsights: AdaptiveInsights | undefined = undefined;
  if (difficulty === "ADAPTIVE") {
    if (await isAiFeatureEnabled("aiAdaptive")) {
      adaptiveInsights = await getAdaptiveDifficultyInsights(user.id, {
        chapterId: chapterId === "all" ? null : chapterId,
        textbookId,
      });
      difficulty = adaptiveInsights.difficulty;
      console.log(`[Adaptive AI] Calibrated difficulty to: ${difficulty} (${adaptiveInsights.scope} scope, theta=${adaptiveInsights.theta})`);
    } else {
      difficulty = "MEDIUM";
    }
  }

  // 1. Fetch Textbook & Content
  const textbook = await db.textbook.findUnique({
    where: { id: textbookId },
    select: { title: true, subject: true, grade: true, content: true },
  });

  if (!textbook) {
    throw new ApiError("Textbook not found", 404);
  }

  // Grade scoping — same rule as the bank route: a student may only generate
  // from a grade inside their study scope (see lib/grade-scope).
  if (user.role === "STUDENT" && !isInStudyScope(user.grade, textbook.grade)) {
    throw new ApiError("That grade isn't part of your study scope.", 403, "GRADE_OUT_OF_SCOPE");
  }

  onProgress?.({
    step: "content",
    message: "Selecting curriculum passages & chapter content...",
    percent: 25,
  });

  // Also seeds HARD template rotation, so regenerating a chapter varies the
  // question SHAPES as well as the source text it draws from.
  let priorQuestions = 0;
  let finalContent = "";
  let finalTitle = "";
  let targetChapterId: string | null = null;

  // 2. Resolve Content (Chapter or All)
  if (chapterId === "all") {
    const chapters = await db.chapter.findMany({
      where: { textbookId },
      orderBy: { chapterNumber: "asc" },
      select: { id: true, title: true, content: true, chapterNumber: true },
    });

    if (chapters.length === 0) {
      throw new ApiError("No chapters found", 400);
    }

    finalTitle = `All Chapters of ${textbook.title}`;
    finalContent = chapters
      .map((c) => `CHAPTER ${c.chapterNumber}: ${c.title}\n${c.content || ""}`)
      .join("\n\n")
      .slice(0, 80000);

    targetChapterId = chapters[0].id;
  } else {
    const chapter = await db.chapter.findFirst({
      where: { id: chapterId, textbookId },
      select: { id: true, title: true, content: true },
    });

    if (!chapter) {
      throw new ApiError("Chapter not found", 404);
    }
    finalTitle = chapter.title;
    finalContent = chapter.content || textbook.content || "";
    targetChapterId = chapter.id;

    // Spend the prompt's character budget across the WHOLE chapter instead of
    // its opening 30k. Rotation advances with the chapter's existing question
    // count so repeated generation sweeps new material each time.
    priorQuestions = await db.question.count({
      where: { chapterId: chapter.id },
    });
    const selected = await selectGenerationContent({
      chapterId: chapter.id,
      fallbackContent: finalContent,
      budgetChars: generationContentBudget(Math.min(Math.max(Number(questionCount) || 10, 1), 20) + 3),
      rotation: priorQuestions,
    });
    finalContent = selected.content;
    console.log(
      `[Generate AI] Content strategy: ${selected.strategy} ` +
      `(${selected.chunksUsed}/${selected.chunksAvailable} chunks, rotation ${priorQuestions})`
    );
  }

  if (!finalContent || finalContent.length < 100) {
    throw new ApiError("Not enough book content to generate questions.", 400);
  }

  // 3. AI Generation
  const count = Math.min(Math.max(Number(questionCount) || 10, 1), 20);
  const genCount = count + 3;
  const validTypes = ["MCQ", "TRUE_FALSE", "FILL_IN_BLANK", "MATCH_PAIRS", "ORDERING"];
  const questionTypes = Array.isArray(body.questionTypes) && body.questionTypes.length > 0
    ? (body.questionTypes.filter((t: string) => validTypes.includes(t)) as ("MCQ" | "TRUE_FALSE" | "FILL_IN_BLANK" | "MATCH_PAIRS" | "ORDERING")[])
    : ["MCQ" as const];

  onProgress?.({
    step: "generating",
    message: "Drafting Bloom-aligned questions with AI...",
    percent: 35,
  });

  const { questions: rawQuestions, provider } = await generateQuestionsBatched({
    content: finalContent,
    chapterTitle: finalTitle,
    subject: textbook.subject,
    grade: textbook.grade,
    count: genCount,
    difficulty: difficulty as any,
    questionTypes: questionTypes as any,
    mode: (mode === "TIMED" || mode === "GROUP" ? mode : "SOLO") as "SOLO" | "TIMED" | "GROUP",
    variantSeed: priorQuestions,
    onProgress: (info) => {
      const pct = Math.min(70, Math.round(35 + (info.batchIndex / info.totalBatches) * 35));
      onProgress?.({
        step: "generating",
        message: `Drafting questions (batch ${info.batchIndex} of ${info.totalBatches})...`,
        percent: pct,
      });
    },
  });

  // 3b. Independent-solver verification. Students take the test immediately and
  // cannot vet questions themselves, so they are served ONLY verified ones — a
  // second model re-solves each question blind and must agree with the answer
  // key. Rejected/unverified questions are dropped (fail-closed), never served.
  onProgress?.({
    step: "verifying",
    message: "Double-checking questions with independent AI solver...",
    percent: 75,
  });

  const verdicts = await verifyQuestions(
    rawQuestions,
    textbook.subject,
    textbook.grade,
    { avoidProvider: provider }
  );

  const aiQuestions = rawQuestions
    .filter(
      (q, i) =>
        verdicts[i]?.verdict === "verified" && !hasBlockingStructuralIssue(q)
    )
    .slice(0, count);

  if (aiQuestions.length === 0) {
    const unverifiable = verdicts.filter((v) => v?.flag === "UNVERIFIED").length;
    const providersUnavailable = unverifiable > rawQuestions.length / 2;

    console.warn(
      `[Generate AI] 0 of ${rawQuestions.length} questions served — ` +
      `${unverifiable} unverifiable (provider unreachable), ` +
      `${rawQuestions.length - unverifiable} rejected by the solver.`
    );

    if (providersUnavailable) {
      throw new ApiError(
        "The AI is busy right now and couldn't double-check the questions. Please try again in a minute.",
        503,
        "VERIFIER_UNAVAILABLE",
        true
      );
    } else {
      throw new ApiError(
        "Couldn't build questions that passed our accuracy check for this chapter. " +
        "It may have too little content — try another chapter, or a different question type.",
        502,
        "NO_QUESTIONS_PASSED_REVIEW",
        false
      );
    }
  }

  onProgress?.({
    step: "saving",
    message: "Saving verified questions and building quiz session...",
    percent: 90,
  });

  // 4. Save to DB (Filtered by Deduplication)
  const questionTexts = aiQuestions.map((q) => q.questionText);
  const existingQuestions = await db.question.findMany({
    where: {
      chapterId: targetChapterId!,
      questionText: { in: questionTexts },
    },
  });

  const existingTexts = new Set(existingQuestions.map((q) => q.questionText));
  const newQuestionsData = aiQuestions.filter((q) => !existingTexts.has(q.questionText));

  const newlyCreatedQuestions = await Promise.all(
    newQuestionsData.map((q) =>
      db.question.create({
        data: {
          chapterId: targetChapterId!,
          questionText: q.questionText,
          type: q.type as any,
          difficulty: q.difficulty as any,
          options: q.options,
          correctAnswer: q.correctAnswer,
          explanation: q.explanation,
          bloomLevel: (q as any).bloomLevel ?? null,
          qualityScore: 1.0,
          status: "PUBLISHED",
        },
      })
    )
  );

  // Synchronize chapter question count so student-generated questions immediately
  // expand the chapter's question bank, daily challenges, and question badges.
  if (targetChapterId) {
    const totalChapterQuestions = await db.question.count({
      where: { chapterId: targetChapterId, status: "PUBLISHED" },
    });
    await db.chapter.update({
      where: { id: targetChapterId },
      data: { questionCount: totalChapterQuestions },
    });
  }

  const allQuizQuestions = [...existingQuestions, ...newlyCreatedQuestions];

  // 5. Create Quiz Session
  const quiz = await db.quiz.create({
    data: {
      studentId: user.id,
      mode: mode as any,
      isDailyChallenge,
      totalQuestions: allQuizQuestions.length,
    } as any,
  });

  onProgress?.({
    step: "saving",
    message: "Ready!",
    percent: 100,
  });

  return {
    quizId: quiz.id,
    questions: allQuizQuestions.map((q) => {
      const options = (q.options as any[]).map(normalizeOption);
      return {
        id: q.id,
        questionText: q.questionText,
        options: q.type === "MCQ" ? shuffleArray(options) : options,
        type: q.type,
        difficulty: q.difficulty,
      };
    }),
    adaptiveCalibrated: body.difficulty === "ADAPTIVE" ? difficulty : undefined,
    adaptiveInsights: adaptiveInsights
      ? {
          difficulty: adaptiveInsights.difficulty,
          weightedAccuracy: Math.round(adaptiveInsights.weightedAccuracy * 100),
          quizzesAnalyzed: adaptiveInsights.quizzesAnalyzed,
          reasoning: adaptiveInsights.reasoning,
          trend: adaptiveInsights.trend,
          scope: adaptiveInsights.scope,
          theta:
            adaptiveInsights.theta !== undefined
              ? Number(adaptiveInsights.theta.toFixed(2))
              : undefined,
        }
      : undefined,
    requestedQuestions: count,
    deliveredQuestions: allQuizQuestions.length,
    shortfallReason:
      allQuizQuestions.length < count
        ? "Some generated questions didn't pass our accuracy check and were left out."
        : undefined,
  };
}

/**
 * Helper to produce a streaming SSE Response.
 */
function createSseStream(
  runner: (emit: (event: string, data: any) => void) => Promise<void>
) {
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      function emit(event: string, data: any) {
        try {
          controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
        } catch {
          // Client may have aborted the connection
        }
      }

      try {
        await runner(emit);
      } catch (err: any) {
        emit("error", {
          error: err instanceof Error ? err.message : "Failed to generate practice quiz",
          code: err?.code,
          retryable: err?.retryable,
        });
      } finally {
        try {
          controller.close();
        } catch {}
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      "Connection": "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}

export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const ent = await getEntitlements(user);
  if (!ent.ai) {
    return NextResponse.json(
      { error: UPGRADE_MESSAGES.ai, code: "UPGRADE_REQUIRED" },
      { status: 403 }
    );
  }
  if (!(await isAiFeatureEnabled("aiQuizGen"))) {
    return NextResponse.json(
      { error: "AI quiz generation is currently turned off.", code: "AI_DISABLED" },
      { status: 503 }
    );
  }

  // Rate limit: 3 AI generations per minute for students (stricter than admins)
  const rl = rateLimit(`ai:student:gen:${user.id}`, 3, 60_000);
  if (!rl.success) {
    return NextResponse.json(
      { error: "Too many AI generation requests. Please wait a moment." },
      { status: 429, headers: { "Retry-After": String(rl.retryAfter) } }
    );
  }

  let body: any;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const url = new URL(request.url);
  const wantsStream =
    url.searchParams.get("stream") === "true" ||
    request.headers.get("accept")?.includes("text/event-stream");

  if (wantsStream) {
    return createSseStream(async (emit) => {
      emit("progress", {
        step: "init",
        message: "Starting AI quiz generation...",
        percent: 5,
      });

      const result = await runGeneration(user, body, (progress) => {
        emit("progress", progress);
      });

      emit("complete", result);
    });
  }

  // Non-streaming fallback
  try {
    const result = await runGeneration(user, body);
    return NextResponse.json(result);
  } catch (error: any) {
    console.error("[Student AI Generation Error]", error);
    const status = error instanceof ApiError ? error.status : 500;
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Failed to generate practice quiz",
        code: error?.code,
        retryable: error?.retryable,
      },
      {
        status,
        headers: error?.retryable ? { "Retry-After": "60" } : undefined,
      }
    );
  }
}
