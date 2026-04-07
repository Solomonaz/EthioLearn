/**
 * Unified AI provider: tries Groq first, falls back to Gemini on rate-limit (429) errors.
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

function hasGeminiKey(): boolean {
  return !!process.env.GEMINI_API_KEY;
}

// ─── Generate Questions (Groq → Gemini fallback) ───────

export async function generateQuestions(
  opts: GenerateOptions
): Promise<{ questions: GeneratedQuestion[]; provider: "gemini" | "groq" }> {
  // Try Groq first
  if (hasGroqKey()) {
    try {
      const questions = await groqGenerateQuestions(opts);
      return { questions, provider: "groq" };
    } catch (err) {
      if (isRateLimitError(err) && hasGeminiKey()) {
        console.warn("[AI Provider] Groq rate-limited, falling back to Gemini…");
      } else {
        throw err;
      }
    }
  }
  // Gemini fallback
  const questions = await generateQuestionsFromContent(opts);
  return { questions, provider: "gemini" };
}

// ─── Detect Chapters (Groq → Gemini fallback) ──────────

export async function detectChapters(
  opts: DetectChaptersOptions
): Promise<{ chapters: DetectedChapter[]; provider: "gemini" | "groq" }> {
  // Try Groq first
  if (hasGroqKey()) {
    try {
      const chapters = await groqDetectChapters(opts);
      return { chapters, provider: "groq" };
    } catch (err) {
      if (isRateLimitError(err) && hasGeminiKey()) {
        console.warn("[AI Provider] Groq rate-limited (Chapters), falling back to Gemini…");
      } else {
        throw err;
      }
    }
  }
  // Gemini fallback
  const chapters = await detectChaptersFromContent(opts);
  return { chapters, provider: "gemini" };
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
