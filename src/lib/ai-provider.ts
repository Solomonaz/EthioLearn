/**
 * Unified AI provider entry points: question generation, chapter detection and
 * the tutor chat. Which provider and model serves each one is decided per task
 * by lib/ai-routing (configured in Admin -> AI Models); this file only supplies
 * the provider-specific call for each step.
 *
 * Usage:
 *   import { generateQuestions, detectChapters } from "@/lib/ai-provider";
 *   // Same interfaces as gemini.ts — drop-in replacement
 */

import {
  generateQuestionsFromContent,
  detectChaptersFromContent,
  splitTextByChapters,
  tutorResponseFromContent,
} from "./gemini";
import { groqGenerateQuestions, groqDetectChapters, groqTutorChatResponse } from "./groq";
import { nvidiaGenerateQuestions, nvidiaDetectChapters, nvidiaTutorChat } from "./nvidia";
import { QUESTION_CONTENT_CHARS } from "./question-prompts";
import type { UsageActor } from "./usage-logger";
import { ollamaGenerateQuestions, ollamaDetectChapters } from "./ollama";
import { openRouterGenerateQuestions, openRouterDetectChapters } from "./openrouter";
import { runTask, getTaskChain, type ProviderName } from "./ai-routing";
import { avoidList, AVOID_LIST_SIZE } from "./question-dedupe";

import type {
  GenerateOptions,
  GeneratedQuestion,
  DetectChaptersOptions,
  DetectedChapter,
  DetectedChapterWithContent,
} from "./gemini";

// Re-export types and splitTextByChapters (no AI, purely deterministic)
export type {
  GenerateOptions,
  GeneratedQuestion,
  DetectChaptersOptions,
  DetectedChapter,
  DetectedChapterWithContent,
};
export { splitTextByChapters };

// Re-export new modules for convenient access
export { chunkContent, chunkChapters } from "./content-chunker";
export type { ContentChunk } from "./content-chunker";
export { tagChunksWithBloomLevel, tagQuestionBloomLevel } from "./bloom-tagger";
export type { BloomLevel, BloomTagResult } from "./bloom-tagger";
export { runQualityPipeline, verifyQuestions, hasBlockingStructuralIssue, passesAutoServe } from "./quality-pipeline";
export type { QualityResult, QualityPipelineResult, QualityFlag, VerifyResult } from "./quality-pipeline";

// ─── Per-task routing ───────────────────────────────────
//
// Order and model ids come from the DATABASE, per task (see lib/ai-routing and
// lib/ai-tasks), not from a sequence of `if` blocks. That is what lets an admin
// run question generation on one provider and the tutor on another, demote a
// provider whose daily quota just ran out, or repoint a retired model id —
// without a code change or a deploy.

export type { ProviderName };

// ─── Generate Questions ─────────────────────────────────
//
// Default chain: GPT-6 Luna (OpenRouter) → Gemini → Groq → NVIDIA → Ollama —
// see lib/ai-tasks. `model` is the model that actually served, so the answer
// verifier can avoid re-checking a question with the model that wrote it.

export async function generateQuestions(
  opts: GenerateOptions
): Promise<{ questions: GeneratedQuestion[]; provider: ProviderName; model: string | null }> {
  const { value, provider, model } = await runTask("question-generation", {
    GEMINI: () => generateQuestionsFromContent(opts),
    GROQ: () => groqGenerateQuestions(opts),
    NVIDIA: () => nvidiaGenerateQuestions(opts),
    OPENROUTER: () => openRouterGenerateQuestions(opts),
    OLLAMA: () => ollamaGenerateQuestions(opts),
  });
  return { questions: value, provider, model };
}

// ─── Batched question generation ────────────────────────
//
// A single large request (e.g. 20 questions from a full chapter) becomes one
// ~20K-token call: NVIDIA is slow enough to hit its 60s timeout, and the smaller
// free tiers (Groq's 12K TPM) reject it outright.
// Splitting into small batches keeps every provider call fast and within limits,
// and returns whatever succeeded even if one batch fails.
const QUESTION_BATCH_SIZE = 5;
/**
 * Chars of chapter text sent with ONE batch. ~2,250 tokens, so six sequential
 * batches stay inside the tightest free-tier per-minute budget (Groq 12K).
 */
const CONTENT_CHARS_PER_BATCH = 9000;

