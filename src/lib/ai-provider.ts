/**
 * Unified AI provider: Gemini → Cerebras → Groq fallback chain (production).
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

function isRateLimitError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  const msg = err.message.toLowerCase();
  return (
    msg.includes("429") ||
    msg.includes("too many requests") ||
    msg.includes("quota") ||
    msg.includes("rate limit") ||
    msg.includes("resource has been exhausted") ||
    msg.includes("exceeded")
  );
}

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
): Promise<{ questions: GeneratedQuestion[]; provider: "gemini" | "cerebras" | "groq" | "ollama" }> {
  // 1. Gemini — 1M TPM free tier handles large chapter content without rate limits
  if (hasGeminiKey()) {
    try {
      const questions = await generateQuestionsFromContent(opts);
      return { questions, provider: "gemini" };
    } catch (err) {
      if (isRateLimitError(err)) {
        console.warn("[AI Provider] Gemini rate-limited, falling back to Cerebras…");
      } else {
        throw err;
      }
    }
  }

  // 2. Cerebras — fast, separate free-tier quota (survives Gemini exhaustion).
  //    As an optional add-on, ANY failure (rate limit, bad key, parse) falls
  //    through to the next provider rather than aborting the chain.
  if (hasCerebrasKey()) {
    try {
      const questions = await cerebrasGenerateQuestions(opts);
      return { questions, provider: "cerebras" };
    } catch (err) {
      console.warn(
        `[AI Provider] Cerebras failed (${err instanceof Error ? err.message : String(err)}), falling back to Groq…`
      );
    }
  }

  // 3. Groq — fast fallback; may hit 6K TPM with very large chapter content
  if (hasGroqKey()) {
    try {
      const questions = await groqGenerateQuestions(opts);
      return { questions, provider: "groq" };
    } catch (err) {
      if (isRateLimitError(err)) {
        console.warn("[AI Provider] Groq rate-limited, falling back to Ollama Mistral…");
      } else {
        throw err;
      }
    }
  }

  // 4. Ollama Mistral — local dev only, skipped in production
  if (hasOllama()) {
    try {
      const questions = await ollamaGenerateQuestions(opts);
      console.info("[AI Provider] Used Ollama Mistral for question generation.");
      return { questions, provider: "ollama" };
    } catch (err) {
      throw new Error(
        `All AI providers failed. Gemini, Cerebras and Groq are rate-limited, and Ollama returned an error: ${err instanceof Error ? err.message : String(err)}. ` +
        "Ensure Ollama is running with 'mistral' model pulled (ollama pull mistral)."
      );
    }
  }

  throw new Error(
    "All AI providers are rate-limited. Add a free CEREBRAS_API_KEY (https://cloud.cerebras.ai) for more capacity, or wait a moment and try again."
  );
}

// ─── Detect Chapters (Gemini → Cerebras → Groq → Ollama) ─
//
// Same reasoning as generateQuestions: chapter detection sends up to 50K chars
// of content (~12,500 tokens), which alone exceeds Groq's 6K TPM free tier.
// Gemini's 1M TPM handles this comfortably.

export async function detectChapters(
  opts: DetectChaptersOptions
): Promise<{ chapters: DetectedChapter[]; provider: "gemini" | "cerebras" | "groq" | "ollama" }> {
  // 1. Gemini — 1M TPM handles large textbook content without rate limits
  if (hasGeminiKey()) {
    try {
      const chapters = await detectChaptersFromContent(opts);
      return { chapters, provider: "gemini" };
    } catch (err) {
      if (isRateLimitError(err)) {
        console.warn("[AI Provider] Gemini rate-limited (Chapters), falling back to Cerebras…");
      } else {
        throw err;
      }
    }
  }

  // 2. Cerebras — fast, separate free-tier quota. Any failure falls through.
  if (hasCerebrasKey()) {
    try {
      const chapters = await cerebrasDetectChapters(opts);
      return { chapters, provider: "cerebras" };
    } catch (err) {
      console.warn(
        `[AI Provider] Cerebras failed (Chapters: ${err instanceof Error ? err.message : String(err)}), falling back to Groq…`
      );
    }
  }

  // 3. Groq — fast fallback
  if (hasGroqKey()) {
    try {
      const chapters = await groqDetectChapters(opts);
      return { chapters, provider: "groq" };
    } catch (err) {
      if (isRateLimitError(err)) {
        console.warn("[AI Provider] Groq rate-limited (Chapters), falling back to Ollama Mistral…");
      } else {
        throw err;
      }
    }
  }

  // 4. Ollama Mistral — local dev only, skipped in production
  if (hasOllama()) {
    try {
      const chapters = await ollamaDetectChapters(opts);
      console.info("[AI Provider] Used Ollama Mistral for chapter detection.");
      return { chapters, provider: "ollama" };
    } catch (err) {
      throw new Error(
        `All AI providers failed for chapter detection: ${err instanceof Error ? err.message : String(err)}`
      );
    }
  }

  throw new Error(
    "All AI providers failed for chapter detection. Gemini and Groq are both rate-limited. Please wait a moment and try again."
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
}): Promise<{ response: string; provider: "gemini" | "groq" }> {
  // Try Groq first
  if (hasGroqKey()) {
    try {
      const { groqTutorChatResponse } = await import("./groq");

      // Transform history for Groq (assistant instead of model)
      const groqHistory = opts.history.map((h) => ({
        role: h.role === "model" ? ("assistant" as const) : ("user" as const),
        content: h.parts[0].text,
      }));

      const response = await groqTutorChatResponse({
        ...opts,
        history: groqHistory,
      });
      return { response, provider: "groq" };
    } catch (err) {
      if (isRateLimitError(err) && hasGeminiKey()) {
        console.warn("[AI Provider] Groq rate-limited (Chat), falling back to Gemini…");
      } else {
        throw err;
      }
    }
  }
  // Gemini fallback
  const { tutorResponseFromContent } = await import("./gemini");
  const response = await tutorResponseFromContent(opts);
  return { response, provider: "gemini" };
}

// ─── Video Tutorial Script (Groq → Gemini fallback) ──────

export async function generateVideoTutorial(opts: {
  content: string;
  chapterTitle: string;
  subject: string;
  grade: number;
  topic?: string;
}): Promise<{ script: VideoScript; provider: "gemini" | "groq" }> {
  // Try Groq first
  if (hasGroqKey()) {
    try {
      const script = await groqGenerateVideoScript(opts);
      return { script, provider: "groq" };
    } catch (err) {
      if (isRateLimitError(err) && hasGeminiKey()) {
        console.warn("[AI Provider] Groq rate-limited (Video), falling back to Gemini…");
      } else {
        throw err;
      }
    }
  }
  // Gemini fallback
  const { generateVideoScript } = await import("./gemini");
  const script = await generateVideoScript(opts);
  return { script, provider: "gemini" };
}
