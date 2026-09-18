import Groq from "groq-sdk";
import type {
  GenerateOptions,
  GeneratedQuestion,
  DetectChaptersOptions,
  DetectedChapter,
} from "./gemini";
import { buildQuestionGenerationPrompt } from "./question-prompts";
import { buildTutorSystemPrompt } from "./ai-prompts";
import { extractJson, validateQuestions, validateDetectedChapters } from "./question-validation";
import { logUsage, openAiUsage, type UsageFeature, type UsageActor } from "./usage-logger";

// Re-export the shared validators so NVIDIA can keep importing them
// from "./groq" (their historical import path) without change.
export { extractJson, validateQuestions, validateDetectedChapters };

// ─── Client ─────────────────────────────────────────────

// Configurable via env so the model can be swapped without code changes when
// Groq retires one (they deprecated llama-3.3-70b-versatile). `openai/gpt-oss-20b`
// is a current, fast, general model that fits the free-tier limits.
const GROQ_MODEL = process.env.GROQ_MODEL || "openai/gpt-oss-20b";

// ─── Native Structured Schemas (JSON Schema for Groq) ───

export const GROQ_QUESTION_JSON_SCHEMA = {
  name: "question_batch",
  strict: true,
  schema: {
    type: "object",
    properties: {
      questions: {
        type: "array",
        items: {
          type: "object",
          properties: {
            questionText: { type: "string" },
            type: {
              type: "string",
              enum: ["MCQ", "TRUE_FALSE", "FILL_IN_BLANK", "MATCH_PAIRS", "ORDERING"],
            },
            options: {
              type: "array",
              items: { type: "string" },
            },
            correctAnswer: { type: "string" },
            difficulty: {
              type: "string",
              enum: ["EASY", "MEDIUM", "HARD"],
            },
            explanation: { type: "string" },
          },
          required: [
            "questionText",
            "type",
            "options",
            "correctAnswer",
            "difficulty",
            "explanation",
          ],
          additionalProperties: false,
        },
      },
    },
    required: ["questions"],
    additionalProperties: false,
  },
};

export const GROQ_CHAPTER_JSON_SCHEMA = {
  name: "detected_chapters",
  strict: true,
  schema: {
    type: "object",
    properties: {
      chapters: {
        type: "array",
        items: {
          type: "object",
          properties: {
            chapterNumber: { type: "integer" },
            title: { type: "string" },
          },
          required: ["chapterNumber", "title"],
          additionalProperties: false,
        },
      },
    },
    required: ["chapters"],
    additionalProperties: false,
  },
};

function getGroqClient() {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) {
    throw new Error(
      "GROQ_API_KEY is not configured. Add it to your .env file."
    );
  }
  return new Groq({ apiKey });
}

/**
 * Send a prompt to Groq and return the raw response text (JSON mode).
 * A general-purpose helper mirroring `ollamaChat` so any pipeline can use Groq
 * as a fast primary provider. Returns null if GROQ_API_KEY is missing or the
 * request fails, letting callers fall through to the next provider.
 */
export async function groqChat(
  prompt: string,
  opts: {
    system?: string;
    temperature?: number;
    maxTokens?: number;
    /** Which feature this call serves, for token-usage attribution. Shared
     *  helper across features; defaults to quality-check. */
    feature?: UsageFeature;
    /** Who the call is for, for per-student cost attribution. */
    actor?: UsageActor;
    /** Structured output response format */
    responseFormat?: any;
  } = {}
): Promise<string | null> {
  if (!process.env.GROQ_API_KEY) return null;
  try {
    const client = getGroqClient();
    let completion;
    try {
      completion = await client.chat.completions.create({
        model: GROQ_MODEL,
        messages: [
          ...(opts.system
            ? [{ role: "system" as const, content: opts.system }]
            : []),
          { role: "user", content: prompt },
        ],
        temperature: opts.temperature ?? 0.2,
        max_tokens: opts.maxTokens ?? 4096,
        response_format: opts.responseFormat ?? { type: "json_object" },
      });
    } catch (schemaErr: any) {
      if (opts.responseFormat && opts.responseFormat.type === "json_schema") {
        console.warn(
          "[Groq] json_schema format failed, falling back to json_object:",
          schemaErr?.message || schemaErr
        );
        completion = await client.chat.completions.create({
          model: GROQ_MODEL,
          messages: [
            ...(opts.system
              ? [{ role: "system" as const, content: opts.system }]
              : []),
            { role: "user", content: prompt },
          ],
          temperature: opts.temperature ?? 0.2,
          max_tokens: opts.maxTokens ?? 4096,
          response_format: { type: "json_object" },
        });
      } else {
        throw schemaErr;
      }
    }
    logUsage({ feature: opts.feature ?? "quality-check", provider: "groq", model: GROQ_MODEL, usage: openAiUsage(completion.usage), actor: opts.actor });
    return completion.choices[0]?.message?.content ?? null;
  } catch (err) {
    console.warn(
      `[Groq] Chat request failed: ${err instanceof Error ? err.message : String(err)}`
    );
    return null;
  }
}