/**
 * Ceiling on how many sequential provider calls one generation may make.
 *
 * Batches run one after another, so this is a latency and cost bound as much as
 * a safety one: 12 calls at roughly 15s each is about three minutes, and
 * 12 x 9,000 = 108,000 chars of coverage, comfortably more than any real
 * chapter. A chapter longer than that is sampled rather than read whole, and
 * the log line below says so instead of leaving it invisible.
 */
const MAX_QUESTION_BATCHES = 12;

/**
 * Large-context providers (Gemini, OpenRouter models) do not need the small
 * batches above, which exist for Groq's 12K-TPM free tier and NVIDIA's timeout.
 * Measured 2026-09-23: 5 questions from a 44K-char chapter took 5 calls of ONE
 * question each, and every call re-sent the ~6K-token rulebook — so the rules
 * cost 5x and the run took 60s. When the first step of the question-generation
 * chain is one of these, batches are merged up to these limits instead.
 */
const LARGE_CONTEXT_PROVIDERS = new Set(["GEMINI", "OPENROUTER"]);
const LARGE_BATCH_QUESTIONS = 10;
/** One call's chapter text — the prompt builder's own cap, so nothing is cut. */
const LARGE_BATCH_CHARS = QUESTION_CONTENT_CHARS;

/**
 * How many provider calls `generateQuestionsBatched` will make.
 *
 * Batch count used to derive from the question count ALONE, which quietly tied
 * how much of a chapter was read to how many questions someone happened to ask
 * for: 10 questions meant 2 calls meant 18,000 chars, so a 44,000-char chapter
 * was 41% examined and nothing reported the other 59%. Passing `contentChars`
 * makes length a first-class input, so a long chapter gets the calls it needs
 * to be covered whatever the question count.
 *
 * Bounded on both sides: never fewer calls than the question count requires,
 * and never more than there are questions to fill them (a batch that generates
 * nothing is a wasted call) or `MAX_QUESTION_BATCHES`.
 */
export function batchCountFor(count: number, contentChars?: number): number {
  const total = Math.max(1, count);
  const byCount = Math.max(1, Math.ceil(total / QUESTION_BATCH_SIZE));
  if (!contentChars || contentChars <= 0) return byCount;

  const byLength = Math.max(1, Math.ceil(contentChars / CONTENT_CHARS_PER_BATCH));
  const ceiling = Math.min(total, MAX_QUESTION_BATCHES);
  return Math.min(Math.max(byCount, byLength), ceiling);
}

/**
 * How much chapter text to SELECT for a request of `count` questions.
 *
 * Callers used to pass a flat QUESTION_CONTENT_CHARS (30,000) — the budget for
 * a SINGLE prompt — and then hand the result to `generateQuestionsBatched`,
 * which splits it across N calls. That applied the cap at the wrong level: a
 * 30-question request makes six calls able to carry 54,000 chars in total, yet
 * two thirds of the chapter had already been discarded before batching.
 *
 * Measured on Grade 12 Physics Unit 1 (16 chunks): the flat cap sent 9 of 16
 * chunks, so the stethoscope, vocal cords, neurons, Pascal's principle and the
 * ultrasound echo terms were absent from every prompt — the model could not
 * have asked about them. Budgeting per call instead lets all 16 through.
 */
export function generationContentBudget(count: number, contentChars?: number): number {
  const batches = batchCountFor(count, contentChars);
  // One call is capped by the prompt builder itself, not by batching.
  if (batches === 1) return QUESTION_CONTENT_CHARS;
  // Multiple calls: budget EXACTLY what they can carry. Selecting more than
  // that is worse than useless — the windowing below slices each window down
  // to CONTENT_CHARS_PER_BATCH and drops the remainder, which always falls at
  // the END of a window, so the tail of every section is what goes missing.
  return batches * CONTENT_CHARS_PER_BATCH;
}

