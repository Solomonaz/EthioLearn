/**
 * Shared validation for AI-generated questions and detected chapters.
 *
 * This is the single source of truth used by every provider (Gemini, Groq,
 * NVIDIA). Previously gemini.ts and groq.ts each held an identical
 * copy of this logic, which could silently drift apart. Centralising it keeps
 * every provider's output held to exactly the same standard.
 */

import type { GeneratedQuestion, DetectedChapter } from "./gemini";
import { sanitizeQuestionText } from "./question-prompts";
import { shuffleArray } from "./utils";
import { normalizeMathText, normalizeOptionSet } from "./math-notation";

/**
 * Accept either a bare array or the `{ "<key>": [...] }` wrapper.
 *
 * The shared question prompt asks for a JSON OBJECT with a "questions" key, and
 * JSON-mode responses often wrap chapter lists the same way. groq.ts and
 * nvidia.ts each unwrapped this at their own call site; gemini.ts and ollama.ts
 * did not, so Gemini failed every generation with "Response is not an array"
 * and retried three times before the chain fell through to Groq — invisible
 * while Gemini sat third in the chain, fatal once it became primary. Unwrapping
 * here means no provider can miss it.
 */
function unwrap(raw: unknown, key: "questions" | "chapters"): unknown {
  if (Array.isArray(raw)) return raw;
  if (raw && typeof raw === "object") {
    const inner = (raw as Record<string, unknown>)[key];
    if (Array.isArray(inner)) return inner;
  }
  return raw;
}

const VALID_TYPES: GeneratedQuestion["type"][] = [
  "MCQ",
  "TRUE_FALSE",
  "FILL_IN_BLANK",
  "MATCH_PAIRS",
  "ORDERING",
];

// Banned "meta" options the models keep emitting despite the prompt ban (Q15):
// "All/None of the above", "Both A and B", "Neither A nor B".
const WEAK_OPTION_PATTERNS = [
  /\b(all|none)\s+of\s+(the\s+)?(above|below|these|options|answers)\b/i,
  /\bboth\s+[a-d]\s+and\s+[a-d]\b/i,
  /\bneither\s+[a-d]\s+nor\s+[a-d]\b/i,
  /\bnone\s+of\s+these\b/i,
];

function isWeakOption(option: string): boolean {
  return WEAK_OPTION_PATTERNS.some((p) => p.test(option));
}

/**
 * The first complete JSON object or array in `text`, found by matching
 * brackets (string-aware), or null. Models sometimes emit valid JSON followed by
 * stray text or a second object — seen 2026-09-23 with GPT-6 Luna: "Unexpected
 * non-whitespace character after JSON at position 532" failed a batch twice and
 * handed it to a 6x pricier fallback, although the JSON itself was fine.
 */
