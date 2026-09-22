/**
 * OpenRouter provider.
 *
 * One key, one OpenAI-compatible endpoint, hundreds of models — which makes it
 * the cheapest way to TRY a model before committing the system to it. The model
 * id is read from the admin settings at call time rather than from a constant,
 * so swapping `qwen/qwen3.8-27b:free` for something else is a form field, not a
 * deploy.
 *
 * A warning learned by measurement, not from docs: OpenRouter's `:free` model
 * ids are shared capacity. A single request usually succeeds, but question
 * generation issues six to ten calls in a burst and those reliably come back
 * `429 ... temporarily rate-limited upstream`. Treat `:free` as suitable for
 * evaluation and interactive one-shots, not for batch ingestion.
 */

import { buildQuestionGenerationPrompt } from "./question-prompts";
import { extractJson, validateQuestions, validateDetectedChapters } from "./question-validation";
import { buildChapterDetectionPrompt } from "./groq";
import { logUsage, openAiUsage, type UsageActor, type UsageFeature } from "./usage-logger";
import { getModelFor, PROVIDER_META } from "./ai-settings";
import type {
  GenerateOptions,
  GeneratedQuestion,
  DetectChaptersOptions,
  DetectedChapter,
} from "./gemini";

export function hasOpenRouterKey(): boolean {
  return !!process.env.OPENROUTER_API_KEY;
}

function baseUrl(): string {
  return (
    process.env.OPENROUTER_BASE_URL?.trim() ||
    PROVIDER_META.OPENROUTER.defaultBaseUrl ||
    "https://openrouter.ai/api/v1"
  );
}

async function openRouterCompletion(
  messages: { role: "system" | "user" | "assistant"; content: string }[],
  opts: {
    temperature?: number;
    maxTokens?: number;
    jsonMode?: boolean;
    feature?: UsageFeature;
    actor?: UsageActor;
    slot?: "chat" | "fast";
  } = {}
): Promise<string> {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) throw new Error("OPENROUTER_API_KEY is not configured.");

  const model = await getModelFor("OPENROUTER", opts.slot ?? "chat");
  if (!model) throw new Error("No OpenRouter model is configured.");

  const res = await fetch(`${baseUrl()}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
      // OpenRouter attributes traffic with these; harmless if absent.
      "HTTP-Referer": process.env.NEXTAUTH_URL || "http://localhost:3001",
      "X-Title": "EthioLearn",
    },
    body: JSON.stringify({
      model,
      messages,
      temperature: opts.temperature ?? 0.5,
      max_tokens: opts.maxTokens ?? 8192,
      ...(opts.jsonMode ? { response_format: { type: "json_object" } } : {}),
    }),
    // Free-tier routes queue behind other tenants, so this is deliberately
    // longer than NVIDIA's 35s.
    signal: AbortSignal.timeout(120_000),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`OpenRouter API error ${res.status}: ${body.slice(0, 300)}`);
  }

  const data = (await res.json()) as {
    choices?: { message?: { content?: string } }[];
    usage?: unknown;
    model?: string;
  };
  logUsage({
    feature: opts.feature ?? "quality-check",
    provider: "openrouter",
    // Report the id the router actually served, which can differ from the one
    // requested when OpenRouter substitutes a backing provider.
    model: data.model || model,
    usage: openAiUsage(data.usage),
    actor: opts.actor,
  });
  return data.choices?.[0]?.message?.content ?? "";
}

/** Generic JSON chat helper mirroring `groqChat` / `nvidiaChat`. */
export async function openRouterChat(
  prompt: string,
  opts: {
    system?: string;
    temperature?: number;
    maxTokens?: number;
    feature?: UsageFeature;
    actor?: UsageActor;
    jsonMode?: boolean;
    slot?: "chat" | "fast";
  } = {}
): Promise<string | null> {
  if (!hasOpenRouterKey()) return null;
  try {
    return await openRouterCompletion(
      [
        ...(opts.system ? [{ role: "system" as const, content: opts.system }] : []),
        { role: "user" as const, content: prompt },
      ],
      { ...opts, jsonMode: opts.jsonMode ?? true }
    );
  } catch (err) {
    console.warn(
      `[OpenRouter] Chat request failed: ${err instanceof Error ? err.message : String(err)}`
    );
    return null;
  }
}

// ─── Question Generation ────────────────────────────────

export async function openRouterGenerateQuestions(
  opts: GenerateOptions
): Promise<GeneratedQuestion[]> {
  const prompt = buildQuestionGenerationPrompt(opts);

  for (let attempt = 0; attempt < 2; attempt++) {
    const text = await openRouterCompletion(
      [
        {
          role: "system",
          content:
            "You are an expert educational content creator. Always respond with valid JSON only. No markdown, no explanations outside the JSON.",
        },
        { role: "user", content: prompt },
      ],
      { temperature: 0.5, maxTokens: 8192, jsonMode: true, feature: "question-generation" }
    );

    try {
      const parsed = extractJson(text);
      const arr = Array.isArray(parsed)
        ? parsed
        : (parsed as Record<string, unknown>).questions;
      const questions = validateQuestions(arr);
      if (questions.length === 0) {
        if (attempt === 0) continue;
        throw new Error("OpenRouter returned no valid questions after validation");
      }
      return questions;
    } catch (e) {
      if (attempt === 1) {
        throw new Error(
          `Failed to parse OpenRouter response: ${e instanceof Error ? e.message : String(e)}`
        );
      }
    }
  }

  throw new Error("OpenRouter question generation failed after 2 attempts");
}

// ─── Chapter Detection ──────────────────────────────────

export async function openRouterDetectChapters(
  opts: DetectChaptersOptions
): Promise<DetectedChapter[]> {
  const text = await openRouterCompletion(
    [
      {
        role: "system",
        content:
          "You extract chapter structure from textbooks. Always respond with valid JSON only.",
      },
      { role: "user", content: buildChapterDetectionPrompt(opts) },
    ],
    { temperature: 0.1, maxTokens: 4096, jsonMode: true, feature: "chapter-detection" }
  );

  const parsed = extractJson(text);
  const arr = Array.isArray(parsed) ? parsed : (parsed as Record<string, unknown>).chapters;
  return validateDetectedChapters(arr);
}
