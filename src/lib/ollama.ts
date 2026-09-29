/**
 * Shared Ollama helpers — used across bloom-tagger, quality-pipeline, embeddings,
 * and question/chapter generation.
 */

import type {
  GenerateOptions,
  GeneratedQuestion,
  DetectChaptersOptions,
  DetectedChapter,
} from "./gemini";
import { buildQuestionGenerationPrompt, sanitizeQuestionText } from "./question-prompts";
import { shuffleArray } from "./utils";
import { modelIdFor } from "./ai-settings";

const DEFAULT_BASE_URL = "http://localhost:11434";
const BASE_URL = process.env.OLLAMA_BASE_URL?.trim() || DEFAULT_BASE_URL;
const OLLAMA_CHAT_MODEL_FALLBACK = "mistral";
export function ollamaChatModel(): string {
  return modelIdFor("OLLAMA", "chat") ?? OLLAMA_CHAT_MODEL_FALLBACK;
}

/**
 * Whether Ollama should be used as a provider at all.
 * SINGLE SOURCE OF TRUTH — ai-provider, embeddings and quality-pipeline all
 * defer to this rather than re-implementing the check.
 *
 * Local Ollama runs on CPU and is far slower than Groq/Gemini, so it always
 * sits LAST in every chain and never runs in production.
 *
 * Previously enablement was inferred from the URL not being the localhost
 * default — which meant a perfectly normal local setup (Ollama on
 * http://localhost:11434) was the one configuration that silently disabled it.
 * Intent is now explicit: set OLLAMA_ENABLED=true.
 */
export function isOllamaEnabled(): boolean {
  // Local inference is a development convenience — never serve users from it.
  if (process.env.NODE_ENV === "production") return false;

  // Explicit opt-in.
  if (process.env.OLLAMA_ENABLED === "true") return true;

  // Back-compat: pointing the URL at a non-default host was the old opt-in.
  return !!process.env.OLLAMA_BASE_URL && BASE_URL !== DEFAULT_BASE_URL;
}

/**
 * Send a prompt to an Ollama chat model and return the raw response text.
 * Forces JSON output mode via Ollama's `format: "json"` flag.
 * Returns null if Ollama is unreachable or returns a non-OK status.
 *
 * `timeoutMs` defaults to 10 min for heavyweight local generation (questions),
 * but latency-sensitive callers should pass a short value so a slow or hung
 * Ollama can't dominate the pipeline.
 *
 * STREAMING IS REQUIRED, not a nicety. With `stream: false` Ollama sends no
 * response headers until the entire generation is finished, and Node's HTTP
 * client (undici) enforces a 300-second headersTimeout that this code cannot
 * raise through `fetch`. CPU inference on a 7B model routinely exceeds that on
 * a real question-generation prompt, so every such call died at ~307s with an
 * opaque "fetch failed" — while `timeoutMs` (600s) was never reached.
 *
 * Streaming makes headers arrive immediately and then delivers a token at a
 * time, so neither headersTimeout nor the per-chunk bodyTimeout can trip while
 * the model is actively producing output. `timeoutMs` becomes the real limit.
 */