// ─── Prompt builders (reuse same prompts as Gemini) ─────

function buildPrompt(opts: GenerateOptions): string {
  // Delegate to the shared prompt builder so every provider uses the same
  // Bloom-aligned rubric, quality rules AND content window (QUESTION_CONTENT_CHARS).
  return buildQuestionGenerationPrompt(opts);
}

export function buildChapterDetectionPrompt(opts: DetectChaptersOptions): string {
  const lang = opts.language ?? "en";

  return `You are an expert at analyzing textbook structure for the Ethiopian curriculum.

TASK: Analyze the following textbook content and identify ALL chapters or units.

SUBJECT: ${opts.subject}
GRADE: Grade ${opts.grade}
LANGUAGE: ${lang === "en" ? "English" : lang}

INSTRUCTIONS:
1. Look for the Table of Contents first — it is the most reliable source for chapter/unit names.
2. If no Table of Contents is found, look for chapter/unit headings throughout the text.
3. Common patterns: "Chapter 1:", "Unit 1:", "CHAPTER ONE", "UNIT ONE", numbered headings like "1.", "1.0", section headers in UPPERCASE, or Amharic equivalents like "ምዕራፍ".
4. Return ONLY main chapters or units — do NOT include sub-sections, sub-topics, or lessons within chapters.
5. Chapter numbers must be sequential starting from 1.
6. Return the exact title as it appears in the textbook.

OUTPUT FORMAT: Return ONLY a JSON array of objects. No markdown, no code fences, no extra text. Each object must have:
- "chapterNumber": number (sequential, starting from 1)
- "title": string (the chapter/unit title as it appears in the book)

TEXTBOOK CONTENT:
"""
${opts.content.slice(0, 30000)}
"""

Identify all chapters/units now as a JSON array.`;
}

// ─── Question Generation ────────────────────────────────

export async function groqGenerateQuestions(
  opts: GenerateOptions
): Promise<GeneratedQuestion[]> {
  const client = getGroqClient();
  const prompt = buildPrompt(opts);

  for (let attempt = 0; attempt < 2; attempt++) {
    let completion;
    try {
      completion = await client.chat.completions.create({
        model: GROQ_MODEL,
        messages: [
          {
            role: "system",
            content:
              "You are an expert educational content creator. Always respond with valid JSON strictly conforming to the requested schema. No markdown, no explanations outside the JSON.",
          },
          { role: "user", content: prompt },
        ],
        temperature: 0.5,
        max_tokens: 4096,
        response_format: {
          type: "json_schema",
          json_schema: GROQ_QUESTION_JSON_SCHEMA,
        } as any,
      });
    } catch (schemaErr: any) {
      // If the model does not support json_schema, gracefully fall back to json_object
      if (String(schemaErr?.message || "").includes("json_schema")) {
        completion = await client.chat.completions.create({
          model: GROQ_MODEL,
          messages: [
            {
              role: "system",
              content:
                "You are an expert educational content creator. Always respond with valid JSON only. No markdown, no explanations outside the JSON.",
            },
            { role: "user", content: prompt },
          ],
          temperature: 0.5,
          max_tokens: 4096,
          response_format: { type: "json_object" },
        });
      } else {
        throw schemaErr;
      }
    }

    logUsage({ feature: "question-generation", provider: "groq", model: GROQ_MODEL, usage: openAiUsage(completion.usage) });
    const text = completion.choices[0]?.message?.content ?? "";

    try {
      const parsed = extractJson(text);
      // Groq with json_schema returns an object { "questions": [...] }, or directly [...]
      const arr = Array.isArray(parsed)
        ? parsed
        : (parsed as Record<string, unknown>).questions;
      const questions = validateQuestions(arr);

      if (questions.length === 0) {
        if (attempt === 0) continue;
        throw new Error("Groq returned no valid questions after validation");
      }

      return questions;
    } catch (e) {
      if (attempt === 1) {
        throw new Error(
          `Failed to parse Groq response: ${e instanceof Error ? e.message : String(e)}`
        );
      }
    }
  }

  throw new Error("Groq question generation failed after 2 attempts");
}