export async function generateQuestionsBatched(
  opts: GenerateOptions & {
    onProgress?: (info: { batchIndex: number; totalBatches: number; questionsSoFar: number }) => void;
    /**
     * A top-up for questions that failed review. Coverage was already paid for
     * by the first round, so a refill makes only as many calls as its question
     * count needs, over one randomly placed stretch of the chapter. Without
     * this, replacing 5 questions of a long chapter made 4 calls of 1–2
     * questions, each re-sending ~12K prompt tokens.
     */
    refill?: boolean;
  }
): Promise<{ questions: GeneratedQuestion[]; provider: ProviderName; model: string | null }> {
  const total = Math.max(1, opts.count ?? 10);
  let content = opts.content ?? "";

  const lead = (await getTaskChain("question-generation"))[0];
  const large = !!lead && LARGE_CONTEXT_PROVIDERS.has(lead.provider);

  if (opts.refill && content.length > 0) {
    const perCall = large ? LARGE_BATCH_QUESTIONS : QUESTION_BATCH_SIZE;
    const reach = Math.ceil(total / perCall) * (large ? LARGE_BATCH_CHARS : CONTENT_CHARS_PER_BATCH);
    if (content.length > reach) {
      const start = Math.floor(Math.random() * content.length);
      content = (content.slice(start) + "\n\n" + content.slice(0, start)).slice(0, reach);
      opts = { ...opts, content };
    }
  }

  // Batch count follows CHAPTER LENGTH as well as question count, so how much
  // of a chapter gets read no longer depends on how many questions someone
  // asked for. See `batchCountFor`.
  let numBatches = batchCountFor(total, content.length);

  // Merge into fewer, larger calls when the provider that will serve them can
  // take it (see LARGE_CONTEXT_PROVIDERS). Coverage is unchanged: the merged
  // windows still carry the whole selected content.
  if (large) {
    numBatches = Math.min(
      numBatches,
      Math.max(Math.ceil(total / LARGE_BATCH_QUESTIONS), Math.ceil(content.length / LARGE_BATCH_CHARS))
    );
  }

  // One call is not a degenerate batch: the prompt builder carries
  // QUESTION_CONTENT_CHARS (30,000), far more than a single batch window
  // (9,000), so splitting here would send LESS of the chapter, not more.
  if (numBatches === 1) {
    const res = await generateQuestions(opts);
    opts.onProgress?.({
      batchIndex: 1,
      totalBatches: 1,
      questionsSoFar: res.questions.length,
    });
    return res;
  }

  // Spread the requested questions evenly over those batches. Deriving the
  // count from length can ask for MORE batches than `total / QUESTION_BATCH_SIZE`
  // would, so batches are no longer uniformly QUESTION_BATCH_SIZE — the
  // remainder is dealt one-per-batch from the front rather than piled onto the
  // last call.
  const base = Math.floor(total / numBatches);
  const remainder = total % numBatches;
  const batches: number[] = Array.from(
    { length: numBatches },
    (_, i) => base + (i < remainder ? 1 : 0)
  );

  // Give each batch a different, capped slice of the chapter so every call
  // sends little text — small enough for the free-tier per-minute token limits
  // (Groq 12K) and fast — and the questions cover the whole chapter
  // instead of all being drawn from the opening pages.
  const canSplit = content.length > 6000;
  const windowSize = canSplit ? Math.ceil(content.length / batches.length) : 0;
  const CONTENT_CAP = large ? LARGE_BATCH_CHARS : CONTENT_CHARS_PER_BATCH;

  // Say out loud how much of the chapter these calls can actually carry. When a
  // chapter is long enough to hit MAX_QUESTION_BATCHES this is the only place
  // that reports the shortfall, which previously passed in silence.
  const reach = Math.min(content.length, numBatches * CONTENT_CAP);
  const coverage = content.length > 0 ? Math.round((reach / content.length) * 100) : 100;
  console.log(
    `[AI Provider] ${total} question(s) over ${numBatches} batch(es); ` +
      `chapter ${content.length.toLocaleString()} chars, ` +
      `reachable ${reach.toLocaleString()} (${coverage}%)` +
      (coverage < 100
        ? ` — capped at MAX_QUESTION_BATCHES=${MAX_QUESTION_BATCHES}; ask for more questions or split the chapter to cover the rest.`
        : "")
  );

  // Run sequentially: firing every batch at once trips the providers' per-minute
  // token caps simultaneously. Spread over time, each small batch succeeds.
  const all: GeneratedQuestion[] = [];
  let usedProvider: ProviderName | undefined;
  let usedModel: string | null = null;
  const servedBy: string[] = [];
  let lastError: unknown = null;

  for (let i = 0; i < batches.length; i++) {
    const sliceContent = (
      canSplit ? content.slice(i * windowSize, (i + 1) * windowSize) || content : content
    ).slice(0, CONTENT_CAP);
    try {
      const { questions, provider, model } = await generateQuestions({
        ...opts,
        content: sliceContent,
        count: batches[i],
        // Each batch leads with a different pair of HARD templates. Without
        // this every batch sends an identical prompt and picks the same one,
        // which is how a chapter ended up with HARD questions that all opened
        // "A student claims that…".
        variantSeed: (opts.variantSeed ?? 0) + i,
        // What this run has already produced leads the avoid list, then what
        // the chapter already had — so batch 2 does not re-ask batch 1.
        avoidQuestions: avoidList(
          [...all.map((q) => q.questionText).reverse(), ...(opts.avoidQuestions ?? [])],
          AVOID_LIST_SIZE
        ),
      });
      all.push(...questions);
      usedProvider ??= provider;
      usedModel ??= model;
      servedBy.push(`${provider}(${model})`);
      opts.onProgress?.({
        batchIndex: i + 1,
        totalBatches: batches.length,
        questionsSoFar: all.length,
      });
    } catch (err) {
      lastError = err;
      console.warn(
        `[AI Provider] A question batch failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  // Return partial results if at least one batch succeeded; only fail hard when
  // every batch failed.
  if (all.length === 0) {
    throw lastError instanceof Error
      ? lastError
      : new Error("All AI providers failed for question generation.");
  }
  if (new Set(servedBy).size > 1) {
    console.log(`[AI Provider] Batches were served by different models: ${servedBy.join(", ")}`);
  }
  return { questions: all.slice(0, total), provider: usedProvider ?? "gemini", model: usedModel };
}

// ─── Detect Chapters ────────────────────────────────────
//
// Chapter detection sends up to 50K chars of content (~12,500 tokens) in one
// call. Default chain keeps NVIDIA last: its Nemotron model was measured
// inventing chapters ("UNIT 5: ???" … "UNIT 18: ???" for a two-unit book), and
// detection feeds chapter creation, so a hallucinated chapter is a corrupt split.

export async function detectChapters(
  opts: DetectChaptersOptions
): Promise<{ chapters: DetectedChapter[]; provider: ProviderName }> {
  const { value, provider } = await runTask("chapter-detection", {
    GEMINI: () => detectChaptersFromContent(opts),
    GROQ: () => groqDetectChapters(opts),
    NVIDIA: () => nvidiaDetectChapters(opts),
    OPENROUTER: () => openRouterDetectChapters(opts),
    OLLAMA: () => ollamaDetectChapters(opts),
  });
  return { chapters: value, provider };
}

// ─── AI Tutor Chat ──────────────────────────────────────
//
// Default chain Groq → Gemini → NVIDIA: the tutor is the one interactive,
// student-facing path in the app, so a fast provider leads. Every step falls
// through on ANY error so the tutor keeps working even if the first two are down.

export async function chatWithTutor(opts: {
  message: string;
  history: { role: "user" | "model"; parts: { text: string }[] }[];
  content: string;
  chapterTitle: string;
  subject: string;
  grade: number;
  /** Who the chat is for, so its token cost lands on that student and school. */
  actor?: UsageActor;
}): Promise<{ response: string; provider: "gemini" | "groq" | "nvidia" }> {
  // History transform shared by the OpenAI-style providers (assistant, not model).
  const chatOpts = {
    message: opts.message,
    history: opts.history.map((h) => ({
      role: h.role === "model" ? ("assistant" as const) : ("user" as const),
      content: h.parts[0].text,
    })),
    content: opts.content,
    chapterTitle: opts.chapterTitle,
    subject: opts.subject,
    grade: opts.grade,
    actor: opts.actor,
  };

  const { value, provider } = await runTask(
    "tutor-chat",
    {
      GROQ: () => groqTutorChatResponse(chatOpts),
      // Gemini uses its native history format (role: "model").
      GEMINI: () => tutorResponseFromContent(opts),
      NVIDIA: () => nvidiaTutorChat(chatOpts),
    },
    // An empty reply is a failure a student would see as a blank bubble.
    { accept: (r) => typeof r === "string" && r.trim().length > 0 }
  );
  return { response: value, provider: provider as "gemini" | "groq" | "nvidia" };
}
