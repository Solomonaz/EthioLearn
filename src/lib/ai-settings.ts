/**
 * Runtime AI provider configuration — which providers run, in what order, and
 * against which model ids.
 *
 * Why this exists
 * ───────────────
 * Model ids are not stable. `meta/llama-3.3-70b-instruct` began answering
 * 410 Gone mid-2026, and DeepSeek renamed the same model three times
 * (deepseek-chat -> deepseek-v4-flash -> deepseek-flash) inside a few months.
 * When that happens the fix must be a field in an admin form, not an edit to a
 * source file followed by a deploy. The same applies to chain order: when one
 * provider's daily quota is exhausted, an admin needs to demote it NOW.
 *
 * Precedence for every value: **database -> environment -> built-in default.**
 * The environment layer is kept so an existing `.env` (GEMINI_MODEL, GROQ_MODEL,
 * NVIDIA_MODEL, …) keeps working untouched, and so a fresh database is never
 * "empty" — it simply inherits what the process already had.
 *
 * API KEYS ARE NOT CONFIGURABLE HERE, by design. They are read from the
 * environment only. A key stored in a table is a key in every backup, every
 * `pg_dump` and every admin's browser session. The admin UI reports only
 * whether a key is PRESENT.
 */

import { AsyncLocalStorage } from "node:async_hooks";
import { AiProviderId } from "@prisma/client";
import { db } from "./db";

export { AiProviderId };

/** The three model slots the app actually calls. */
export type ModelSlot = "chat" | "fast" | "embedding";

interface ProviderMeta {
  label: string;
  /** Environment variable holding the key. Null for local providers. */
  keyEnv: string | null;
  /** Env var that can override the base URL, if any. */
  baseUrlEnv: string | null;
  /** Built-in API base. Null means the provider's SDK owns it. */
  defaultBaseUrl: string | null;
  /** Which slots this provider can serve at all. */
  slots: Record<ModelSlot, boolean>;
  /** Built-in model ids, and the env var that overrides each. */
  defaults: Partial<Record<ModelSlot, { model: string; env: string | null }>>;
  /** Default chain position — lower runs first. */
  defaultPriority: number;
  /** True for providers that run on this machine rather than over the network. */
  local: boolean;
  /** One line shown in the admin UI. */
  hint: string;
}

/**
 * Static facts about each provider. Everything an admin can CHANGE lives in the
 * database; everything here is structural — it only changes with a code change,
 * because it describes what the provider *is*, not how we have configured it.
 */
