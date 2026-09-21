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
): Promise<{ questions: GeneratedQuestion[]; provider: "gemini" | "nvidia" | "groq" | "ollama" }> {
  // Every provider in the chain falls through to the next on ANY failure —
  // rate-limit OR transient error (500, parse failure, bad key). Failing fast
  // on a non-429 error would waste the configured fallbacks, so the last
  // error is captured and surfaced only if the ENTIRE chain is exhausted.
  let lastError: unknown = null;

  // 1. Gemini — primary; 1M TPM on a billed key.
  if (hasGeminiKey()) {
    try {
      const questions = await generateQuestionsFromContent(opts);
      return { questions, provider: "gemini" };
    } catch (err) {
      lastError = err;
      console.warn(
        `[AI Provider] Gemini failed (${err instanceof Error ? err.message : String(err)}), falling back to Groq…`
      );
    }
  }

  // 2. Groq — fast; small batched requests fit its 12K TPM free tier.
  if (hasGroqKey()) {
    try {
      const questions = await groqGenerateQuestions(opts);
      return { questions, provider: "groq" };
    } catch (err) {
      lastError = err;
      console.warn(
        `[AI Provider] Groq failed (${err instanceof Error ? err.message : String(err)}), falling back to NVIDIA…`
      );
    }
  }

  // 3. NVIDIA NIM — high RPM, no hard cap, but slow; a capacity fallback.
  if (hasNvidiaKey()) {
    try {
      const questions = await nvidiaGenerateQuestions(opts);
      return { questions, provider: "nvidia" };
    } catch (err) {
      lastError = err;
      console.warn(
        `[AI Provider] NVIDIA failed (${err instanceof Error ? err.message : String(err)}), falling back to Ollama Mistral…`
      );
    }
  }

  // 4. Ollama Mistral — local dev only, skipped in production
  if (hasOllama()) {
    try {
      const questions = await ollamaGenerateQuestions(opts);
      console.info("[AI Provider] Used Ollama Mistral for question generation.");
      return { questions, provider: "ollama" };
    } catch (err) {
      lastError = err;
      console.warn(
        `[AI Provider] Ollama failed (${err instanceof Error ? err.message : String(err)}).`
      );
    }
  }

  throw new Error(
    `All AI providers failed for question generation. ` +
    (lastError
      ? `Last error: ${lastError instanceof Error ? lastError.message : String(lastError)}. `
      : "No AI provider is configured. ") +
    "Add a free NVIDIA_API_KEY (https://build.nvidia.com) or GROQ_API_KEY (https://console.groq.com) for more capacity, or wait a moment and try again."
  );
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
): Promise<{ questions: GeneratedQuestion[]; provider: "gemini" | "nvidia" | "groq" | "ollama" }> {
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
  let usedProvider: "gemini" | "nvidia" | "groq" | "ollama" | undefined;
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
): Promise<{ chapters: DetectedChapter[]; provider: "gemini" | "nvidia" | "groq" | "ollama" }> {
  // Same fall-through-on-any-error policy as generateQuestions: a transient
  // (non-429) failure from any provider must not abort the whole chain.
  let lastError: unknown = null;

  // NVIDIA is deliberately NOT tried first for chapter detection, unlike
  // question generation where it remains the primary.
  //
  // The current NIM model (nvidia/nemotron-3-super-120b-a12b) generates
  // questions well but fails this task badly: asked to detect two units it
  // returned malformed JSON AND invented "UNIT 5: ???" … "UNIT 18: ???".
  // Every other servable NIM model tested either 404s or emits reasoning text
  // instead of JSON. Detection feeds chapter creation, so a hallucinated
  // chapter is a corrupt split — and calling it first also burned ~30s per
  // window before falling through. Left last as a desperation fallback only.

  // 1. Gemini — 1M TPM handles large textbook content when available.
  if (hasGeminiKey()) {
    try {
      const chapters = await detectChaptersFromContent(opts);
      return { chapters, provider: "gemini" };
    } catch (err) {
      lastError = err;
      console.warn(
        `[AI Provider] Gemini failed (Chapters: ${err instanceof Error ? err.message : String(err)}), falling back to Groq…`
      );
    }
  }

  // 2. Groq — fast fallback
  if (hasGroqKey()) {
    try {
      const chapters = await groqDetectChapters(opts);
      return { chapters, provider: "groq" };
    } catch (err) {
      lastError = err;
      console.warn(
        `[AI Provider] Groq failed (Chapters: ${err instanceof Error ? err.message : String(err)}), falling back to Ollama Mistral…`
      );
    }
  }

  // 3. NVIDIA — last resort only (see the note at the top of this function:
  //    the available NIM models hallucinate chapters or won't emit JSON).
  if (hasNvidiaKey()) {
    try {
      const chapters = await nvidiaDetectChapters(opts);
      console.warn(
        "[AI Provider] Chapter detection fell through to NVIDIA — verify the resulting split manually."
      );
      return { chapters, provider: "nvidia" };
    } catch (err) {
      lastError = err;
      console.warn(
        `[AI Provider] NVIDIA failed (Chapters: ${err instanceof Error ? err.message : String(err)}), falling back to Ollama Mistral…`
      );
    }
  }

  // 4. Ollama Mistral — local dev only, skipped in production
  if (hasOllama()) {
    try {
      const chapters = await ollamaDetectChapters(opts);
      console.info("[AI Provider] Used Ollama Mistral for chapter detection.");
      return { chapters, provider: "ollama" };
    } catch (err) {
      lastError = err;
      console.warn(
        `[AI Provider] Ollama failed (Chapters: ${err instanceof Error ? err.message : String(err)}).`
      );
    }
  }

  throw new Error(
    `All AI providers failed for chapter detection. ` +
    (lastError
      ? `Last error: ${lastError instanceof Error ? lastError.message : String(lastError)}. `
      : "No AI provider is configured. ") +
    "Please wait a moment and try again."
  );
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
