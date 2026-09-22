/**
 * Unified AI provider: Gemini → Groq → NVIDIA fallback chain (production).
 * Ollama Mistral is available as a local-dev-only tertiary fallback when
 * OLLAMA_BASE_URL is set to a non-localhost address.
 *
 * Gemini is the primary for the batch/offline tasks — question generation,
 * chapter detection, Bloom tagging, embeddings. The two paths
 * where latency beats capacity keep Groq first: the student-facing tutor chat
 * and the post-generation AI quality checks.
 *
 * Usage:
 *   import { generateQuestions, detectChapters } from "@/lib/ai-provider";
 *   // Same interfaces as gemini.ts — drop-in replacement
 */

import {
  generateQuestionsFromContent,
  detectChaptersFromContent,
  splitTextByChapters,
  geminiChat,
} from "./gemini";
import { groqGenerateQuestions, groqDetectChapters, groqChat } from "./groq";
import { nvidiaGenerateQuestions, nvidiaDetectChapters, hasNvidiaKey, nvidiaChat } from "./nvidia";
import { extractJson } from "./question-validation";
import { QUESTION_CONTENT_CHARS } from "./question-prompts";
import type { UsageActor } from "./usage-logger";
import { ollamaGenerateQuestions, ollamaDetectChapters, isOllamaEnabled } from "./ollama";
import { openRouterGenerateQuestions, openRouterDetectChapters } from "./openrouter";
import { getProviderChain, type AiProviderId } from "./ai-settings";

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
export { runQualityPipeline, verifyQuestions, hasBlockingStructuralIssue } from "./quality-pipeline";
export type { QualityResult, QualityPipelineResult, QualityFlag, VerifyResult } from "./quality-pipeline";

// ─── Dynamic provider chain ─────────────────────────────
//
// Order and model ids come from the DATABASE (see lib/ai-settings), not from
// the sequence of `if` blocks this file used to contain. That is what lets an
// admin demote a provider whose daily quota just ran out, or repoint a retired
// model id, without a code change or a deploy.

/** Provider names as reported to callers and recorded in usage events. */
export type ProviderName = "gemini" | "groq" | "nvidia" | "openrouter" | "ollama";

interface Runner {
  name: ProviderName;
  questions: (o: GenerateOptions) => Promise<GeneratedQuestion[]>;
  chapters: (o: DetectChaptersOptions) => Promise<DetectedChapter[]>;
}

const RUNNERS: Record<AiProviderId, Runner> = {
  GEMINI: { name: "gemini", questions: generateQuestionsFromContent, chapters: detectChaptersFromContent },
  GROQ: { name: "groq", questions: groqGenerateQuestions, chapters: groqDetectChapters },
  NVIDIA: { name: "nvidia", questions: nvidiaGenerateQuestions, chapters: nvidiaDetectChapters },
  OPENROUTER: { name: "openrouter", questions: openRouterGenerateQuestions, chapters: openRouterDetectChapters },
  OLLAMA: { name: "ollama", questions: ollamaGenerateQuestions, chapters: ollamaDetectChapters },
};

/**
 * Providers that must be tried LAST for a given task regardless of the priority
 * an admin set, because they are known to fail that specific task badly.
 *
 * This is not second-guessing the admin — priority still orders everything else.
 * It encodes a measured result: asked to detect two units, the NIM Nemotron
 * model returned malformed JSON and invented "UNIT 5: ???" through
 * "UNIT 18: ???". Detection feeds chapter creation, so a hallucinated chapter
 * is a corrupt split, and that is worth protecting against a well-meaning
 * reordering.
 */
const TASK_DEMOTIONS: Record<"chapters", AiProviderId[]> = {
  chapters: ["NVIDIA"],
};

/**
 * Walk the configured chain until one provider succeeds.
 *
 * Falls through on ANY failure — rate limit, transient 500, parse error, bad
 * key — because failing fast would waste the fallbacks that exist precisely for
 * these cases. The last error is surfaced only once every provider is spent.
 */
async function runChain<T>(
  task: string,
  pick: (r: Runner) => (() => Promise<T>),
  demote: AiProviderId[] = []
): Promise<{ value: T; provider: ProviderName }> {
  let chain = await getProviderChain("chat");

  // Ollama keeps its own production guard: local inference must never serve
  // real users, whatever the database says.
  chain = chain.filter((p) => p.id !== "OLLAMA" || isOllamaEnabled());

  if (demote.length) {
    chain = [
      ...chain.filter((p) => !demote.includes(p.id)),
      ...chain.filter((p) => demote.includes(p.id)),
    ];
  }

  console.log(
    `[AI Provider] ${task} chain: ${chain.map((p) => `${p.id}(${p.models.chat})`).join(" -> ") || "(empty)"}`
  );

  let lastError: unknown = null;
  for (const p of chain) {
    const runner = RUNNERS[p.id];
    try {
      const value = await pick(runner)();
      console.log(`[AI Provider] ${task}: served by ${p.id} (${p.models.chat}).`);
      return { value, provider: runner.name };
    } catch (err) {
      lastError = err;
      console.warn(
        `[AI Provider] ${task}: ${p.id} failed (${err instanceof Error ? err.message : String(err)}) — trying next.`
      );
    }
  }

  throw new Error(
    `All AI providers failed for ${task}. ` +
      (lastError
        ? `Last error: ${lastError instanceof Error ? lastError.message : String(lastError)}. `
        : "No AI provider is enabled, keyed and configured with a model. ") +
      "Check Admin -> AI Models: a provider may be disabled, out of quota, or pointing at a retired model id."
  );
}

