/**
 * Per-feature token-usage logging.
 *
 * The provider billing consoles (e.g. Gemini API Spend) break spend down by
 * MODEL, but Abugida runs many features through only two Gemini models —
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

import { randomUUID } from "crypto";
import { AsyncLocalStorage } from "node:async_hooks";
import { costUsd } from "./model-pricing";
import { db } from "./db";

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
  /**
   * Portion of promptTokens served from the provider's prompt cache, billed at
   * the cheaper cached-input rate. Already INSIDE promptTokens, never added.
   */
  cachedTokens?: number;
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
  /** Settles verifier-vs-quality-check disagreements on factual accuracy. */
  | "factual-tiebreak"
  | "bloom-tagging"
  | "tutor-chat"
  /** Rewrites a tutor follow-up into a search query before retrieval. */
  | "query-rewrite"
  | "teacher-assistant"
  /** Reading uploaded national exam papers into questions. */
  | "exam-extraction"
  | "vision-graph"
  | "vision-equation"
  | "vision-solid"
  | "graph-qa"
  // ── Embeddings ───────────────────────────────────────────────────────────
  // Split by call site rather than lumped into one "embedding" bucket: the
  // three have completely different cost curves. Ingest is bounded by how many
  // textbooks exist, query scales with student traffic, and dedup scales with
  // question generation — which makes dedup the only one that can grow
  // without a textbook or a student being added.
  /** Textbook processing: one vector per chunk, once per book. */
  | "embedding-ingest"
  /** Question-generation dedup: re-embeds the comparison set every batch. */
  | "embedding-dedup"
  /** Tutor semantic search: one short vector per student message. */
  | "embedding-query";

/**
 * Who a model call was made FOR. Passed down from the route that has the
 * session, since the provider helpers deep in the call stack have no idea who
 * is asking. Both fields absent for content-side work (question generation,
 * chapter detection) that no single student triggered.
 */
export interface UsageActor {
  studentId?: string | null;
  schoolId?: string | null;
  /** Either teacher band — both are priced per teacher. */
  teacherId?: string | null;
}

/**
 * Build an actor from the signed-in user a route already has. `studentId` is
 * set only for students, so "cost per student" stays a student number; the
 * school is recorded for any school-linked user, so a school admin's own AI
 * use still lands on that school's bill.
 */
export function usageActor(
  user: { id: string; role: string; schoolId?: string | null } | null | undefined
): UsageActor | undefined {
  if (!user) return undefined;
  return {
    studentId: user.role === "STUDENT" ? user.id : null,
    schoolId: user.schoolId ?? null,
    teacherId: user.role === "SECONDARY_TEACHER" || user.role === "TEACHER" ? user.id : null,
  };
}

// ─── Actor scope ────────────────────────────────────────
//
// Question generation runs deep inside provider libraries that have no idea who
// asked, so a student's on-demand AI quiz used to be logged with no student or
// school. A route that knows the user wraps the work in `withUsageActor`, and
// every call logged inside it — generation, the verifier, dedup embeddings —
// is attributed, without threading an actor through every signature. An actor
// passed explicitly to `logUsage` still wins.

const actorScope = new AsyncLocalStorage<UsageActor | undefined>();

export function withUsageActor<T>(actor: UsageActor | undefined, fn: () => Promise<T>): Promise<T> {
  return actorScope.run(actor, fn);
}

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
  // Implicit/explicit cache hits, counted inside promptTokenCount.
  const cached = meta.cachedContentTokenCount ?? 0;
  // Prefer the provider's own total; fall back to the sum when it is absent.
  const total = meta.totalTokenCount ?? prompt + output + thinking;
  return { promptTokens: prompt, outputTokens: output, thinkingTokens: thinking, totalTokens: total, cachedTokens: cached };
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
  // Prompt-cache hits (DeepSeek, OpenAI-style providers), inside prompt_tokens.
  const promptDetails = (u.prompt_tokens_details as Record<string, unknown> | undefined) ?? {};
  const cached = Number(promptDetails.cached_tokens) || 0;
  const total = Number(u.total_tokens) || prompt + output;
  return { promptTokens: prompt, outputTokens: output, thinkingTokens: thinking, totalTokens: total, cachedTokens: cached };
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
  actor?: UsageActor;
  /**
   * The cost the provider itself reported for this call (OpenRouter does).
   * Preferred over the price table: it includes live prices, discounts and
   * cache hits exactly as billed.
   */
  reportedCostUsd?: number | null;
}): void {
  const { feature, provider, model, usage, reportedCostUsd } = args;
  const actor = args.actor ?? actorScope.getStore();
  const key = `${feature}|${provider}|${model}`;

  const cost =
    typeof reportedCostUsd === "number" && Number.isFinite(reportedCostUsd) && reportedCostUsd >= 0
      ? reportedCostUsd
      : costUsd(model, usage.promptTokens, usage.totalTokens, usage.cachedTokens ?? 0);

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
      `prompt=${usage.promptTokens} cached=${usage.cachedTokens ?? 0} output=${usage.outputTokens} ` +
      `thinking=${usage.thinkingTokens} total=${usage.totalTokens} ` +
      `costUSD=${cost === null ? "unpriced" : cost.toFixed(6)}` +
      (actor?.studentId ? ` student=${actor.studentId}` : "") +
      (actor?.schoolId ? ` school=${actor.schoolId}` : "") +
      (actor?.teacherId ? ` teacher=${actor.teacherId}` : "")
  );

  // Durable, cross-route/cross-instance record. Fire-and-forget: usage
  // accounting must never delay or fail a real request, and a lost event on
  // shutdown is acceptable. The in-memory totals above are kept only for tests
  // and quick debugging — the admin page reads the database, because separate
  // route bundles and server instances each hold their OWN copy of that map.
  void persistUsageEvent({ feature, provider, model, usage, cost, actor });
}

async function persistUsageEvent(args: {
  feature: UsageFeature;
  provider: string;
  model: string;
  usage: TokenUsage;
  cost: number | null;
  actor?: UsageActor;
}): Promise<void> {
  const { feature, provider, model, usage, cost, actor } = args;
  try {
    await db.$executeRaw`
      INSERT INTO usage_events
        (id, "createdAt", feature, provider, model,
         "promptTokens", "outputTokens", "thinkingTokens", "totalTokens",
         "costUsd", unpriced, "studentId", "schoolId", "teacherId")
      VALUES
        (${randomUUID()}, NOW(), ${feature}, ${provider}, ${model},
         ${usage.promptTokens}, ${usage.outputTokens}, ${usage.thinkingTokens}, ${usage.totalTokens},
         ${cost}, ${cost === null}, ${actor?.studentId ?? null}, ${actor?.schoolId ?? null},
         ${actor?.teacherId ?? null})
    `;
  } catch (err) {
    // Never surface a logging failure to the caller.
    console.warn(
      `[Usage] Failed to persist usage event: ${err instanceof Error ? err.message : String(err)}`
    );
  }
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
