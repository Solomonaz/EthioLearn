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
export { runQualityPipeline } from "./quality-pipeline";
export type { QualityResult, QualityPipelineResult, QualityFlag } from "./quality-pipeline";

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

// ─── Generate Questions (Gemini → Groq → Ollama) ────────
//
// Gemini is primary because its free tier allows 1,000,000 TPM — a single
// generation request (~7,500 input + ~2,000 output tokens) is trivial.
// Groq's free tier is only 6,000 TPM, which a single large-chapter request
// can exceed on its own, causing the rate-limit cascade seen in production.
// Groq remains a fast fallback for when Gemini's 15 RPM ceiling is hit.

export async function generateQuestions(
  opts: GenerateOptions
): Promise<{ questions: GeneratedQuestion[]; provider: "gemini" | "cerebras" | "nvidia" | "groq" | "ollama" }> {
  // Every provider in the chain falls through to the next on ANY failure —
  // rate-limit OR transient error (500, parse failure, bad key). Failing fast
  // on a non-429 error would waste the configured fallbacks, so the last
  // error is captured and surfaced only if the ENTIRE chain is exhausted.
  let lastError: unknown = null;

  // 1. Gemini — 1M TPM free tier handles large chapter content without rate limits
  if (hasGeminiKey()) {
    try {
      const questions = await generateQuestionsFromContent(opts);
      return { questions, provider: "gemini" };
    } catch (err) {
      lastError = err;
      console.warn(
        `[AI Provider] Gemini failed (${err instanceof Error ? err.message : String(err)}), falling back to Cerebras…`
      );
    }
  }

  // 2. Cerebras — fast, separate free-tier quota (survives Gemini exhaustion).
  if (hasCerebrasKey()) {
    try {
      const questions = await cerebrasGenerateQuestions(opts);
      return { questions, provider: "cerebras" };
    } catch (err) {
      lastError = err;
      console.warn(
        `[AI Provider] Cerebras failed (${err instanceof Error ? err.message : String(err)}), falling back to NVIDIA…`
      );
    }
  }

  // 3. NVIDIA NIM — highest free-tier RPM, no hard credit cap; separate quota.
  if (hasNvidiaKey()) {
    try {
      const questions = await nvidiaGenerateQuestions(opts);
      return { questions, provider: "nvidia" };
    } catch (err) {
      lastError = err;
      console.warn(
        `[AI Provider] NVIDIA failed (${err instanceof Error ? err.message : String(err)}), falling back to Groq…`
      );
    }
  }

  // 4. Groq — fast fallback; may hit 6K TPM with very large chapter content
  if (hasGroqKey()) {
    try {
      const questions = await groqGenerateQuestions(opts);
      return { questions, provider: "groq" };
    } catch (err) {
      lastError = err;
      console.warn(
        `[AI Provider] Groq failed (${err instanceof Error ? err.message : String(err)}), falling back to Ollama Mistral…`
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

// ─── Detect Chapters (Gemini → Cerebras → Groq → Ollama) ─
//
// Same reasoning as generateQuestions: chapter detection sends up to 50K chars
// of content (~12,500 tokens), which alone exceeds Groq's 6K TPM free tier.
// Gemini's 1M TPM handles this comfortably.

export async function detectChapters(
  opts: DetectChaptersOptions
): Promise<{ chapters: DetectedChapter[]; provider: "gemini" | "cerebras" | "nvidia" | "groq" | "ollama" }> {
  // Same fall-through-on-any-error policy as generateQuestions: a transient
  // (non-429) failure from any provider must not abort the whole chain.
  let lastError: unknown = null;

  // 1. Gemini — 1M TPM handles large textbook content without rate limits
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

  // 2. Cerebras — fast, separate free-tier quota. Any failure falls through.
  if (hasCerebrasKey()) {
    try {
      const chapters = await cerebrasDetectChapters(opts);
      return { chapters, provider: "cerebras" };
    } catch (err) {
      lastError = err;
      console.warn(
        `[AI Provider] Cerebras failed (Chapters: ${err instanceof Error ? err.message : String(err)}), falling back to NVIDIA…`
      );
    }
  }

  // 3. NVIDIA NIM — highest free-tier RPM, separate quota. Any failure falls through.
  if (hasNvidiaKey()) {
    try {
      const chapters = await nvidiaDetectChapters(opts);
      return { chapters, provider: "nvidia" };
    } catch (err) {
      lastError = err;
      console.warn(
        `[AI Provider] NVIDIA failed (Chapters: ${err instanceof Error ? err.message : String(err)}), falling back to Groq…`
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