// ─── Helpers ────────────────────────────────────────────

function hasGroqKey(): boolean {
  return !!process.env.GROQ_API_KEY;
}

function hasGeminiKey(): boolean {
  return !!process.env.GEMINI_API_KEY;
}

// Enablement lives in lib/ollama (isOllamaEnabled) so there is ONE definition
// instead of four slightly different copies of the same string comparison.
function hasOllama(): boolean {
  return isOllamaEnabled();
}

// ─── Generate Questions (Gemini → Groq → NVIDIA → Ollama) ──────────────────
//
// Cerebras was removed from every chain: its free tier returns 402 Payment
// Required, so it only ever added a failed call and a delay before the real
// provider ran.
//
// Gemini is first: it is the configured primary for every task, and its 1M TPM
// (on a paid key) comfortably absorbs the small per-batch payloads
// generateQuestionsBatched sends. Groq follows as the fast fallback, NVIDIA as
// the high-RPM capacity fallback, then local Ollama in dev. Note that on a FREE
// Gemini key this ordering means every batch pays a failed call and a 429 before
// reaching Groq — set GEMINI_API_KEY to a billed key, or the chain will be
// slower than it was with Groq first.

export async function generateQuestions(
  opts: GenerateOptions
): Promise<{ questions: GeneratedQuestion[]; provider: ProviderName }> {
  const { value, provider } = await runChain(
    "question generation",
    (r) => () => r.questions(opts)
  );
  return { questions: value, provider };
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
  }
): Promise<{ questions: GeneratedQuestion[]; provider: ProviderName }> {
  const total = Math.max(1, opts.count ?? 10);
  const content = opts.content ?? "";

  // Batch count follows CHAPTER LENGTH as well as question count, so how much
  // of a chapter gets read no longer depends on how many questions someone
  // asked for. See `batchCountFor`.
  const numBatches = batchCountFor(total, content.length);

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
  const CONTENT_CAP = CONTENT_CHARS_PER_BATCH;

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
  let lastError: unknown = null;

  for (let i = 0; i < batches.length; i++) {
    const sliceContent = (
      canSplit ? content.slice(i * windowSize, (i + 1) * windowSize) || content : content
    ).slice(0, CONTENT_CAP);
    try {
      const { questions, provider } = await generateQuestions({
        ...opts,
        content: sliceContent,
        count: batches[i],
        // Each batch leads with a different pair of HARD templates. Without
        // this every batch sends an identical prompt and picks the same one,
        // which is how a chapter ended up with HARD questions that all opened
        // "A student claims that…".
        variantSeed: (opts.variantSeed ?? 0) + i,
      });
      all.push(...questions);
      usedProvider ??= provider;
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
  return { questions: all.slice(0, total), provider: usedProvider ?? "gemini" };
}

// ─── Detect Chapters (Gemini → Groq → NVIDIA → Ollama) ─
//
// Same reasoning as generateQuestions: chapter detection sends up to 50K chars
// of content (~12,500 tokens), which Gemini's context handles in one call.

export async function detectChapters(
  opts: DetectChaptersOptions
): Promise<{ chapters: DetectedChapter[]; provider: ProviderName }> {
  // NVIDIA is demoted for this task only — see TASK_DEMOTIONS.
  const { value, provider } = await runChain(
    "chapter detection",
    (r) => () => r.chapters(opts),
    TASK_DEMOTIONS.chapters
  );
  return { chapters: value, provider };
}

// ─── AI Tutor Chat (Groq → Gemini → NVIDIA) ─────────────

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
  // Groq (fast) → Gemini → NVIDIA. The tutor is the one interactive,
  // student-facing path in the app, so it keeps Groq first for latency rather
  // than following the Gemini-first order the batch/offline tasks use. Every
  // provider falls through on ANY error so the tutor keeps working even if
  // Groq AND Gemini are down.
  let lastError: unknown = null;

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

  // 1. Groq — fast primary (latency matters most on this path)
  if (hasGroqKey()) {
    try {
      const { groqTutorChatResponse } = await import("./groq");
      const response = await groqTutorChatResponse(chatOpts);
      return { response, provider: "groq" };
    } catch (err) {
      lastError = err;
      console.warn(`[AI Provider] Groq failed (Tutor: ${err instanceof Error ? err.message : String(err)}), falling back to Gemini…`);
    }
  }

  // 2. Gemini — uses native history format (role: "model")
  if (hasGeminiKey()) {
    try {
      const { tutorResponseFromContent } = await import("./gemini");
      const response = await tutorResponseFromContent(opts);
      return { response, provider: "gemini" };
    } catch (err) {
      lastError = err;
      console.warn(`[AI Provider] Gemini failed (Tutor: ${err instanceof Error ? err.message : String(err)}), falling back to NVIDIA…`);
    }
  }

  // 3. NVIDIA — final capacity fallback
  if (hasNvidiaKey()) {
    try {
      const { nvidiaTutorChat } = await import("./nvidia");
      const response = await nvidiaTutorChat(chatOpts);
      return { response, provider: "nvidia" };
    } catch (err) {
      lastError = err;
      console.warn(`[AI Provider] NVIDIA failed (Tutor: ${err instanceof Error ? err.message : String(err)}).`);
    }
  }

  throw new Error(
    `All AI providers failed for the tutor chat. ` +
    (lastError
      ? `Last error: ${lastError instanceof Error ? lastError.message : String(lastError)}.`
      : "No AI provider is configured.")
  );
}
