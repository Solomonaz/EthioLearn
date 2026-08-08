/**
 * Unified AI provider: Gemini → Cerebras → NVIDIA → Groq fallback chain (production).
 * Ollama Mistral is available as a local-dev-only tertiary fallback when
 * OLLAMA_BASE_URL is set to a non-localhost address.
 *
 * Usage:
 *   import { generateQuestions, detectChapters } from "@/lib/ai-provider";
 *   // Same interfaces as gemini.ts — drop-in replacement
 */

import {
  generateQuestionsFromContent,
  detectChaptersFromContent,
  splitTextByChapters,
} from "./gemini";
import { groqGenerateQuestions, groqDetectChapters, groqGenerateVideoScript } from "./groq";
import { cerebrasGenerateQuestions, cerebrasDetectChapters, hasCerebrasKey } from "./cerebras";
import { nvidiaGenerateQuestions, nvidiaDetectChapters, hasNvidiaKey } from "./nvidia";
import { ollamaGenerateQuestions, ollamaDetectChapters } from "./ollama";

import type {
  GenerateOptions,
  GeneratedQuestion,
  DetectChaptersOptions,
  DetectedChapter,
  DetectedChapterWithContent,
  VideoScript,
} from "./gemini";

// Re-export types and splitTextByChapters (no AI, purely deterministic)
export type {
  GenerateOptions,
  GeneratedQuestion,
  DetectChaptersOptions,
  DetectedChapter,
  DetectedChapterWithContent,
  VideoScript,
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

// Mirrors the same guard in embeddings.ts and quality-pipeline.ts.
// Ollama is only enabled in local dev when OLLAMA_BASE_URL is explicitly set
// to a non-localhost address. In production this always returns false.
function hasOllama(): boolean {
  return (
    !!process.env.OLLAMA_BASE_URL &&
    process.env.OLLAMA_BASE_URL !== "http://localhost:11434"
  );
}

// ─── Generate Questions (NVIDIA → Gemini → Cerebras → Groq → Ollama) ────────
//
// NVIDIA NIM is primary: it has the highest free-tier RPM and no hard credit
// cap, so it keeps working even when Gemini's free tier returns "limit: 0" 429s
// and Cerebras hits its per-minute token cap on large textbook content. Gemini
// (1M TPM when available) and Cerebras remain high-capacity fallbacks; Groq is a
// fast last resort before local Ollama.

export async function generateQuestions(
  opts: GenerateOptions
): Promise<{ questions: GeneratedQuestion[]; provider: "gemini" | "cerebras" | "nvidia" | "groq" | "ollama" }> {
  // Every provider in the chain falls through to the next on ANY failure —
  // rate-limit OR transient error (500, parse failure, bad key). Failing fast
  // on a non-429 error would waste the configured fallbacks, so the last
  // error is captured and surfaced only if the ENTIRE chain is exhausted.
  let lastError: unknown = null;

  // Ordered for small, batched requests: Cerebras and Groq are fast and reliable
  // for the small per-batch payloads generateQuestionsBatched sends. NVIDIA's
  // 70B model is slow (often times out on real chapter content) so it sits
  // third, and Gemini — currently returning free-tier "limit: 0" 429s — is
  // near the end so it doesn't waste a slot when it's unavailable.

  // 1. Cerebras — fast, separate free-tier quota; best for small batches.
  if (hasCerebrasKey()) {
    try {
      const questions = await cerebrasGenerateQuestions(opts);
      return { questions, provider: "cerebras" };
    } catch (err) {
      lastError = err;
      console.warn(
        `[AI Provider] Cerebras failed (${err instanceof Error ? err.message : String(err)}), falling back to Groq…`
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
        `[AI Provider] NVIDIA failed (${err instanceof Error ? err.message : String(err)}), falling back to Gemini…`
      );
    }
  }

  // 4. Gemini — 1M TPM when available (currently limit: 0 on the free tier).
  if (hasGeminiKey()) {
    try {
      const questions = await generateQuestionsFromContent(opts);
      return { questions, provider: "gemini" };
    } catch (err) {
      lastError = err;
      console.warn(
        `[AI Provider] Gemini failed (${err instanceof Error ? err.message : String(err)}), falling back to Ollama Mistral…`
      );
    }
  }

  // 5. Ollama Mistral — local dev only, skipped in production
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
    "Add a free NVIDIA_API_KEY (https://build.nvidia.com) or CEREBRAS_API_KEY (https://cloud.cerebras.ai) for more capacity, or wait a moment and try again."
  );
}

