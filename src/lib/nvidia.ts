/**
 * NVIDIA NIM provider — free-tier cloud inference (build.nvidia.com).
 *
 * Uses the OpenAI-compatible REST API via fetch (no extra dependency). Added as
 * an additional fallback: its ~40 RPM free tier (no hard credit cap, no card)
 * is the highest of the free providers, so it survives Gemini/Groq
 * rate limits. Get a free key at https://build.nvidia.com and set NVIDIA_API_KEY
 * (optionally NVIDIA_MODEL) in .env.
 */

import type {
  GenerateOptions,
  GeneratedQuestion,
  DetectChaptersOptions,
  DetectedChapter,
} from "./gemini";
import { buildQuestionGenerationPrompt } from "./question-prompts";
import { buildTutorSystemPrompt } from "./ai-prompts";
import {
  extractJson,
  validateQuestions,
  validateDetectedChapters,
  buildChapterDetectionPrompt,
} from "./groq";
import { logUsage, openAiUsage, type UsageFeature, type UsageActor } from "./usage-logger";

const NVIDIA_BASE_URL = "https://integrate.api.nvidia.com/v1";
// Default NIM model. Override with NVIDIA_MODEL if your account/catalog exposes
// a different set (see https://build.nvidia.com/models).
//
// Was meta/llama-3.3-70b-instruct, which NVIDIA retired on 2026-08-26 and now
// answers 410 Gone — so every question-generation call was failing through this
// provider before finding a fallback.
//
// Chosen by testing the catalogue against the exact call this file makes,
// json_object response_format included:
//   nvidia/nemotron-3-super-120b-a12b      → valid JSON, ~2.7s   ← selected
//   nvidia/llama-3.1-nemotron-70b-instruct → 404, listed but not servable
//   nvidia/nemotron-3.5-lightning-30b-a3b  → emits reasoning text, invalid JSON
//   mistralai/mistral-nemotron             → timed out at 45s
// Re-test with the same criteria if this one is ever retired: the whole chain
// depends on the model honouring JSON mode.
const NVIDIA_MODEL = process.env.NVIDIA_MODEL || "nvidia/nemotron-3-super-120b-a12b";

export function hasNvidiaKey(): boolean {
  return !!process.env.NVIDIA_API_KEY;
}

async function nvidiaChatCompletion(
  messages: { role: "system" | "user" | "assistant"; content: string }[],
  opts: { temperature?: number; maxTokens?: number; jsonMode?: boolean; feature?: UsageFeature; actor?: UsageActor } = {}
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
    usage?: unknown;
  };
  logUsage({
    feature: opts.feature ?? "quality-check",
    provider: "nvidia",
    model: NVIDIA_MODEL,
    usage: openAiUsage(data.usage),
    actor: opts.actor,
  });
  return data.choices?.[0]?.message?.content ?? "";
}

/**
 * Generic JSON chat helper mirroring `groqChat`/`ollamaChat`.
 * Returns null if the key is missing or the request fails, so callers can
 * fall through to the next provider.
 */
export async function nvidiaChat(
  prompt: string,
  opts: {
    system?: string;
    temperature?: number;
    maxTokens?: number;
    feature?: UsageFeature;
    actor?: UsageActor;
    /**
     * Ask for prose instead of JSON. Defaults to JSON so existing callers are
     * unchanged; long-form answers pass false, because a truncated JSON
     * envelope throws away a reply that was otherwise usable.
     */
    jsonMode?: boolean;
  } = {}
): Promise<string | null> {
  if (!hasNvidiaKey()) return null;
  try {
    const messages = [
      ...(opts.system ? [{ role: "system" as const, content: opts.system }] : []),
      { role: "user" as const, content: prompt },
    ];
    return await nvidiaChatCompletion(messages, {
      ...opts,
      jsonMode: opts.jsonMode ?? true,
      feature: opts.feature,
      actor: opts.actor,
    });
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
      { temperature: 0.5, maxTokens: 4096, jsonMode: true, feature: "question-generation" }
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
      { temperature: 0.3, maxTokens: 4096, jsonMode: true, feature: "chapter-detection" }
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
  actor?: UsageActor;
}): Promise<string> {
  const text = await nvidiaChatCompletion(
    [
      { role: "system", content: buildTutorSystemPrompt(opts) },
      ...opts.history,
      { role: "user", content: opts.message },
    ],
    { temperature: 0.7, maxTokens: 2048, jsonMode: false, feature: "tutor-chat", actor: opts.actor }
  );
  return text.trim() || "I apologize, but I'm having trouble responding right now.";
}