export const PROVIDER_META: Record<AiProviderId, ProviderMeta> = {
  GEMINI: {
    label: "Google Gemini (AI Studio)",
    keyEnv: "GEMINI_API_KEY",
    baseUrlEnv: null,
    defaultBaseUrl: "https://generativelanguage.googleapis.com/v1beta",
    slots: { chat: true, fast: true, embedding: true },
    defaults: {
      chat: { model: "gemini-3.8-flash", env: "GEMINI_MODEL" },
      fast: { model: "gemini-3.1-flash-lite", env: "GEMINI_FAST_MODEL" },
      embedding: { model: "gemini-embedding-001", env: "GEMINI_EMBEDDING_MODEL" },
    },
    defaultPriority: 10,
    local: false,
    hint: "Strongest quality; billed per token. The only provider that can read images.",
  },
  // The same Gemini models through Google Cloud Agent Platform (Vertex AI),
  // billed to the Cloud project so Cloud credits apply. lib/gemini.ts serves
  // both — see lib/gemini-backend. No embedding slot: vectors stay on GEMINI
  // so the index never mixes two embedding setups.
  GEMINI_VERTEX: {
    label: "Google Gemini (Agent Platform)",
    keyEnv: "GEMINI_VERTEX_API_KEY",
    baseUrlEnv: "GEMINI_VERTEX_BASE_URL",
    defaultBaseUrl: "https://aiplatform.googleapis.com/v1",
    slots: { chat: true, fast: true, embedding: false },
    defaults: {
      chat: { model: "gemini-3.8-flash", env: "GEMINI_VERTEX_MODEL" },
      fast: { model: "gemini-3.1-flash-lite", env: "GEMINI_VERTEX_FAST_MODEL" },
    },
    defaultPriority: 15,
    local: false,
    hint: "Same Gemini models, billed to your Google Cloud project — Cloud credits apply. Can read images. Embeddings stay on AI Studio Gemini.",
  },
  GROQ: {
    label: "Groq",
    keyEnv: "GROQ_API_KEY",
    baseUrlEnv: null,
    defaultBaseUrl: "https://api.groq.com/openai/v1",
    slots: { chat: true, fast: true, embedding: false },
    defaults: {
      chat: { model: "openai/gpt-oss-20b", env: "GROQ_MODEL" },
      fast: { model: "openai/gpt-oss-20b", env: "GROQ_MODEL" },
    },
    defaultPriority: 20,
    local: false,
    hint: "Very fast, free tier. Small per-request size limit — large question-generation prompts can return 413.",
  },
  NVIDIA: {
    label: "NVIDIA NIM",
    keyEnv: "NVIDIA_API_KEY",
    baseUrlEnv: null,
    defaultBaseUrl: "https://integrate.api.nvidia.com/v1",
    slots: { chat: true, fast: true, embedding: true },
    defaults: {
      chat: { model: "nvidia/nemotron-3-super-120b-a12b", env: "NVIDIA_MODEL" },
      fast: { model: "nvidia/nemotron-3-super-120b-a12b", env: "NVIDIA_MODEL" },
      embedding: { model: "nvidia/nemotron-3-embed-1b", env: "NVIDIA_EMBEDDING_MODEL" },
    },
    defaultPriority: 30,
    local: false,
    hint: "Free tier, good quality, noticeably slower than Gemini.",
  },
  OPENROUTER: {
    label: "OpenRouter",
    keyEnv: "OPENROUTER_API_KEY",
    baseUrlEnv: "OPENROUTER_BASE_URL",
    defaultBaseUrl: "https://openrouter.ai/api/v1",
    slots: { chat: true, fast: true, embedding: false },
    defaults: {
      chat: { model: "qwen/qwen3.8-27b:free", env: "OPENROUTER_MODEL" },
      fast: { model: "qwen/qwen3.8-27b:free", env: "OPENROUTER_MODEL" },
    },
    defaultPriority: 40,
    local: false,
    hint: "One key, many models — ideal for testing. ':free' models share capacity and often return 429 under a burst.",
  },
  OLLAMA: {
    label: "Ollama (local)",
    keyEnv: null,
    baseUrlEnv: "OLLAMA_BASE_URL",
    defaultBaseUrl: "http://localhost:11434",
    slots: { chat: true, fast: true, embedding: true },
    defaults: {
      chat: { model: "mistral", env: "OLLAMA_CHAT_MODEL" },
      fast: { model: "mistral", env: "OLLAMA_CHAT_MODEL" },
      embedding: { model: "bge-m3", env: "OLLAMA_EMBEDDING_MODEL" },
    },
    defaultPriority: 50,
    local: true,
    hint: "Runs on this machine. Free and offline, but CPU inference is slow — unsuitable for bulk work.",
  },
};

export const ALL_PROVIDERS = Object.keys(PROVIDER_META) as AiProviderId[];

/** A provider's fully-resolved runtime configuration. */
export interface ResolvedProvider {
  id: AiProviderId;
  label: string;
  enabled: boolean;
  priority: number;
  models: Record<ModelSlot, string | null>;
  baseUrl: string | null;
  /** Whether the API key this provider needs is present in the environment. */
  hasKey: boolean;
  local: boolean;
  hint: string;
  slots: Record<ModelSlot, boolean>;
  /** Which model values came from the database rather than env/defaults. */
  overridden: Record<ModelSlot, boolean>;
  lastStatus: string | null;
  lastCheckedAt: Date | null;
  lastLatencyMs: number | null;
  lastMessage: string | null;
}

