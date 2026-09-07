/**
 * Per-feature token-usage logging.
 *
 * The provider billing consoles (e.g. Gemini API Spend) break spend down by
 * MODEL, but EthioLearn runs many features through only two Gemini models —
 * question generation, chapter detection, the answer verifier, video scripts
 * and every vision task all share the flagship model — so a per-model number
 * cannot say which FEATURE drove the cost. This records the token counts each
 * feature actually consumed, at every provider, so spend is attributable inside
 * the app instead of only in the vendor console.
 *
 * Every model call site reports here. The durable record is a single structured
 * log line per call (greppable as `[Usage]`); a small in-process running total
 * is also kept for `getUsageTotals()`, handy for a debug endpoint or a test —
 * but note it lives in one server instance's memory and resets on redeploy, so
 * the logs, not this map, are the source of truth over time.
 */

import { costUsd } from "./model-pricing";

/** Normalised token counts, provider-independent. */
export interface TokenUsage {
  /** Input tokens (prompt + any system instruction + image tokens). */
  promptTokens: number;
  /** Output tokens actually returned as the answer. */
  outputTokens: number;
  /**
   * Reasoning/"thinking" tokens billed as output but not part of the answer.
   * Gemini 3.x reports these separately; capped hard via THINKING_BUDGET. 0 for
   * providers that do not expose them.
   */
  thinkingTokens: number;
  /** promptTokens + outputTokens + thinkingTokens as the provider reported it. */
  totalTokens: number;
}

/**
 * The features that spend tokens. Keep this list the single source of truth —
 * typing the logger parameter to it stops a typo from creating a phantom
 * feature that fragments the totals.
 */
export type UsageFeature =
  | "question-generation"
  | "chapter-detection"
  | "answer-verification"
  | "quality-check"
  | "bloom-tagging"
  | "tutor-chat"
  | "video-script"
  | "vision-graph"
  | "vision-equation"
  | "vision-solid"
  | "graph-qa";

interface UsageTotal {
  calls: number;
  promptTokens: number;
  outputTokens: number;
  thinkingTokens: number;
  totalTokens: number;
  /** List-price USD cost of these calls. */
  costUsd: number;
  /** True if any call here used a model with no price entry (cost understated). */
  hasUnpriced: boolean;
}

// key = `${feature}|${provider}|${model}`
const totals = new Map<string, UsageTotal>();

/**
 * Pull normalised usage out of a Gemini `generateContent` / `sendMessage`
 * response. The SDK version in use predates `thoughtsTokenCount` in its types,
 * so the field is read defensively; when the API omits it, thinking is 0.
 */
export function geminiUsage(response: unknown): TokenUsage {
  const meta =
    (response as { usageMetadata?: Record<string, number> } | null)
      ?.usageMetadata ?? {};
  const prompt = meta.promptTokenCount ?? 0;
  const output = meta.candidatesTokenCount ?? 0;
  const thinking = meta.thoughtsTokenCount ?? 0;
  // Prefer the provider's own total; fall back to the sum when it is absent.
  const total = meta.totalTokenCount ?? prompt + output + thinking;
  return { promptTokens: prompt, outputTokens: output, thinkingTokens: thinking, totalTokens: total };
}

/**
 * Pull normalised usage out of an OpenAI-shaped `usage` object — the shape Groq
 * (via its SDK) and NVIDIA (raw REST) both return. Reasoning tokens, when the
 * model exposes them, arrive under `completion_tokens_details.reasoning_tokens`
 * and are already counted inside `completion_tokens`, so they are surfaced but
 * NOT added again.
 */
export function openAiUsage(usage: unknown): TokenUsage {
  const u = (usage as Record<string, unknown> | null | undefined) ?? {};
  const prompt = Number(u.prompt_tokens) || 0;
  const output = Number(u.completion_tokens) || 0;
  const details = (u.completion_tokens_details as Record<string, unknown> | undefined) ?? {};
  const thinking = Number(details.reasoning_tokens) || 0;
  const total = Number(u.total_tokens) || prompt + output;
  return { promptTokens: prompt, outputTokens: output, thinkingTokens: thinking, totalTokens: total };
}

/**
 * Record one model call's usage: emit a structured line and fold it into the
 * running totals. Never throws — usage accounting must not break a request, so
 * a malformed usage object is logged as zeros rather than propagated.
 */
export function logUsage(args: {
  feature: UsageFeature;
  provider: string;
  model: string;
  usage: TokenUsage;
}): void {
  const { feature, provider, model, usage } = args;
  const key = `${feature}|${provider}|${model}`;

  const cost = costUsd(model, usage.promptTokens, usage.totalTokens);

  const acc = totals.get(key) ?? {
    calls: 0,
    promptTokens: 0,
    outputTokens: 0,
    thinkingTokens: 0,
    totalTokens: 0,
    costUsd: 0,
    hasUnpriced: false,
  };
  acc.calls += 1;
  acc.promptTokens += usage.promptTokens;
  acc.outputTokens += usage.outputTokens;
  acc.thinkingTokens += usage.thinkingTokens;
  acc.totalTokens += usage.totalTokens;
  acc.costUsd += cost ?? 0;
  if (cost === null) acc.hasUnpriced = true;
  totals.set(key, acc);

  console.log(
    `[Usage] feature=${feature} provider=${provider} model=${model} ` +
      `prompt=${usage.promptTokens} output=${usage.outputTokens} ` +
      `thinking=${usage.thinkingTokens} total=${usage.totalTokens} ` +
      `costUSD=${cost === null ? "unpriced" : cost.toFixed(6)}`
  );
}

/**
 * Snapshot of the per-feature totals since this server instance started.
 * Sorted by total tokens so the costliest feature is first.
 */
export function getUsageTotals(): Array<
  { feature: string; provider: string; model: string } & UsageTotal
> {
  return [...totals.entries()]
    .map(([key, v]) => {
      const [feature, provider, model] = key.split("|");
      return { feature, provider, model, ...v };
    })
    .sort((a, b) => b.totalTokens - a.totalTokens);
}

/** Reset the running totals (tests only). */
export function resetUsageTotals(): void {
  totals.clear();
}
