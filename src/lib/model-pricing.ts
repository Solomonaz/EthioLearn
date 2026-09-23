/**
 * Per-model token pricing, and the cost math that turns the token counts from
 * `usage-logger` into money.
 *
 * Rates are USD per 1,000,000 tokens — the currency and unit every provider
 * quotes list prices in. The vendor billing console may DISPLAY a converted
 * local amount (the Gemini console showed SEK), and may apply free-tier credits
 * on top, so a figure here is the list-price cost of the tokens spent, not
 * necessarily what post-credit money changes hands. Set USAGE_FX_PER_USD +
 * USAGE_CURRENCY to show a converted amount alongside USD.
 *
 * Gemini and paid OpenRouter models carry real prices. Groq and NVIDIA are used
 * on their free tiers here, so they are priced at 0 (as is any OpenRouter
 * ":free" model); give them real rates if you ever move to a paid tier. Ollama
 * is local (no API cost).
 */

export interface ModelPrice {
  /** USD per 1,000,000 input (prompt) tokens. */
  inputPerMillion: number;
  /** USD per 1,000,000 output tokens (answer + billed reasoning). */
  outputPerMillion: number;
  /**
   * USD per 1,000,000 input tokens served from the provider's prompt cache.
   * Omitted = no cache discount (cached tokens bill at the full input rate).
   */
  cachedInputPerMillion?: number;
  /** False for free-tier / local models priced at 0, so the UI can say so. */
  billed: boolean;
}

// Keyed by the exact model id the SDK reports (and that gemini.ts / groq.ts /
// nvidia.ts send). If a model id is overridden via env to something not listed
// here, `priceFor` returns null and the usage is reported as UNPRICED rather
// than silently costed at 0.
export const MODEL_PRICING: Record<string, ModelPrice> = {
  // Gemini flagship — question generation, chapter detection, the verifier,
  // all vision. $0.75 / $3.75 per 1M, cached input $0.075, through 2026.
  // PRICE RISE: from 1 Jan 2027 Google lists $1.50 / $7.50 (cached $0.15).
  "gemini-3.8-flash": { inputPerMillion: 0.75, outputPerMillion: 3.75, cachedInputPerMillion: 0.075, billed: true },
  // Gemini light — Bloom tagging, quality checks, tutor, search rewrite.
  "gemini-3.1-flash-lite": { inputPerMillion: 0.25, outputPerMillion: 1.5, cachedInputPerMillion: 0.025, billed: true },

  // DeepSeek V4 Flash via OpenRouter (paid). OpenRouter's live list price on
  // 2026-09-22; its prices move, so OpenRouter calls record the cost OpenRouter
  // itself reports per request and only fall back to this table. Listed under
  // both the id you request and the dated id OpenRouter may answer with.
  "deepseek/deepseek-v4-flash": { inputPerMillion: 0.049, outputPerMillion: 0.098, cachedInputPerMillion: 0.0098, billed: true },
  "deepseek/deepseek-v4-flash-20260423": { inputPerMillion: 0.049, outputPerMillion: 0.098, cachedInputPerMillion: 0.0098, billed: true },
  // GPT-6 Luna via OpenRouter — the default question generator. List price on
  // 2026-09-23 for prompts under 272K tokens (ours are ~10-20K).
  "openai/gpt-6-luna": { inputPerMillion: 0.1, outputPerMillion: 0.5, cachedInputPerMillion: 0.01, billed: true },

  // Embeddings. These have NO output tokens — the response is a vector, not
  // text — so outputPerMillion is 0 and the whole cost is the input side.
  // gemini-embedding-001 lists at $0.15 per 1M input tokens.
  "gemini-embedding-001": { inputPerMillion: 0.15, outputPerMillion: 0, billed: true },
  // Local embedding model served by Ollama — no API cost.
  "bge-m3": { inputPerMillion: 0, outputPerMillion: 0, billed: false },
  // The offline n-gram stand-in is pure local computation, not a model call.
  fingerprint: { inputPerMillion: 0, outputPerMillion: 0, billed: false },

  // Free tiers / local — no cost to this account today.
  "openai/gpt-oss-20b": { inputPerMillion: 0, outputPerMillion: 0, billed: false },
  "nvidia/nemotron-3-super-120b-a12b": { inputPerMillion: 0, outputPerMillion: 0, billed: false },
};

const FREE: ModelPrice = { inputPerMillion: 0, outputPerMillion: 0, billed: false };

export function priceFor(model: string): ModelPrice | null {
  const exact = MODEL_PRICING[model];
  if (exact) return exact;
  // OpenRouter ":free" variants cost nothing, whatever the base model.
  if (model.endsWith(":free")) return FREE;
  return null;
}

/**
 * List-price USD cost of one model call.
 *
 * Billable output is derived as `totalTokens - promptTokens` rather than read
 * from the output field directly, so it is correct under both provider
 * conventions without double-counting reasoning tokens:
 *   - Gemini reports thinking SEPARATELY from the answer, and its
 *     totalTokenCount already includes both, so total − prompt = answer +
 *     thinking (all billed at the output rate).
 *   - Groq/NVIDIA fold reasoning INTO completion_tokens, and their total is
 *     prompt + completion, so total − prompt = completion (reasoning already
 *     inside, counted once).
 *
 * Returns null for an unpriced model so callers can flag it instead of
 * reporting a misleading $0.
 */
export function costUsd(
  model: string,
  promptTokens: number,
  totalTokens: number,
  /** Portion of promptTokens served from the prompt cache (already inside promptTokens). */
  cachedTokens = 0
): number | null {
  const price = priceFor(model);
  if (!price) return null;
  const billableOutput = Math.max(0, totalTokens - promptTokens);
  const cached = Math.min(Math.max(0, cachedTokens), promptTokens);
  const cachedRate = price.cachedInputPerMillion ?? price.inputPerMillion;
  return (
    ((promptTokens - cached) * price.inputPerMillion) / 1_000_000 +
    (cached * cachedRate) / 1_000_000 +
    (billableOutput * price.outputPerMillion) / 1_000_000
  );
}

/**
 * Optional display currency conversion, off by default (shows USD).
 * USAGE_FX_PER_USD is how many display-currency units one USD buys.
 */
export function displayCurrency(): { code: string; perUsd: number } {
  const perUsd = Number(process.env.USAGE_FX_PER_USD);
  return {
    code: process.env.USAGE_CURRENCY || "USD",
    perUsd: Number.isFinite(perUsd) && perUsd > 0 ? perUsd : 1,
  };
}