function resolveModel(
  meta: ProviderMeta,
  slot: ModelSlot,
  dbValue: string | null | undefined
): { model: string | null; overridden: boolean } {
  if (!meta.slots[slot]) return { model: null, overridden: false };
  const trimmed = dbValue?.trim();
  if (trimmed) return { model: trimmed, overridden: true };
  const def = meta.defaults[slot];
  if (!def) return { model: null, overridden: false };
  const fromEnv = def.env ? process.env[def.env]?.trim() : undefined;
  return { model: fromEnv || def.model, overridden: false };
}

/**
 * Read every provider's effective configuration.
 *
 * Deliberately NOT cached across requests. These values exist so an admin can
 * change routing during an incident and see it take effect immediately; a cache
 * measured in minutes would defeat the entire point of the feature. One indexed
 * primary-key read of at most five rows is cheap enough to pay per call.
 */
export async function getProviderSettings(
  opts: {
    /**
     * Throw when the saved settings cannot be read, instead of falling back to
     * env/defaults. The admin screen uses this: showing defaults there looks
     * exactly like "my settings were reset", and saving from that screen would
     * then overwrite the real ones.
     */
    strict?: boolean;
  } = {}
): Promise<ResolvedProvider[]> {
  let rows: Awaited<ReturnType<typeof db.aiProviderConfig.findMany>> = [];
  try {
    rows = await db.aiProviderConfig.findMany();
  } catch (err) {
    if (opts.strict) throw err;
    // A missing table (migration not yet applied) must not take AI down —
    // fall through to pure env/default resolution.
    rows = [];
  }
  const byId = new Map(rows.map((r) => [r.id, r]));

  const resolved: ResolvedProvider[] = ALL_PROVIDERS.map((id) => {
    const meta = PROVIDER_META[id];
    const row = byId.get(id);
    const chat = resolveModel(meta, "chat", row?.chatModel);
    const fast = resolveModel(meta, "fast", row?.fastModel);
    const embedding = resolveModel(meta, "embedding", row?.embeddingModel);
    const baseUrlEnv = meta.baseUrlEnv ? process.env[meta.baseUrlEnv]?.trim() : undefined;

    return {
      id,
      label: meta.label,
      enabled: row?.enabled ?? true,
      priority: row?.priority ?? meta.defaultPriority,
      models: { chat: chat.model, fast: fast.model, embedding: embedding.model },
      overridden: {
        chat: chat.overridden,
        fast: fast.overridden,
        embedding: embedding.overridden,
      },
      baseUrl: row?.baseUrl?.trim() || baseUrlEnv || meta.defaultBaseUrl,
      hasKey: meta.keyEnv ? !!process.env[meta.keyEnv] : true,
      local: meta.local,
      hint: meta.hint,
      slots: meta.slots,
      lastStatus: row?.lastStatus ?? null,
      lastCheckedAt: row?.lastCheckedAt ?? null,
      lastLatencyMs: row?.lastLatencyMs ?? null,
      lastMessage: row?.lastMessage ?? null,
    };
  }).sort((a, b) => a.priority - b.priority || a.id.localeCompare(b.id));

  primeSyncCache(resolved);
  return resolved;
}

/**
 * The ordered list of providers that should actually be attempted for `slot`.
 *
 * Filters out anything disabled, keyless, or with no model configured for that
 * slot — so a caller can walk the result without re-checking any of it.
 */
export async function getProviderChain(slot: ModelSlot): Promise<ResolvedProvider[]> {
  const all = await getProviderSettings();
  return all.filter((p) => p.enabled && p.hasKey && p.slots[slot] && p.models[slot]);
}

/** The model id configured for one provider/slot, or null. */
export async function getModelFor(
  id: AiProviderId,
  slot: ModelSlot
): Promise<string | null> {
  const override = overrideFor(id, slot);
  if (override) return override;
  const all = await getProviderSettings();
  return all.find((p) => p.id === id)?.models[slot] ?? null;
}

