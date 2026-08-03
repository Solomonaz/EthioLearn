/**
 * Shared validation for AI-generated questions and detected chapters.
 *
 * This is the single source of truth used by every provider (Gemini, Groq,
 * Cerebras, NVIDIA). Previously gemini.ts and groq.ts each held an identical
 * copy of this logic, which could silently drift apart. Centralising it keeps
 * every provider's output held to exactly the same standard.
 */

import type { GeneratedQuestion, DetectedChapter } from "./gemini";
import { sanitizeQuestionText } from "./question-prompts";
import { shuffleArray } from "./utils";

const VALID_TYPES: GeneratedQuestion["type"][] = [
  "MCQ",
  "TRUE_FALSE",
  "FILL_IN_BLANK",
  "MATCH_PAIRS",
  "ORDERING",
];

/**
 * Extract a JSON value from a raw LLM response. Tries a direct parse first,
 * then a fenced ```json code block, then the outermost [...] array.
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
    // Try extracting array from text
    const arrayMatch = text.match(/\[[\s\S]*\]/);
    if (arrayMatch) {
      return JSON.parse(arrayMatch[0]);
    }
    throw new Error("Could not extract JSON from response");
  }
}

export function validateQuestions(raw: unknown): GeneratedQuestion[] {
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

    const options = q.options.map((o: unknown) => String(o));
    const correctAnswer = String(q.correctAnswer).trim();

    // Type-specific validation
    if (type === "MCQ") {
      if (options.length < 2) continue;
      if (!options.includes(correctAnswer)) {
        const match = options.find((o) => o.toLowerCase() === correctAnswer.toLowerCase());
        if (!match) continue;
      }
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
      questionText: sanitizeQuestionText(q.questionText),
      type,
      // Shuffle MCQ options so the correct answer isn't biased toward slot A.
      // Only MCQ — MATCH_PAIRS/ORDERING option order carries meaning.
      options: type === "MCQ" ? shuffleArray(options) : options,
      correctAnswer,
      difficulty,
      explanation: typeof q.explanation === "string" ? q.explanation.trim() : "",
    });
  }

  return validated;
}

export function validateDetectedChapters(raw: unknown): DetectedChapter[] {
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