// ─── Batched question generation ────────────────────────
//
// A single large request (e.g. 20 questions from a full chapter) becomes one
// ~20K-token call: NVIDIA is slow enough to hit its 60s timeout, and the smaller
// free tiers (Groq's 12K TPM, Cerebras's per-minute cap) reject it outright.
// Splitting into small batches keeps every provider call fast and within limits,
// and returns whatever succeeded even if one batch fails.
const QUESTION_BATCH_SIZE = 5;

export async function generateQuestionsBatched(
  opts: GenerateOptions
): Promise<{ questions: GeneratedQuestion[]; provider: "gemini" | "cerebras" | "nvidia" | "groq" | "ollama" }> {
  const total = Math.max(1, opts.count ?? 10);
  if (total <= QUESTION_BATCH_SIZE) return generateQuestions(opts);

  const batches: number[] = [];
  for (let remaining = total; remaining > 0; remaining -= QUESTION_BATCH_SIZE) {
    batches.push(Math.min(QUESTION_BATCH_SIZE, remaining));
  }

  // Give each batch a different, capped slice of the chapter so every call
  // sends little text — small enough for the free-tier per-minute token limits
  // (Groq 12K, Cerebras) and fast — and the questions cover the whole chapter
  // instead of all being drawn from the opening pages.
  const content = opts.content ?? "";
  const canSplit = content.length > 6000;
  const windowSize = canSplit ? Math.ceil(content.length / batches.length) : 0;
  const CONTENT_CAP = 7000; // chars per batch

  // Run sequentially: firing every batch at once trips the providers' per-minute
  // token caps simultaneously. Spread over time, each small batch succeeds.
  const all: GeneratedQuestion[] = [];
  let usedProvider: "gemini" | "cerebras" | "nvidia" | "groq" | "ollama" | undefined;
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
      });
      all.push(...questions);
      usedProvider ??= provider;
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
  return { questions: all.slice(0, total), provider: usedProvider ?? "cerebras" };
}

// ─── Detect Chapters (NVIDIA → Gemini → Cerebras → Groq → Ollama) ─
//
// Same reasoning as generateQuestions: chapter detection sends up to 50K chars
// of content (~12,500 tokens). NVIDIA is primary so a large textbook upload
// doesn't cascade through Gemini's dead free tier and Cerebras's token cap first.

