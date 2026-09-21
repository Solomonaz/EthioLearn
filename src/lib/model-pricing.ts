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
 * Only the flagship and fast Gemini models carry real prices — they are what
 * appears on the user's Gemini API Spend dashboard. Groq and NVIDIA are used on
 * their free tiers here, so they are priced at 0; give them real rates if you
 * ever move to a paid tier. Ollama is local (no API cost).
 */

export interface ModelPrice {
  /** USD per 1,000,000 input (prompt) tokens. */
  inputPerMillion: number;
  /** USD per 1,000,000 output tokens (answer + billed reasoning). */
  outputPerMillion: number;
  /** False for free-tier / local models priced at 0, so the UI can say so. */
  billed: boolean;
}

// Keyed by the exact model id the SDK reports (and that gemini.ts / groq.ts /
// nvidia.ts send). If a model id is overridden via env to something not listed
// here, `priceFor` returns null and the usage is reported as UNPRICED rather
// than silently costed at 0.
export const MODEL_PRICING: Record<string, ModelPrice> = {
  // Gemini flagship — question generation, chapter detection, the verifier,
  // video scripts, all vision. $0.75 / $3.75 per 1M through 2026.
  "gemini-3.8-flash": { inputPerMillion: 0.75, outputPerMillion: 3.75, billed: true },
  // Gemini fast — Bloom tagging, quality checks, tutor-chat fallback. A third of
  // the flagship input price and 40% of its output price.
  "gemini-3.1-flash-lite": { inputPerMillion: 0.25, outputPerMillion: 1.5, billed: true },

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

export function priceFor(model: string): ModelPrice | null {
  return MODEL_PRICING[model] ?? null;
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
  totalTokens: number
): number | null {
  const price = priceFor(model);
  if (!price) return null;
  const billableOutput = Math.max(0, totalTokens - promptTokens);
  return (
    (promptTokens * price.inputPerMillion) / 1_000_000 +
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
