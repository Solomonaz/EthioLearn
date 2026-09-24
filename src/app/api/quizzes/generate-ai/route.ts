import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getCurrentUser } from "@/lib/get-session";
import { rateLimit } from "@/lib/rate-limit";
import { usageActor, withUsageActor } from "@/lib/usage-logger";
import { generateQuestionsBatched, runQualityPipeline, hasBlockingStructuralIssue, generationContentBudget } from "@/lib/ai-provider";
import { normalizeOption, shuffleArray } from "@/lib/utils";
import { getAdaptiveDifficultyInsights, AdaptiveInsights } from "@/lib/adaptive-learning";
import { getEntitlements, UPGRADE_MESSAGES } from "@/lib/entitlements";
import { isAiFeatureEnabled } from "@/lib/platform-settings";
import { isInStudyScope } from "@/lib/grade-scope";
import { selectGenerationContent } from "@/lib/generation-content";
import { avoidList, generationRunIndex, recentChapterQuestions } from "@/lib/question-dedupe";
import {
  bankPoolsFor,
  isChapterSaturated,
  markChapterSaturated,
  roundShowsSaturation,
  type BankQuestion,
} from "@/lib/quiz-selection";
import type { Prisma } from "@prisma/client";

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
      // Only chapter/subject scopes estimate theta; global calibrates from
      // weighted accuracy and baseline from nothing — log what was used.
      const basis =
        adaptiveInsights.theta !== undefined
          ? `theta=${adaptiveInsights.theta.toFixed(2)}`
          : adaptiveInsights.scope === "global"
            ? `accuracy=${Math.round(adaptiveInsights.weightedAccuracy * 100)}% over ${adaptiveInsights.quizzesAnalyzed} quizzes`
            : "no history";
      console.log(`[Adaptive AI] Calibrated difficulty to: ${difficulty} (${adaptiveInsights.scope} scope, ${basis})`);
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
  /** Every chapter this quiz draws from — one, or all of the book's. */
  let scopeChapterIds: string[] = [];

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
    scopeChapterIds = chapters.map((c) => c.id);
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
    scopeChapterIds = [chapter.id];

    // Spend the prompt's character budget across the WHOLE chapter instead of
    // its opening 30k. Rotation advances with the chapter's existing question
    // count so repeated generation sweeps new material each time.
    priorQuestions = await db.question.count({
      where: { chapterId: chapter.id },
    });
    // Content rotation advances by RUN, not by question count — see
    // lib/question-dedupe (generationRunIndex) for why the count failed.
    const runIndex = await generationRunIndex(chapter.id);
    const selected = await selectGenerationContent({
      chapterId: chapter.id,
      fallbackContent: finalContent,
      budgetChars: generationContentBudget(
        Math.min(Math.max(Number(questionCount) || 10, 1), 20) + 3,
        // Chapter length, so a long chapter earns the extra calls needed to
        // cover it instead of being sampled down to the question count.
        finalContent.length
      ),
      rotation: runIndex,
    });
    finalContent = selected.content;
    console.log(
      `[Generate AI] Content strategy: ${selected.strategy} ` +
      `(${selected.chunksUsed}/${selected.chunksAvailable} chunks, run ${runIndex})`
    );
  }

  const count = Math.min(Math.max(Number(questionCount) || 10, 1), 20);
  const validTypes = ["MCQ", "TRUE_FALSE", "FILL_IN_BLANK", "MATCH_PAIRS", "ORDERING"];
  const questionTypes = Array.isArray(body.questionTypes) && body.questionTypes.length > 0
    ? (body.questionTypes.filter((t: string) => validTypes.includes(t)) as ("MCQ" | "TRUE_FALSE" | "FILL_IN_BLANK" | "MATCH_PAIRS" | "ORDERING")[])
    : ["MCQ" as const];

  // 3. Bank first (see lib/quiz-selection). Questions this student has never
  // answered are served before anything is generated — even though they chose
  // AI — and a saturated chapter recycles the ones they saw longest ago.
  const bankWhere: Prisma.QuestionWhereInput = {
    status: "PUBLISHED",
    chapterId: { in: scopeChapterIds },
    type: { in: questionTypes },
    ...(difficulty && difficulty !== "MIXED" ? { difficulty } : {}),
  };
  const pools = await bankPoolsFor(user.id, bankWhere);
  let saturated =
    chapterId !== "all" && !!targetChapterId && (await isChapterSaturated(targetChapterId));
  const fromUnseen = pools.unseen.slice(0, count);
  const recycled: BankQuestion[] = saturated ? pools.seen.slice(0, count - fromUnseen.length) : [];
  const target = count - fromUnseen.length - recycled.length;
  console.log(
    `[Generate AI] Bank: ${pools.unseen.length} unseen, ${pools.seen.length} seen` +
      (saturated ? " (chapter saturated)" : "") +
      ` → serving ${fromUnseen.length} unseen + ${recycled.length} recycled, generating ${target}`
  );

  if (target === 0) return finishQuiz([...fromUnseen, ...recycled], 0);
  if (!finalContent || finalContent.length < 100) {
    if (fromUnseen.length + recycled.length > 0) return finishQuiz([...fromUnseen, ...recycled], 0);
    throw new ApiError("Not enough book content to generate questions.", 400);
  }
  /** Bank questions already in this quiz — a failed generation still serves them. */
  const bankServed = fromUnseen.length + recycled.length;

  // 4. AI Generation — only for what the bank could not supply.
  // ~20% over-generation covers what review drops (typically 0–2 of 13
  // once scope claims stopped counting as factual errors) without paying for
  // questions that are thrown away.
  const genCount = target + Math.max(1, Math.ceil(target * 0.2));

  // What this chapter already has: listed in the prompt so the model writes
  // something new, and passed to the quality pipeline so a repeat is caught.
  const chapterBank = targetChapterId ? await recentChapterQuestions(targetChapterId) : [];
  const bankTexts = chapterBank.map((q) => q.questionText);
  const bankForCheck = chapterBank.map((q) => ({ questionText: q.questionText, correctAnswer: q.correctAnswer }));

  // 3b. Generate → full quality pipeline → keep only clean questions → refill.
  //
  // Students (and battles) get questions nobody reviews, so they go through the
  // SAME pipeline as the admin flow — blind verifier, AI quality checker,
  // duplicate and relevance checks — and anything with an issue is DROPPED
  // rather than flagged. The shortfall is regenerated, telling the model what
  // was already accepted or dropped so it writes something else. Bounded to
  // MAX_GENERATION_ROUNDS so a hard chapter cannot loop forever; whatever
  // passed by then is served.
  //
  // ANSWER_SKEW is the one flag ignored: it is a batch-level note about where
  // correct answers sit, and MCQ options are shuffled when served (step 5).
  type GenQuestion = Awaited<ReturnType<typeof generateQuestionsBatched>>["questions"][number];
  const MAX_GENERATION_ROUNDS = 3; // first attempt + up to 2 refills
  const IGNORED_FLAGS = new Set<string>(["ANSWER_SKEW"]);
  const accepted: { q: GenQuestion; score: number }[] = [];
  const droppedTexts: string[] = [];
  const dropCounts: Record<string, number> = {};
  let lastRound = { generated: 0, unverifiable: 0 };

  for (let round = 0; round < MAX_GENERATION_ROUNDS && accepted.length < target; round++) {
    const shortfall = target - accepted.length;
    // First round keeps the ~20% buffer; refills ask for the shortfall plus 2.
    const ask = round === 0 ? genCount : shortfall + 2;

    onProgress?.({
      step: "generating",
      message:
        round === 0
          ? "Drafting Bloom-aligned questions with AI..."
          : `Replacing ${shortfall} question${shortfall > 1 ? "s" : ""} that failed quality checks...`,
      percent: round === 0 ? 35 : 80,
    });

    let generated: GenQuestion[];
    let provider: string;
    let model: string | null;
    try {
      ({ questions: generated, provider, model } = await generateQuestionsBatched({
        avoidQuestions: avoidList([
          ...accepted.map((a) => a.q.questionText).reverse(),
          ...droppedTexts.slice().reverse(),
          ...bankTexts,
        ]),
        content: finalContent,
        chapterTitle: finalTitle,
        subject: textbook.subject,
        grade: textbook.grade,
        count: ask,
        difficulty: difficulty as any,
        questionTypes: questionTypes as any,
        mode: (mode === "TIMED" || mode === "GROUP" ? mode : "SOLO") as "SOLO" | "TIMED" | "GROUP",
        // Different HARD templates on a refill than on the first attempt.
        variantSeed: priorQuestions + round * 7,
        refill: round > 0,
        onProgress:
          round === 0
            ? (info) => {
                const pct = Math.min(60, Math.round(35 + (info.batchIndex / info.totalBatches) * 25));
                onProgress?.({
                  step: "generating",
                  message: `Drafting questions (batch ${info.batchIndex} of ${info.totalBatches})...`,
                  percent: pct,
                });
              }
            : undefined,
      }));
    } catch (err) {
      // First attempt failing is a real error — unless bank questions are
      // already in the quiz; a failed REFILL still serves what already passed.
      if (round === 0 && bankServed === 0) throw err;
      console.warn(`[Generate AI] Refill round ${round} failed: ${err instanceof Error ? err.message : String(err)}`);
      break;
    }

    onProgress?.({
      step: "verifying",
      message: "Checking every question: blind re-solve, facts, difficulty and scope...",
      percent: round === 0 ? 65 : 85,
    });

    let results: Awaited<ReturnType<typeof runQualityPipeline>>["results"];
    try {
      results = (
        await runQualityPipeline(
          generated,
          finalContent,
          textbook.subject,
          textbook.grade,
          provider,
          // Accepted this run + the chapter's bank, so repeats of either are caught.
          [...accepted.map((a) => a.q).reverse(), ...bankForCheck],
          model
        )
      ).results;
    } catch (err) {
      // Never serve unchecked questions.
      console.warn(`[Generate AI] Quality pipeline failed: ${err instanceof Error ? err.message : String(err)}`);
      if (accepted.length === 0 && bankServed === 0) {
        throw new ApiError(
          "The AI is busy right now and couldn't check the questions. Please try again in a minute.",
          503,
          "VERIFIER_UNAVAILABLE",
          true
        );
      }
      break;
    }

    lastRound = {
      generated: generated.length,
      unverifiable: results.filter((r) => r.flags.includes("UNVERIFIED")).length,
    };

    generated.forEach((q, i) => {
      const r = results[i];
      const issues = (r?.flags ?? ["UNVERIFIED"]).filter((f) => !IGNORED_FLAGS.has(f));
      const clean = !!r?.verified && issues.length === 0 && !hasBlockingStructuralIssue(q);
      if (clean && accepted.length < target) {
        accepted.push({ q, score: r.qualityScore });
      } else if (!clean) {
        droppedTexts.push(q.questionText);
        // The reason is the only way to tell a bad question from an over-strict
        // checker, and it was never surfaced.
        for (const flag of ["FACTUAL_ERROR", "OUT_OF_SCOPE"] as const) {
          if (r?.details?.[flag]) {
            console.info(
              `[Generate AI] Dropped (${flag}): "${q.questionText.slice(0, 100)}" — ${r.details[flag]}`
            );
          }
        }
        for (const f of issues.length ? issues : ["STRUCTURAL"]) dropCounts[f] = (dropCounts[f] ?? 0) + 1;
      }
    });

    console.log(
      `[Generate AI] Round ${round + 1}: ${generated.length} generated, ` +
        `${accepted.length}/${target} accepted so far, dropped: ${JSON.stringify(dropCounts)}`
    );

    // Mostly repeats of the bank: the chapter has run out of new material.
    // Stop paying for rounds that can only produce more duplicates.
    const repeats = results.filter((r) => r.flags.includes("DUPLICATE_EXISTING")).length;
    if (chapterId !== "all" && targetChapterId && roundShowsSaturation(generated.length, repeats)) {
      await markChapterSaturated(targetChapterId);
      saturated = true;
      console.log(
        `[Generate AI] Chapter saturated — ${repeats}/${generated.length} repeated the bank; recycling seen questions from now on.`
      );
      break;
    }
  }

  // Saturated with a shortfall left: fill it with what the student saw
  // longest ago rather than serving a short quiz.
  if (saturated && accepted.length < target) {
    const already = new Set(recycled.map((q) => q.id));
    recycled.push(
      ...pools.seen.filter((q) => !already.has(q.id)).slice(0, target - accepted.length)
    );
  }

  if (accepted.length === 0 && fromUnseen.length + recycled.length === 0) {
    const providersUnavailable = lastRound.unverifiable > lastRound.generated / 2;
    console.warn(
      `[Generate AI] 0 questions passed after ${MAX_GENERATION_ROUNDS} round(s) — dropped: ${JSON.stringify(dropCounts)}`
    );
    if (providersUnavailable) {
      throw new ApiError(
        "The AI is busy right now and couldn't double-check the questions. Please try again in a minute.",
        503,
        "VERIFIER_UNAVAILABLE",
        true
      );
    }
    throw new ApiError(
      "Couldn't build questions that passed our accuracy check for this chapter. " +
        "It may have too little content — try another chapter, or a different question type.",
      502,
      "NO_QUESTIONS_PASSED_REVIEW",
      false
    );
  }
  if (fromUnseen.length + recycled.length + accepted.length < count) {
    console.warn(
      `[Generate AI] Serving ${fromUnseen.length + recycled.length + accepted.length}/${count} — ` +
        `the rest failed quality checks after ${MAX_GENERATION_ROUNDS} round(s).`
    );
  }

  const aiQuestions = accepted.map((a) => a.q);
  const scoreByText = new Map(accepted.map((a) => [a.q.questionText, a.score]));

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
          // The pipeline's own score, not a blanket 1.0.
          qualityScore: scoreByText.get(q.questionText) ?? 1.0,
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

  return finishQuiz(
    [...fromUnseen, ...recycled, ...existingQuestions, ...newlyCreatedQuestions],
    newlyCreatedQuestions.length
  );

  /**
   * Create the quiz session and its response. Order is shuffled so recycled,
   * unseen and freshly generated questions are mixed, not served in blocks.
   */
  async function finishQuiz(
    questions: Pick<BankQuestion, "id" | "questionText" | "options" | "type" | "difficulty">[],
    generatedCount: number
  ) {
    // By id: a generated question whose text matched a bank row resolves to
    // that row, which may already be in the quiz as an unseen pick.
    const allQuizQuestions = shuffleArray([...new Map(questions.map((q) => [q.id, q])).values()]);

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
      /** Where the questions came from, for the UI and for cost tracking. */
      sources: {
        unseen: fromUnseen.length,
        recycled: recycled.length,
        generated: generatedCount,
      },
      shortfallReason:
        allQuizQuestions.length < count
          ? "Some generated questions didn't pass our accuracy check and were left out."
          : undefined,
    };
  }
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

      // Attribute every model call in this generation (questions, verifier,
      // dedup) to the student who asked for it.
      const result = await withUsageActor(usageActor(user), () =>
        runGeneration(user, body, (progress) => {
          emit("progress", progress);
        })
      );

      emit("complete", result);
    });
  }

  // Non-streaming fallback
  try {
    const result = await withUsageActor(usageActor(user), () => runGeneration(user, body));
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
