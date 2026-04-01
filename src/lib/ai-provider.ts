/**
 * Unified AI provider: tries Gemini first, falls back to Groq on rate-limit (429) errors.
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
import { groqGenerateQuestions, groqDetectChapters } from "./groq";

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

// ─── Generate Questions (Gemini → Groq fallback) ───────

export async function generateQuestions(
  opts: GenerateOptions
): Promise<{ questions: GeneratedQuestion[]; provider: "gemini" | "groq" }> {
  // Try Gemini first
  try {
    const questions = await generateQuestionsFromContent(opts);
    return { questions, provider: "gemini" };
  } catch (err) {
    if (isRateLimitError(err) && hasGroqKey()) {
      console.warn(
        "[AI Provider] Gemini rate-limited, falling back to Groq…"
      );
      const questions = await groqGenerateQuestions(opts);
      return { questions, provider: "groq" };
    }
    // Not a rate limit error or no Groq key — re-throw
    throw err;
  }
}

// ─── Detect Chapters (Gemini → Groq fallback) ──────────

export async function detectChapters(
  opts: DetectChaptersOptions
): Promise<{ chapters: DetectedChapter[]; provider: "gemini" | "groq" }> {
  // Try Gemini first
  try {
    const chapters = await detectChaptersFromContent(opts);
    return { chapters, provider: "gemini" };
  } catch (err) {
    if (isRateLimitError(err) && hasGroqKey()) {
      console.warn(
        "[AI Provider] Gemini rate-limited, falling back to Groq…"
      );
      const chapters = await groqDetectChapters(opts);
      return { chapters, provider: "groq" };
    }
    throw err;
  }
}
