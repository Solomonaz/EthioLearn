/**
 * Per-task AI routing: which provider + model runs each task, in what order.
 *
 * The chain for a task comes from the `ai_task_routes` table when an admin has
 * saved one, otherwise from the task's built-in default in `ai-tasks.ts` (which
 * mirrors the hard-coded chains this replaced). Provider-level switches still
 * apply on top: a step is skipped when its provider is disabled, has no API
 * key, or is local Ollama outside development.
 *
 * Callers keep their own provider-specific code (schemas, prompts, parsing) —
 * this module only decides the ORDER and the MODEL. Each step runs inside
 * `withModelOverride`, which is how a chosen model reaches the provider
 * libraries without changing their signatures.
 */

import { db } from "./db";
import { getProviderSettings, withModelOverride, type ResolvedProvider } from "./ai-settings";
import { isOllamaEnabled } from "./ollama";
import { withGeminiBackend } from "./gemini-backend";
import {
  TASK_BY_ID,
  sanitizeChain,
  stepStatus,
  type AiProvider,
  type AiTask,
  type ProviderState,
  type RouteStep,
} from "./ai-tasks";

export type { AiTask, RouteStep, AiProvider };

/** Lower-case provider names, as recorded in usage events and returned to callers. */
export type ProviderName = "gemini" | "gemini-vertex" | "groq" | "nvidia" | "openrouter" | "ollama";

export const PROVIDER_NAME: Record<AiProvider, ProviderName> = {
  GEMINI: "gemini",
  GEMINI_VERTEX: "gemini-vertex",
  GROQ: "groq",
  NVIDIA: "nvidia",
  OPENROUTER: "openrouter",
  OLLAMA: "ollama",
};

/** A step that will actually be attempted. */
export interface ResolvedStep extends RouteStep {
  name: ProviderName;
  /** The model id that will be used — the explicit one or the provider default. */
  effectiveModel: string | null;
}

/**
 * Saved chains for every task that has one. Read per call, like provider
 * settings, so an admin's change applies to the very next request. A missing
 * table (schema not yet pushed) must not take AI down — it means "all defaults".
 */
export async function getSavedChains(
  opts: {
    /** Throw instead of returning "all defaults" when the table cannot be read. See getProviderSettings. */
    strict?: boolean;
  } = {}
): Promise<Partial<Record<AiTask, RouteStep[]>>> {
  try {
    const rows = await db.aiTaskRoute.findMany();
    const out: Partial<Record<AiTask, RouteStep[]>> = {};
    for (const r of rows) {
      if (!(r.task in TASK_BY_ID)) continue;
      const task = r.task as AiTask;
      const chain = sanitizeChain(task, r.chain);
      if (chain.length) out[task] = chain;
    }
    return out;
  } catch (err) {
    if (opts.strict) throw err;
    return {};
  }
}

/** The configured chain for a task (saved or default), before provider filtering. */
export async function getConfiguredChain(task: AiTask): Promise<RouteStep[]> {
  const saved = await getSavedChains();
  return saved[task] ?? TASK_BY_ID[task].defaultChain;
}

/** Provider settings in the shape `stepStatus` reads. */
export function toProviderState(p: ResolvedProvider): ProviderState {
  return {
    id: p.id as AiProvider,
    enabled: p.enabled,
    hasKey: p.hasKey,
    models: { chat: p.models.chat, fast: p.models.fast },
  };
}

/**
 * The steps that will actually be attempted for `task`, in order. Steps whose
 * provider is disabled, keyless or unavailable are dropped, as are steps with
 * no model to run (no explicit model and no provider default).
 */