/**
 * Synchronous best-effort model id, for call sites deep in a provider library
 * that cannot await. Falls back to env then the built-in default — i.e. exactly
 * the behaviour those files had before this module existed.
 */
export function envModelFor(id: AiProviderId, slot: ModelSlot): string | null {
  const meta = PROVIDER_META[id];
  const def = meta.defaults[slot];
  if (!def) return null;
  const fromEnv = def.env ? process.env[def.env]?.trim() : undefined;
  return fromEnv || def.model;
}

// ─── Synchronous model-id cache ─────────────────────────
//
// The provider libraries reference their model id in dozens of places, several
// of them inside synchronous object literals passed to an SDK. Making all of
// those async would be a large, risky change for no behavioural gain, so the
// database values are mirrored into a plain in-process map instead.
//
// The map is refreshed as a side effect of `getProviderSettings()`, which every
// chain operation already awaits before dispatching — so by the time any
// provider library asks for its model id, the value is current. Before the
// first refresh (and if the database is unreachable) the getters fall back to
// env then the built-in default, which is precisely the old behaviour.

const syncModelCache = new Map<string, string | null>();

function cacheKey(id: AiProviderId, slot: ModelSlot): string {
  return `${id}:${slot}`;
}

/** Mirror resolved settings into the synchronous map. */
function primeSyncCache(resolved: ResolvedProvider[]): void {
  for (const p of resolved) {
    syncModelCache.set(cacheKey(p.id, "chat"), p.models.chat);
    syncModelCache.set(cacheKey(p.id, "fast"), p.models.fast);
    syncModelCache.set(cacheKey(p.id, "embedding"), p.models.embedding);
  }
}

// ─── Per-call model override ────────────────────────────
//
// Per-task routing (lib/ai-routing) lets a task pick a model other than the
// provider's default — "Gemini 3.1-flash-lite for question generation". The
// provider libraries resolve their model id through `modelIdFor`/`getModelFor`
// in dozens of places, so rather than thread a `model` parameter through every
// one of them, the router runs each step inside an async scope and those two
// functions consult it first.
//
// AsyncLocalStorage keeps the override confined to that one call chain:
// concurrent requests, and anything that runs after the step returns, see the
// normal defaults. Embedding models are never overridden — changing one would
// silently mix vector spaces in the index.

const modelOverrideScope = new AsyncLocalStorage<ReadonlyMap<AiProviderId, string>>();

/**
 * Run `fn` with `provider` using `model` for its chat and fast slots. A null or
 * blank model runs `fn` unchanged (provider default). Scopes nest: an inner
 * override wins for its provider and leaves the others as the outer scope set.
 */
export function withModelOverride<T>(
  provider: AiProviderId,
  model: string | null | undefined,
  fn: () => Promise<T>
): Promise<T> {
  const m = model?.trim();
  if (!m) return fn();
  const next = new Map(modelOverrideScope.getStore() ?? []);
  next.set(provider, m);
  return modelOverrideScope.run(next, fn);
}

function overrideFor(id: AiProviderId, slot: ModelSlot): string | null {
  if (slot === "embedding") return null;
  return modelOverrideScope.getStore()?.get(id) ?? null;
}

/**
 * The model id a provider library should use RIGHT NOW, without awaiting.
 *
 * A per-task override (see `withModelOverride`) wins; otherwise reads the
 * mirrored database value when one has been loaded, then env, then the
 * built-in default.
 */
export function modelIdFor(id: AiProviderId, slot: ModelSlot): string | null {
  const override = overrideFor(id, slot);
  if (override) return override;
  const cached = syncModelCache.get(cacheKey(id, slot));
  if (cached !== undefined) return cached;
  return envModelFor(id, slot);
}

/** Force a refresh — called after an admin saves, so changes apply at once. */
export async function refreshModelCache(): Promise<void> {
  try {
    primeSyncCache(await getProviderSettings());
  } catch {
    /* leave the previous values in place */
  }
}
