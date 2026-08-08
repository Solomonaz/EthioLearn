/**
 * NVIDIA NIM provider — free-tier cloud inference (build.nvidia.com).
 *
 * Uses the OpenAI-compatible REST API via fetch (no extra dependency). Added as
 * an additional fallback: its ~40 RPM free tier (no hard credit cap, no card)
 * is the highest of the free providers, so it survives Gemini/Cerebras/Groq
 * rate limits. Get a free key at https://build.nvidia.com and set NVIDIA_API_KEY
 * (optionally NVIDIA_MODEL) in .env.
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

const NVIDIA_BASE_URL = "https://integrate.api.nvidia.com/v1";
// Default to a widely-available NIM model. Override with NVIDIA_MODEL if your
// account/catalog exposes a different set (see https://build.nvidia.com/models).
const NVIDIA_MODEL = process.env.NVIDIA_MODEL || "meta/llama-3.3-70b-instruct";

export function hasNvidiaKey(): boolean {
  return !!process.env.NVIDIA_API_KEY;
}

async function nvidiaChatCompletion(
  messages: { role: "system" | "user" | "assistant"; content: string }[],
  opts: { temperature?: number; maxTokens?: number; jsonMode?: boolean } = {}
): Promise<string> {
  const apiKey = process.env.NVIDIA_API_KEY;
  if (!apiKey) throw new Error("NVIDIA_API_KEY is not configured.");

  const res = await fetch(`${NVIDIA_BASE_URL}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: NVIDIA_MODEL,
      messages,
      temperature: opts.temperature ?? 0.5,
      max_tokens: opts.maxTokens ?? 8192,
      ...(opts.jsonMode ? { response_format: { type: "json_object" } } : {}),
    }),
    signal: AbortSignal.timeout(35_000),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`NVIDIA API error ${res.status}: ${body.slice(0, 300)}`);
  }

  const data = (await res.json()) as {
    choices?: { message?: { content?: string } }[];
  };
  return data.choices?.[0]?.message?.content ?? "";
}

/**
 * Generic JSON chat helper mirroring `cerebrasChat`/`groqChat`/`ollamaChat`.
 * Returns null if the key is missing or the request fails, so callers can
 * fall through to the next provider.
 */
export async function nvidiaChat(
  prompt: string,
  opts: { system?: string; temperature?: number; maxTokens?: number } = {}
): Promise<string | null> {
  if (!hasNvidiaKey()) return null;
  try {
    const messages = [
      ...(opts.system ? [{ role: "system" as const, content: opts.system }] : []),
      { role: "user" as const, content: prompt },
    ];
    return await nvidiaChatCompletion(messages, { ...opts, jsonMode: true });
  } catch (err) {
    console.warn(
      `[NVIDIA] Chat request failed: ${err instanceof Error ? err.message : String(err)}`
    );
    return null;
  }
}

// ─── Question Generation ────────────────────────────────

export async function nvidiaGenerateQuestions(
  opts: GenerateOptions
): Promise<GeneratedQuestion[]> {
  const prompt = buildQuestionGenerationPrompt(opts);

  for (let attempt = 0; attempt < 2; attempt++) {
    const text = await nvidiaChatCompletion(
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
        throw new Error("NVIDIA returned no valid questions after validation");
      }
      return questions;
    } catch (e) {
      if (attempt === 1) {
        throw new Error(
          `Failed to parse NVIDIA response: ${e instanceof Error ? e.message : String(e)}`
        );
      }
    }
  }

  throw new Error("NVIDIA question generation failed after 2 attempts");
}

// ─── Chapter Detection ──────────────────────────────────

export async function nvidiaDetectChapters(
  opts: DetectChaptersOptions
): Promise<DetectedChapter[]> {
  const prompt = buildChapterDetectionPrompt(opts);

  for (let attempt = 0; attempt < 2; attempt++) {
    const text = await nvidiaChatCompletion(
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
        throw new Error("NVIDIA could not detect any chapters in the content");
      }
      return chapters;
    } catch (e) {
      if (attempt === 1) {
        throw new Error(
          `Failed to detect chapters via NVIDIA: ${e instanceof Error ? e.message : String(e)}`
        );
      }
    }
  }

  throw new Error("NVIDIA chapter detection failed after 2 attempts");
}

// ─── AI Tutor Chat ──────────────────────────────────────

export async function nvidiaTutorChat(opts: {
  message: string;
  history: { role: "user" | "assistant"; content: string }[];
  content: string;
  chapterTitle: string;
  subject: string;
  grade: number;
}): Promise<string> {
  const text = await nvidiaChatCompletion(
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

export async function nvidiaGenerateVideoScript(opts: {
  content: string;
  chapterTitle: string;
  subject: string;
  grade: number;
  topic?: string;
}): Promise<VideoScript> {
  const text = await nvidiaChatCompletion(
    [{ role: "user", content: buildVideoScriptPrompt(opts) }],
    { temperature: 0.6, maxTokens: 3000, jsonMode: true }
  );
  return parseVideoScript(text);
}