export async function getTaskChain(task: AiTask): Promise<ResolvedStep[]> {
  const [configured, providers] = await Promise.all([
    getConfiguredChain(task),
    getProviderSettings(),
  ]);
  const byId = new Map(providers.map((p) => [p.id as AiProvider, toProviderState(p)]));
  const ollamaEnabled = isOllamaEnabled();

  const out: ResolvedStep[] = [];
  for (const s of configured) {
    const { effectiveModel, skip } = stepStatus(task, s, byId.get(s.provider), ollamaEnabled);
    if (skip) continue;
    out.push({ ...s, name: PROVIDER_NAME[s.provider], effectiveModel });
  }
  return out;
}

/**
 * The implementation a caller supplied for `provider`.
 *
 * GEMINI_VERTEX runs the caller's GEMINI implementation unless it gave one of
 * its own: the Gemini helpers serve both backends, and `runStep` points them at
 * Agent Platform. So no call site needs a second, identical Gemini entry.
 */
export function implFor<F>(impl: Partial<Record<AiProvider, F>>, provider: AiProvider): F | undefined {
  return impl[provider] ?? (provider === "GEMINI_VERTEX" ? impl.GEMINI : undefined);
}

/**
 * Run one step's call with that step's model applied to its provider. A Gemini
 * step also pins the backend its Gemini calls go to — Agent Platform for
 * GEMINI_VERTEX, AI Studio for GEMINI — so a step nested inside another never
 * inherits the outer step's backend.
 */
export function runStep<T>(s: RouteStep, fn: () => Promise<T>): Promise<T> {
  const call = () => withModelOverride(s.provider, s.model, fn);
  if (s.provider === "GEMINI_VERTEX") return withGeminiBackend("vertex", call);
  if (s.provider === "GEMINI") return withGeminiBackend("studio", call);
  return call();
}

function describe(s: ResolvedStep): string {
  return `${s.provider}(${s.effectiveModel})`;
}

/**
 * Walk `task`'s chain until one step succeeds.
 *
 * `impl` supplies the provider-specific call for each provider the caller
 * supports; a step whose provider has no implementation is skipped. A step
 * FAILS when its call throws, returns null/undefined, or is rejected by
 * `accept` — "a non-empty reply" is not the same as a usable one.
 *
 * Throws only after every step has failed, naming each attempt.
 */
export async function runTask<T>(
  task: AiTask,
  impl: Partial<Record<AiProvider, () => Promise<T | null | undefined>>>,
  opts: {
    accept?: (value: T) => boolean;
    /** Re-order the resolved chain for this one call (e.g. the verifier's avoid rule). */
    reorder?: (chain: ResolvedStep[]) => ResolvedStep[];
  } = {}
): Promise<{ value: T; provider: ProviderName; model: string | null }> {
  let chain = (await getTaskChain(task)).filter((s) => implFor(impl, s.provider));
  if (opts.reorder) chain = opts.reorder(chain);

  const label = TASK_BY_ID[task].label;
  console.log(`[AI Routing] ${label} chain: ${chain.map(describe).join(" -> ") || "(empty)"}`);

  const attempts: string[] = [];
  for (const s of chain) {
    let failure: string;
    try {
      const value = await runStep(s, implFor(impl, s.provider)!);
      if (value === null || value === undefined) {
        failure = "no response";
      } else if (opts.accept && !opts.accept(value)) {
        failure = "unusable response";
      } else {
        if (attempts.length) {
          console.log(`[AI Routing] ${label}: served by ${describe(s)} after ${attempts.length} failure(s).`);
        }
        return { value, provider: s.name, model: s.effectiveModel };
      }
    } catch (err) {
      failure = err instanceof Error ? err.message : String(err);
    }
    attempts.push(`${describe(s)}: ${failure}`);
    console.warn(`[AI Routing] ${label}: ${describe(s)} failed (${failure}) — trying next.`);
  }

  throw new Error(
    `All AI providers failed for ${label}. ` +
      (attempts.length
        ? `Attempts: ${attempts.join(" | ")}. `
        : "No step in this task's chain is enabled, keyed and given a model. ") +
      "Check Admin -> AI Models."
  );
}