function firstJsonValue(text: string): string | null {
  const start = text.search(/[[{]/);
  if (start < 0) return null;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === "{" || ch === "[") depth++;
    else if (ch === "}" || ch === "]") {
      depth--;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  return null;
}

/**
 * Extract a JSON value from a raw LLM response. Tries a direct parse first,
 * then a fenced ```json code block, then the first complete JSON value (for
 * valid JSON followed by stray text), then the outermost [...] array.
 */
export function extractJson(text: string): unknown {
  // Try direct parse first
  try {
    return JSON.parse(text);
  } catch {
    // Try extracting from markdown code block
    const codeBlockMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (codeBlockMatch) {
      return JSON.parse(codeBlockMatch[1].trim());
    }
    // Valid JSON with something after (or before) it.
    const first = firstJsonValue(text);
    if (first) {
      try {
        return JSON.parse(first);
      } catch {
        /* fall through to the array heuristic */
      }
    }
    // Try extracting array from text
    const arrayMatch = text.match(/\[[\s\S]*\]/);
    if (arrayMatch) {
      return JSON.parse(arrayMatch[0]);
    }
    throw new Error("Could not extract JSON from response");
  }
}

export function validateQuestions(input: unknown): GeneratedQuestion[] {
  const raw = unwrap(input, "questions");
  if (!Array.isArray(raw)) {
    throw new Error("Response is not an array");
  }

  const validated: GeneratedQuestion[] = [];

  for (const item of raw) {
    if (!item || typeof item !== "object") continue;

    const q = item as Record<string, unknown>;

    // Required fields
    if (typeof q.questionText !== "string" || !q.questionText.trim()) continue;
    if (typeof q.correctAnswer !== "string" || !q.correctAnswer.trim()) continue;
    if (!Array.isArray(q.options)) continue;

    // Normalize type
    const rawType = String(q.type).toUpperCase();
    const type: GeneratedQuestion["type"] = (VALID_TYPES as string[]).includes(rawType)
      ? (rawType as GeneratedQuestion["type"])
      : "MCQ";

    // Normalize difficulty
    const diff = String(q.difficulty || "MEDIUM").toUpperCase();
    const difficulty: "EASY" | "MEDIUM" | "HARD" =
      diff === "EASY" ? "EASY" : diff === "HARD" ? "HARD" : "MEDIUM";

    // Simple maths becomes plain Unicode (7⁵, H₂O). Options and answer are
    // converted as one set so they keep matching and keep looking alike.
    const { options, answer: correctAnswer } = normalizeOptionSet(
      q.options.map((o: unknown) => String(o)),
      String(q.correctAnswer).trim()
    );
    let finalOptions = options;

    // Type-specific validation
    if (type === "MCQ") {
      // Drop banned meta options ("None/All of the above", "Both A and B").
      // If the correct answer itself is one of these, the question can't be
      // salvaged, so skip it entirely.
      if (isWeakOption(correctAnswer)) continue;
      finalOptions = options.filter((o) => !isWeakOption(o));
      if (finalOptions.length < 2) continue;
      if (!finalOptions.some((o) => o.toLowerCase() === correctAnswer.toLowerCase())) continue;
    } else if (type === "TRUE_FALSE") {
      if (!["True", "False"].includes(correctAnswer)) continue;
    } else if (type === "MATCH_PAIRS") {
      const numPairs = correctAnswer.split("|").filter(Boolean).length;
      if (options.length !== numPairs * 2 || options.length < 2) continue;
      if (!correctAnswer.includes(":") || !correctAnswer.includes("|")) continue;
    } else if (type === "ORDERING") {
      if (options.length < 2) continue;
      if (!correctAnswer.includes("|")) continue;
    }

    validated.push({
      questionText: normalizeMathText(sanitizeQuestionText(q.questionText)),
      type,
      // Shuffle MCQ options so the correct answer isn't biased toward slot A.
      // Only MCQ — MATCH_PAIRS/ORDERING option order carries meaning.
      options: type === "MCQ" ? shuffleArray(finalOptions) : finalOptions,
      correctAnswer,
      difficulty,
      explanation: typeof q.explanation === "string" ? normalizeMathText(q.explanation.trim()) : "",
    });
  }

  return validated;
}

export function validateDetectedChapters(input: unknown): DetectedChapter[] {
  const raw = unwrap(input, "chapters");
  if (!Array.isArray(raw)) {
    throw new Error("Response is not an array");
  }

  const validated: DetectedChapter[] = [];

  for (const item of raw) {
    if (!item || typeof item !== "object") continue;

    const ch = item as Record<string, unknown>;

    const chapterNumber = Number(ch.chapterNumber);
    if (!chapterNumber || chapterNumber < 1 || chapterNumber > 50) continue;

    if (typeof ch.title !== "string" || !ch.title.trim()) continue;

    validated.push({
      chapterNumber,
      title: ch.title.trim(),
    });
  }

  // Sort by chapter number and re-number sequentially
  validated.sort((a, b) => a.chapterNumber - b.chapterNumber);
  validated.forEach((ch, i) => {
    ch.chapterNumber = i + 1;
  });

  return validated;
}