export async function detectChapters(
  opts: DetectChaptersOptions
): Promise<{ chapters: DetectedChapter[]; provider: "gemini" | "cerebras" | "nvidia" | "groq" | "ollama" }> {
  // Same fall-through-on-any-error policy as generateQuestions: a transient
  // (non-429) failure from any provider must not abort the whole chain.
  let lastError: unknown = null;

  // 1. NVIDIA NIM — highest free-tier RPM, no hard credit cap; reliable primary
  //    when Gemini's free tier is unavailable (limit: 0).
  if (hasNvidiaKey()) {
    try {
      const chapters = await nvidiaDetectChapters(opts);
      return { chapters, provider: "nvidia" };
    } catch (err) {
      lastError = err;
      console.warn(
        `[AI Provider] NVIDIA failed (Chapters: ${err instanceof Error ? err.message : String(err)}), falling back to Gemini…`
      );
    }
  }

  // 2. Gemini — 1M TPM handles large textbook content when available.
  if (hasGeminiKey()) {
    try {
      const chapters = await detectChaptersFromContent(opts);
      return { chapters, provider: "gemini" };
    } catch (err) {
      lastError = err;
      console.warn(
        `[AI Provider] Gemini failed (Chapters: ${err instanceof Error ? err.message : String(err)}), falling back to Cerebras…`
      );
    }
  }

  // 3. Cerebras — fast, separate free-tier quota. Any failure falls through.
  if (hasCerebrasKey()) {
    try {
      const chapters = await cerebrasDetectChapters(opts);
      return { chapters, provider: "cerebras" };
    } catch (err) {
      lastError = err;
      console.warn(
        `[AI Provider] Cerebras failed (Chapters: ${err instanceof Error ? err.message : String(err)}), falling back to Groq…`
      );
    }
  }

  // 4. Groq — fast fallback
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

  // 5. Ollama Mistral — local dev only, skipped in production
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

// ─── AI Tutor Chat (Groq → Gemini fallback) ─────────────

export async function chatWithTutor(opts: {
  message: string;
  history: { role: "user" | "model"; parts: { text: string }[] }[];
  content: string;
  chapterTitle: string;
  subject: string;
  grade: number;
}): Promise<{ response: string; provider: "gemini" | "groq" | "cerebras" | "nvidia" }> {
  // Groq (fast) → Gemini → Cerebras → NVIDIA. Every provider falls through on
  // ANY error so the tutor keeps working even if Groq AND Gemini are down —
  // it previously had no capacity fallback beyond those two.
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
  };

  // 1. Groq — fast primary
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
      console.warn(`[AI Provider] Gemini failed (Tutor: ${err instanceof Error ? err.message : String(err)}), falling back to Cerebras…`);
    }
  }

  // 3. Cerebras — capacity fallback
  if (hasCerebrasKey()) {
    try {
      const { cerebrasTutorChat } = await import("./cerebras");
      const response = await cerebrasTutorChat(chatOpts);
      return { response, provider: "cerebras" };
    } catch (err) {
      lastError = err;
      console.warn(`[AI Provider] Cerebras failed (Tutor: ${err instanceof Error ? err.message : String(err)}), falling back to NVIDIA…`);
    }
  }

  // 4. NVIDIA — final capacity fallback
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

// ─── Video Tutorial Script (Groq → Gemini fallback) ──────

export async function generateVideoTutorial(opts: {
  content: string;
  chapterTitle: string;
  subject: string;
  grade: number;
  topic?: string;
}): Promise<{ script: VideoScript; provider: "gemini" | "groq" | "cerebras" | "nvidia" }> {
  // Groq (fast) → Gemini → Cerebras → NVIDIA, falling through on ANY error so
  // a video can still be produced when the first providers are unavailable.
  let lastError: unknown = null;

  // 1. Groq — fast primary
  if (hasGroqKey()) {
    try {
      const script = await groqGenerateVideoScript(opts);
      return { script, provider: "groq" };
    } catch (err) {
      lastError = err;
      console.warn(`[AI Provider] Groq failed (Video: ${err instanceof Error ? err.message : String(err)}), falling back to Gemini…`);
    }
  }

  // 2. Gemini
  if (hasGeminiKey()) {
    try {
      const { generateVideoScript } = await import("./gemini");
      const script = await generateVideoScript(opts);
      return { script, provider: "gemini" };
    } catch (err) {
      lastError = err;
      console.warn(`[AI Provider] Gemini failed (Video: ${err instanceof Error ? err.message : String(err)}), falling back to Cerebras…`);
    }
  }

  // 3. Cerebras — capacity fallback
  if (hasCerebrasKey()) {
    try {
      const { cerebrasGenerateVideoScript } = await import("./cerebras");
      const script = await cerebrasGenerateVideoScript(opts);
      return { script, provider: "cerebras" };
    } catch (err) {
      lastError = err;
      console.warn(`[AI Provider] Cerebras failed (Video: ${err instanceof Error ? err.message : String(err)}), falling back to NVIDIA…`);
    }
  }

  // 4. NVIDIA — final capacity fallback
  if (hasNvidiaKey()) {
    try {
      const { nvidiaGenerateVideoScript } = await import("./nvidia");
      const script = await nvidiaGenerateVideoScript(opts);
      return { script, provider: "nvidia" };
    } catch (err) {
      lastError = err;
      console.warn(`[AI Provider] NVIDIA failed (Video: ${err instanceof Error ? err.message : String(err)}).`);
    }
  }

  throw new Error(
    `All AI providers failed for the video tutorial. ` +
    (lastError
      ? `Last error: ${lastError instanceof Error ? lastError.message : String(lastError)}.`
      : "No AI provider is configured.")
  );
}
