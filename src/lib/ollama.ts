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

const BASE_URL = process.env.OLLAMA_BASE_URL ?? "http://localhost:11434";
export const OLLAMA_CHAT_MODEL = "mistral";

/**
 * Send a prompt to an Ollama chat model and return the raw response text.
 * Forces JSON output mode via Ollama's `format: "json"` flag.
 * Returns null if Ollama is unreachable or returns a non-OK status.
 */
export async function ollamaChat(prompt: string): Promise<string | null> {
  try {
    const res = await fetch(`${BASE_URL}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: OLLAMA_CHAT_MODEL,
        messages: [{ role: "user", content: prompt }],
        format: "json",
        stream: false,
      }),
      signal: AbortSignal.timeout(600_000), // 10 min — local LLMs can be slow on CPU
    });

    if (!res.ok) {
      console.warn(`[Ollama] Chat request failed: ${res.status} ${res.statusText}`);
      return null;
    }

    const data = await res.json() as { message?: { content?: string } };
    return data?.message?.content ?? null;
  } catch (err) {
    console.warn(`[Ollama] Unreachable or timed out: ${err instanceof Error ? err.message : String(err)}`);
    return null;
  }
}

// ─── Question Generation ─────────────────────────────────

function buildQuestionPrompt(opts: GenerateOptions): string {
  const count = opts.count ?? 10;
  const types = opts.questionTypes ?? ["MCQ"];
  const lang = opts.language ?? "en";
  const difficultyInstruction =
    opts.difficulty && opts.difficulty !== "MIXED"
      ? `All questions must be ${opts.difficulty} difficulty.`
      : `Mix difficulties: roughly 30% EASY, 40% MEDIUM, 30% HARD.`;

  return `You are an expert educational content creator specializing in the Ethiopian curriculum.

TASK: Generate exactly ${count} exam questions based on the textbook chapter content provided below.

SUBJECT: ${opts.subject}
GRADE: Grade ${opts.grade}
CHAPTER: ${opts.chapterTitle}
LANGUAGE: ${lang === "en" ? "English" : lang}

RULES:
1. ${difficultyInstruction}
2. Generate a mix of the following types: ${types.join(", ")}.
   - MCQ: complete interrogative questionText, 4 options, correctAnswer = one of the options.
   - TRUE_FALSE: statement as questionText, options=["True","False"], correctAnswer="True" or "False".
   - FILL_IN_BLANK: questionText contains exactly one "_______", correctAnswer = missing word/phrase, options=[].
   - MATCH_PAIRS: options=[A1,A2,B1,B2], correctAnswer="A1:B1|A2:B2".
   - ORDERING: options in random order, correctAnswer="Item1|Item2|Item3".
3. Every question MUST be directly based on the chapter content — do NOT invent facts.
4. Include a clear educational explanation for each answer.
5. Avoid ambiguous or trick questions.

OUTPUT FORMAT: Return ONLY a JSON object with key "questions" containing an array of exactly ${count} objects.
Each object: { "questionText": string, "type": string, "options": string[], "correctAnswer": string, "difficulty": "EASY"|"MEDIUM"|"HARD", "explanation": string }

CHAPTER CONTENT:
"""
${opts.content.slice(0, 30000)}
"""`;
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

    validated.push({
      questionText: String(q.questionText).trim(),
      type: type as GeneratedQuestion["type"],
      options: (q.options as unknown[]).map(String),
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
