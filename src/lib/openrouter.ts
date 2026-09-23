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
 *
 * REASONING IS OFF BY DEFAULT. Most models on OpenRouter now think before they
 * answer, and that thinking is billed as output and counted against max_tokens.
 * Benchmarked on the real question-generation prompt (2026-09-23), DeepSeek V4
 * Flash spent all 8,192 tokens thinking and returned no JSON on half its HARD
 * batches, took ~130s per batch, and as a judge exhausted the verifier's 1,200
 * tokens. Gemini avoids this with its thinking cap (lib/gemini.ts), which leaves
 * it at ~0 thinking tokens; `reasoning: { enabled: false }` is the OpenRouter
 * equivalent. Set OPENROUTER_REASONING=low|medium|high|default to change it.
 */

import { buildQuestionGenerationPrompt } from "./question-prompts";
import { extractJson, validateQuestions, validateDetectedChapters } from "./question-validation";
import { buildChapterDetectionPrompt, GROQ_QUESTION_JSON_SCHEMA } from "./groq";
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

/**
 * The `reasoning` field sent with every call, or undefined to send none (the
 * model's own default). See the note at the top of this file.
 */
function reasoningParam(): Record<string, unknown> | undefined {
  const mode = (process.env.OPENROUTER_REASONING ?? "off").trim().toLowerCase();
  if (mode === "default") return undefined;
  if (mode === "low" || mode === "medium" || mode === "high") return { effort: mode };
  return { enabled: false };
}

/**
 * A strict JSON schema for `response_format` (OpenAI structured outputs).
 * Gemini gets its schema natively; this gives OpenRouter models the same
 * guarantee of well-formed, correctly-typed output instead of "any JSON".
 */
export interface JsonSchemaFormat {
  name: string;
  strict?: boolean;
  schema: Record<string, unknown>;
}

async function openRouterCompletion(
  messages: { role: "system" | "user" | "assistant"; content: string }[],
  opts: {
    temperature?: number;
    maxTokens?: number;
    jsonMode?: boolean;
    /** Strict schema for the reply; implies JSON. Falls back to plain JSON mode if the model rejects it. */
    jsonSchema?: JsonSchemaFormat;
    feature?: UsageFeature;
    actor?: UsageActor;
    slot?: "chat" | "fast";
  } = {}
): Promise<string> {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) throw new Error("OPENROUTER_API_KEY is not configured.");

  const model = await getModelFor("OPENROUTER", opts.slot ?? "chat");
  if (!model) throw new Error("No OpenRouter model is configured.");

  let reasoning = reasoningParam();
  let responseFormat: unknown = opts.jsonSchema
    ? { type: "json_schema", json_schema: opts.jsonSchema }
    : opts.jsonMode
      ? { type: "json_object" }
      : undefined;
  // With reasoning on, thinking is counted against max_tokens — give the answer
  // room so a small budget (the verifier's 1,200) is not spent entirely thinking.
  const maxTokens = () =>
    reasoning && reasoning.enabled === false
      ? opts.maxTokens ?? 8192
      : Math.max(opts.maxTokens ?? 8192, 8192);

  // Not every model accepts every option. A 400 naming the option we sent is
  // retried once without it (reasoning) or with plain JSON mode (schema), rather
  // than failing a step the model could have served. Rejected calls are not billed.
  let res: Response | undefined;
  for (let attempt = 0; attempt < 3; attempt++) {
    res = await fetch(`${baseUrl()}/chat/completions`, {
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
        max_tokens: maxTokens(),
        ...(responseFormat ? { response_format: responseFormat } : {}),
        ...(reasoning ? { reasoning } : {}),
        // Ask OpenRouter to report what this call actually cost (usage.cost, in
        // USD) so usage tracking follows its live prices and cache discounts.
        usage: { include: true },
      }),
      // Free-tier routes queue behind other tenants, so this is deliberately
      // longer than NVIDIA's 35s.
      signal: AbortSignal.timeout(120_000),
    });
    if (res.ok || res.status !== 400) break;

    const body = await res.clone().text().catch(() => "");
    if (reasoning && /reasoning/i.test(body)) {
      console.warn(`[OpenRouter] ${model} rejected the reasoning setting — retrying with the model default.`);
      reasoning = undefined;
    } else if (opts.jsonSchema && /json_schema|response_format|structured/i.test(body)) {
      console.warn(`[OpenRouter] ${model} rejected the JSON schema — retrying in plain JSON mode.`);
      responseFormat = { type: "json_object" };
    } else {
      break;
    }
  }

  if (!res || !res.ok) {
    const body = await res?.text().catch(() => "");
    throw new Error(`OpenRouter API error ${res?.status}: ${(body ?? "").slice(0, 300)}`);
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
    reportedCostUsd: Number((data.usage as { cost?: unknown } | undefined)?.cost),
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
    jsonSchema?: JsonSchemaFormat;
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
      {
        temperature: 0.5,
        maxTokens: 8192,
        jsonSchema: GROQ_QUESTION_JSON_SCHEMA,
        feature: "question-generation",
      }
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