// ─── Chapter Detection ──────────────────────────────────

export async function groqDetectChapters(
  opts: DetectChaptersOptions
): Promise<DetectedChapter[]> {
  const client = getGroqClient();
  const prompt = buildChapterDetectionPrompt(opts);

  for (let attempt = 0; attempt < 2; attempt++) {
    let completion;
    try {
      completion = await client.chat.completions.create({
        model: GROQ_MODEL,
        messages: [
          {
            role: "system",
            content:
              "You are an expert at analyzing textbook structure. Always respond with valid JSON conforming to the schema. No markdown, no explanations outside the JSON.",
          },
          { role: "user", content: prompt },
        ],
        temperature: 0.3,
        max_tokens: 4096,
        response_format: {
          type: "json_schema",
          json_schema: GROQ_CHAPTER_JSON_SCHEMA,
        } as any,
      });
    } catch (schemaErr: any) {
      if (String(schemaErr?.message || "").includes("json_schema")) {
        completion = await client.chat.completions.create({
          model: GROQ_MODEL,
          messages: [
            {
              role: "system",
              content:
                "You are an expert at analyzing textbook structure. Always respond with valid JSON only. No markdown, no explanations outside the JSON.",
            },
            { role: "user", content: prompt },
          ],
          temperature: 0.3,
          max_tokens: 4096,
          response_format: { type: "json_object" },
        });
      } else {
        throw schemaErr;
      }
    }

    logUsage({ feature: "chapter-detection", provider: "groq", model: GROQ_MODEL, usage: openAiUsage(completion.usage) });
    const text = completion.choices[0]?.message?.content ?? "";

    try {
      const parsed = extractJson(text);
      // Groq may wrap in object like { "chapters": [...] }
      const arr = Array.isArray(parsed)
        ? parsed
        : (parsed as Record<string, unknown>).chapters;
      const chapters = validateDetectedChapters(arr);

      if (chapters.length === 0) {
        if (attempt === 0) continue;
        throw new Error(
          "Groq could not detect any chapters in the textbook content"
        );
      }

      return chapters;
    } catch (e) {
      if (attempt === 1) {
        throw new Error(
          `Failed to detect chapters via Groq: ${e instanceof Error ? e.message : String(e)}`
        );
      }
    }
  }

  throw new Error("Groq chapter detection failed after 2 attempts");
}
export async function groqTutorChatResponse(opts: {
  message: string;
  history: { role: "user" | "assistant"; content: string }[];
  content: string;
  chapterTitle: string;
  subject: string;
  grade: number;
  actor?: UsageActor;
}): Promise<string> {
  const client = getGroqClient();

  const systemPrompt = buildTutorSystemPrompt(opts);

  const completion = await client.chat.completions.create({
    model: GROQ_MODEL,
    messages: [
      { role: "system", content: systemPrompt },
      ...opts.history,
      { role: "user", content: opts.message },
    ],
    temperature: 0.7,
    max_tokens: 2048,
  });

  logUsage({ feature: "tutor-chat", provider: "groq", model: GROQ_MODEL, usage: openAiUsage(completion.usage), actor: opts.actor });
  return completion.choices[0]?.message?.content ?? "I apologize, but I'm having trouble responding right now.";
}
