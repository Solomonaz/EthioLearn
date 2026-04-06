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
import { groqGenerateQuestions, groqDetectChapters, groqGenerateVideoScript } from "./groq";

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

// ─── AI Tutor Chat (Gemini → Groq fallback) ─────────────

export async function chatWithTutor(opts: {
  message: string;
  history: { role: "user" | "model"; parts: { text: string }[] }[];
  content: string;
  chapterTitle: string;
  subject: string;
  grade: number;
}): Promise<{ response: string; provider: "gemini" | "groq" }> {
  try {
    const { tutorResponseFromContent } = await import("./gemini");
    const response = await tutorResponseFromContent(opts);
    return { response, provider: "gemini" };
  } catch (err) {
    if (isRateLimitError(err) && hasGroqKey()) {
      console.warn("[AI Provider] Gemini rate-limited (Chat), falling back to Groq…");
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
    }
    throw err;
  }
}

// ─── Video Tutorial Script (Gemini → Groq fallback) ──────

export async function generateVideoTutorial(opts: {
  content: string;
  chapterTitle: string;
  subject: string;
  grade: number;
  topic?: string;
}): Promise<{ script: VideoScript; provider: "gemini" | "groq" }> {
  try {
    const { generateVideoScript } = await import("./gemini");
    const script = await generateVideoScript(opts);
    return { script, provider: "gemini" };
  } catch (err) {
    if (isRateLimitError(err) && hasGroqKey()) {
      console.warn("[AI Provider] Gemini rate-limited (Video), falling back to Groq…");
      const script = await groqGenerateVideoScript(opts);
      return { script, provider: "groq" };
    }
    throw err;
  }
}