export async function ollamaChat(
  prompt: string,
  timeoutMs = 600_000
): Promise<string | null> {
  try {
    const res = await fetch(`${BASE_URL}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: ollamaChatModel(),
        messages: [{ role: "user", content: prompt }],
        format: "json",
        stream: true,
      }),
      signal: AbortSignal.timeout(timeoutMs),
    });

    if (!res.ok) {
      console.warn(`[Ollama] Chat request failed: ${res.status} ${res.statusText}`);
      return null;
    }
    if (!res.body) {
      console.warn("[Ollama] Chat response had no body.");
      return null;
    }

    // Ollama streams newline-delimited JSON objects, each carrying one token in
    // `message.content`, until an object with `done: true`.
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let content = "";

    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });

      // Keep the trailing partial line in the buffer for the next chunk.
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        try {
          const obj = JSON.parse(trimmed) as {
            message?: { content?: string };
            done?: boolean;
            error?: string;
          };
          if (obj.error) {
            console.warn(`[Ollama] Stream reported an error: ${obj.error}`);
            return null;
          }
          if (obj.message?.content) content += obj.message.content;
        } catch {
          // A malformed line mid-stream isn't fatal — keep reading.
        }
      }
    }

    return content.length > 0 ? content : null;
  } catch (err) {
    console.warn(`[Ollama] Unreachable or timed out: ${err instanceof Error ? err.message : String(err)}`);
    return null;
  }
}

// ─── Question Generation ─────────────────────────────────

function buildQuestionPrompt(opts: GenerateOptions): string {
  // Delegate to the shared prompt builder so every provider uses the
  // same Bloom-aligned difficulty rubric and quality rules.
  return buildQuestionGenerationPrompt(opts, 30000);
}

function validateQuestions(raw: unknown): GeneratedQuestion[] {
  const arr = Array.isArray(raw)
    ? raw
    : (raw as Record<string, unknown>)?.questions;
  if (!Array.isArray(arr)) return [];

  const validTypes = ["MCQ", "TRUE_FALSE", "FILL_IN_BLANK", "MATCH_PAIRS", "ORDERING"];
  const validated: GeneratedQuestion[] = [];

  for (const item of arr) {
    if (!item || typeof item !== "object") continue;
    const q = item as Record<string, unknown>;
    if (typeof q.questionText !== "string" || !q.questionText.trim()) continue;
    if (typeof q.correctAnswer !== "string" || !q.correctAnswer.trim()) continue;
    if (!Array.isArray(q.options)) continue;

    let type = String(q.type ?? "MCQ").toUpperCase();
    if (!validTypes.includes(type)) type = "MCQ";
    const diff = String(q.difficulty ?? "MEDIUM").toUpperCase();
    const difficulty = diff === "EASY" ? "EASY" : diff === "HARD" ? "HARD" : "MEDIUM";

    const options = (q.options as unknown[]).map(String);

    validated.push({
      questionText: sanitizeQuestionText(String(q.questionText)),
      type: type as GeneratedQuestion["type"],
      // Shuffle MCQ options so the correct answer isn't biased toward slot A.
      // Only MCQ — MATCH_PAIRS/ORDERING option order carries meaning.
      options: type === "MCQ" ? shuffleArray(options) : options,
      correctAnswer: String(q.correctAnswer).trim(),
      difficulty: difficulty as GeneratedQuestion["difficulty"],
      explanation: typeof q.explanation === "string" ? q.explanation.trim() : "",
    });
  }
  return validated;
}

export async function ollamaGenerateQuestions(
  opts: GenerateOptions
): Promise<GeneratedQuestion[]> {
  const prompt = buildQuestionPrompt(opts);
  const raw = await ollamaChat(prompt);
  if (!raw) throw new Error("Ollama returned no response for question generation");

  const parsed = JSON.parse(raw);
  const questions = validateQuestions(parsed);
  if (questions.length === 0) throw new Error("Ollama returned no valid questions after validation");
  return questions;
}

// ─── Chapter Detection ───────────────────────────────────

function buildChapterPrompt(opts: DetectChaptersOptions): string {
  const lang = opts.language ?? "en";
  return `You are an expert at analyzing textbook structure for the Ethiopian curriculum.

TASK: Identify ALL chapters or units in the following textbook content.

SUBJECT: ${opts.subject}
GRADE: Grade ${opts.grade}
LANGUAGE: ${lang === "en" ? "English" : lang}

INSTRUCTIONS:
1. Look for the Table of Contents first.
2. Common patterns: "Chapter 1:", "Unit 1:", "CHAPTER ONE", numbered headings, or Amharic "ምዕራፍ".
3. Return ONLY main chapters — not sub-sections.
4. Chapter numbers must start from 1.

OUTPUT FORMAT: Return ONLY a JSON object with key "chapters" containing an array.
Each item: { "chapterNumber": number, "title": string }

TEXTBOOK CONTENT:
"""
${opts.content.slice(0, 30000)}
"""`;
}

export async function ollamaDetectChapters(
  opts: DetectChaptersOptions
): Promise<DetectedChapter[]> {
  const prompt = buildChapterPrompt(opts);
  const raw = await ollamaChat(prompt);
  if (!raw) throw new Error("Ollama returned no response for chapter detection");

  const parsed = JSON.parse(raw);
  const arr = Array.isArray(parsed)
    ? parsed
    : Array.isArray((parsed as Record<string, unknown>)?.chapters)
      ? (parsed as Record<string, unknown>).chapters
      : [];

  const validated: DetectedChapter[] = (arr as unknown[])
    .filter((item): item is Record<string, unknown> => !!item && typeof item === "object")
    .map((item) => ({ chapterNumber: Number(item.chapterNumber), title: String(item.title ?? "").trim() }))
    .filter((c) => c.chapterNumber >= 1 && c.chapterNumber <= 50 && c.title.length > 0);

  validated.sort((a, b) => a.chapterNumber - b.chapterNumber);
  validated.forEach((c, i) => { c.chapterNumber = i + 1; });

  if (validated.length === 0) throw new Error("Ollama could not detect any chapters");
  return validated;
}
