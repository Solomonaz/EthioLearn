/**
 * Cerebras provider — fast, free-tier cloud inference (Llama 3.3 70B).
 *
 * Uses the OpenAI-compatible REST API via fetch (no extra dependency). Added as
 * an additional fallback so question generation and chapter detection survive
 * Gemini + Groq both being rate-limited. Get a free key at https://cloud.cerebras.ai
 * and set CEREBRAS_API_KEY (optionally CEREBRAS_MODEL) in .env.
 */

import type {
  GenerateOptions,
  GeneratedQuestion,
  DetectChaptersOptions,
  DetectedChapter,
  VideoScript,
} from "./gemini";
import { buildQuestionGenerationPrompt } from "./question-prompts";
import { buildTutorSystemPrompt, buildVideoScriptPrompt, parseVideoScript } from "./ai-prompts";
import {
  extractJson,
  validateQuestions,
  validateDetectedChapters,
  buildChapterDetectionPrompt,
} from "./groq";

const CEREBRAS_BASE_URL = "https://api.cerebras.ai/v1";
// Default to a model that is broadly available on Cerebras accounts. Override
// with CEREBRAS_MODEL if your account exposes a different set (check
// GET https://api.cerebras.ai/v1/models).
const CEREBRAS_MODEL = process.env.CEREBRAS_MODEL || "gpt-oss-120b";

export function hasCerebrasKey(): boolean {
  return !!process.env.CEREBRAS_API_KEY;
}

async function cerebrasChatCompletion(
  messages: { role: "system" | "user" | "assistant"; content: string }[],
  opts: { temperature?: number; maxTokens?: number; jsonMode?: boolean } = {}
): Promise<string> {
  const apiKey = process.env.CEREBRAS_API_KEY;
  if (!apiKey) throw new Error("CEREBRAS_API_KEY is not configured.");

  const res = await fetch(`${CEREBRAS_BASE_URL}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: CEREBRAS_MODEL,
      messages,
      temperature: opts.temperature ?? 0.5,
      max_tokens: opts.maxTokens ?? 8192,
      ...(opts.jsonMode ? { response_format: { type: "json_object" } } : {}),
    }),
    signal: AbortSignal.timeout(60_000),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Cerebras API error ${res.status}: ${body.slice(0, 300)}`);
  }

  const data = (await res.json()) as {
    choices?: { message?: { content?: string } }[];
  };
  return data.choices?.[0]?.message?.content ?? "";
}

/**
 * Generic JSON chat helper mirroring `groqChat`/`ollamaChat`.
 * Returns null if the key is missing or the request fails, so callers can
 * fall through to the next provider.
 */
export async function cerebrasChat(
  prompt: string,
  opts: { system?: string; temperature?: number; maxTokens?: number } = {}
): Promise<string | null> {
  if (!hasCerebrasKey()) return null;
  try {
    const messages = [
      ...(opts.system ? [{ role: "system" as const, content: opts.system }] : []),
      { role: "user" as const, content: prompt },
    ];
    return await cerebrasChatCompletion(messages, { ...opts, jsonMode: true });
  } catch (err) {
    console.warn(
      `[Cerebras] Chat request failed: ${err instanceof Error ? err.message : String(err)}`
    );
    return null;
  }
}

// ─── Question Generation ────────────────────────────────

export async function cerebrasGenerateQuestions(
  opts: GenerateOptions
): Promise<GeneratedQuestion[]> {
  const prompt = buildQuestionGenerationPrompt(opts);

  for (let attempt = 0; attempt < 2; attempt++) {
    const text = await cerebrasChatCompletion(
      [
        {
          role: "system",
          content:
            "You are an expert educational content creator. Always respond with valid JSON only. No markdown, no explanations outside the JSON.",
        },
        { role: "user", content: prompt },
      ],
      { temperature: 0.5, maxTokens: 4096, jsonMode: true }
    );

    try {
      const parsed = extractJson(text);
      const arr = Array.isArray(parsed)
        ? parsed
        : (parsed as Record<string, unknown>).questions;
      const questions = validateQuestions(arr);

      if (questions.length === 0) {
        if (attempt === 0) continue;
        throw new Error("Cerebras returned no valid questions after validation");
      }
      return questions;
    } catch (e) {
      if (attempt === 1) {
        throw new Error(
          `Failed to parse Cerebras response: ${e instanceof Error ? e.message : String(e)}`
        );
      }
    }
  }

  throw new Error("Cerebras question generation failed after 2 attempts");
}

// ─── Chapter Detection ──────────────────────────────────

export async function cerebrasDetectChapters(
  opts: DetectChaptersOptions
): Promise<DetectedChapter[]> {
  const prompt = buildChapterDetectionPrompt(opts);

  for (let attempt = 0; attempt < 2; attempt++) {
    const text = await cerebrasChatCompletion(
      [
        {
          role: "system",
          content:
            "You are an expert at analyzing textbook structure. Always respond with valid JSON only. No markdown, no explanations outside the JSON.",
        },
        { role: "user", content: prompt },
      ],
      { temperature: 0.3, maxTokens: 4096, jsonMode: true }
    );

    try {
      const parsed = extractJson(text);
      const arr = Array.isArray(parsed)
        ? parsed
        : (parsed as Record<string, unknown>).chapters;
      const chapters = validateDetectedChapters(arr);

      if (chapters.length === 0) {
        if (attempt === 0) continue;
        throw new Error("Cerebras could not detect any chapters in the content");
      }
      return chapters;
    } catch (e) {
      if (attempt === 1) {
        throw new Error(
          `Failed to detect chapters via Cerebras: ${e instanceof Error ? e.message : String(e)}`
        );
      }
    }
  }

  throw new Error("Cerebras chapter detection failed after 2 attempts");
}

// ─── AI Tutor Chat ──────────────────────────────────────

export async function cerebrasTutorChat(opts: {
  message: string;
  history: { role: "user" | "assistant"; content: string }[];
  content: string;
  chapterTitle: string;
  subject: string;
  grade: number;
}): Promise<string> {
  const text = await cerebrasChatCompletion(
    [
      { role: "system", content: buildTutorSystemPrompt(opts) },
      ...opts.history,
      { role: "user", content: opts.message },
    ],
    { temperature: 0.7, maxTokens: 2048, jsonMode: false }
  );
  return text.trim() || "I apologize, but I'm having trouble responding right now.";
}

// ─── Video Tutorial Script ──────────────────────────────

export async function cerebrasGenerateVideoScript(opts: {
  content: string;
  chapterTitle: string;
  subject: string;
  grade: number;
  topic?: string;
}): Promise<VideoScript> {
  const text = await cerebrasChatCompletion(
    [{ role: "user", content: buildVideoScriptPrompt(opts) }],
    { temperature: 0.6, maxTokens: 3000, jsonMode: true }
  );
  return parseVideoScript(text);
}
