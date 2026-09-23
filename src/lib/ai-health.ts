/**
 * Live provider health probes.
 *
 * Answers the question an admin actually has during an incident: *which
 * providers are working right now, and which one is out of quota?* A failing
 * provider today is invisible — the chain silently falls through to the next
 * one, so `meta/llama-3.3-70b-instruct` answered 410 Gone for an unknown period
 * before anyone read the logs. This turns that into a status light.
 *
 * Each probe is the smallest real request the provider will accept, against the
 * model id currently configured. That matters: a probe against a hardcoded
 * model would report "ok" while the model the system actually uses is dead.
 *
 * Probes are advisory only. Nothing in the routing chain reads the stored
 * status, because a stale probe must never disable a provider that works.
 */

import { AiProviderId } from "@prisma/client";
import { db } from "./db";
import { getProviderSettings, PROVIDER_META, type ResolvedProvider } from "./ai-settings";

export type ProbeStatus =
  | "ok"
  | "rate_limited"
  | "quota_exceeded"
  | "bad_model"
  | "unauthorized"
  | "payment_required"
  | "no_key"
  | "disabled"
  | "unreachable"
  | "error";

export interface ProbeResult {
  id: AiProviderId;
  status: ProbeStatus;
  latencyMs: number | null;
  message: string;
  model: string | null;
}

/** Human-readable meaning for each status, shown in the admin UI. */
export const STATUS_COPY: Record<ProbeStatus, { label: string; tone: "good" | "warn" | "bad" | "idle" }> = {
  ok: { label: "Working", tone: "good" },
  rate_limited: { label: "Rate limited", tone: "warn" },
  quota_exceeded: { label: "Quota exhausted", tone: "warn" },
  bad_model: { label: "Model not found", tone: "bad" },
  unauthorized: { label: "Key rejected", tone: "bad" },
  payment_required: { label: "Payment required", tone: "bad" },
  no_key: { label: "No API key", tone: "idle" },
  disabled: { label: "Disabled", tone: "idle" },
  unreachable: { label: "Unreachable", tone: "bad" },
  error: { label: "Error", tone: "bad" },
};

/**
 * Turn an HTTP status + body into one of our statuses.
 *
 * 429 is split deliberately: providers use it both for "too fast, retry in a
 * second" and for "your daily allowance is gone". Those need different actions
 * from an admin — wait versus re-prioritise — so the body is inspected for the
 * words providers actually use.
 */
function classify(httpStatus: number, body: string): { status: ProbeStatus; message: string } {
  const snippet = body.slice(0, 200).replace(/\s+/g, " ").trim();
  const lower = body.toLowerCase();

  if (httpStatus === 401 || httpStatus === 403) {
    return { status: "unauthorized", message: snippet || "Key rejected by provider." };
  }
  if (httpStatus === 402) {
    return { status: "payment_required", message: snippet || "Account has no balance." };
  }
  if (httpStatus === 404 || httpStatus === 410) {
    return {
      status: "bad_model",
      message: snippet || "Model id not found — it may have been retired.",
    };
  }
  if (httpStatus === 429) {
    const daily =
      lower.includes("quota") ||
      lower.includes("daily") ||
      lower.includes("per day") ||
      lower.includes("exhausted") ||
      lower.includes("limit reached");
    return {
      status: daily ? "quota_exceeded" : "rate_limited",
      message: snippet || (daily ? "Daily allowance exhausted." : "Too many requests — retry shortly."),
    };
  }
  if (httpStatus === 400 && (lower.includes("model") || lower.includes("not_found"))) {
    return { status: "bad_model", message: snippet || "Provider rejected the model id." };
  }
  return { status: "error", message: `HTTP ${httpStatus}${snippet ? ` — ${snippet}` : ""}` };
}

const PROBE_TIMEOUT_MS = 25_000;

/** Smallest possible OpenAI-compatible chat call. */
async function probeOpenAiCompatible(
  base: string,
  apiKey: string,
  model: string
): Promise<{ ok: boolean; httpStatus: number; body: string }> {
  const res = await fetch(`${base}/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model,
      messages: [{ role: "user", content: "ok" }],
      max_tokens: 1,
    }),
    signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
  });
  return { ok: res.ok, httpStatus: res.status, body: res.ok ? "" : await res.text().catch(() => "") };
}

async function probeGemini(model: string): Promise<{ ok: boolean; httpStatus: number; body: string }> {
  const key = process.env.GEMINI_API_KEY!;
  const base = PROVIDER_META.GEMINI.defaultBaseUrl;
  const res = await fetch(`${base}/models/${encodeURIComponent(model)}:generateContent?key=${key}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ parts: [{ text: "ok" }] }],
      generationConfig: { maxOutputTokens: 1 },
    }),
    signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
  });
  return { ok: res.ok, httpStatus: res.status, body: res.ok ? "" : await res.text().catch(() => "") };
}

async function probeOllama(base: string, model: string): Promise<{ ok: boolean; httpStatus: number; body: string }> {
  // Ollama answers 404 for a model that was never pulled, which is exactly the
  // "bad model" signal we want — so probe the model, not just the server.
  const res = await fetch(`${base}/api/show`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model }),
    signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
  });
  return { ok: res.ok, httpStatus: res.status, body: res.ok ? "" : await res.text().catch(() => "") };
}

/**
 * Probe one provider.
 *
 * `modelOverride` lets the admin screen test the model id currently TYPED into
 * the form rather than the one saved in the database. Without it, editing a
 * model and pressing Test reports on the old value — which reads as the button
 * being broken, because the error names a model no longer on screen.
 */
export async function probeProvider(
  p: ResolvedProvider,
  modelOverride?: string | null
): Promise<ProbeResult> {
  const model =
    modelOverride?.trim() || p.models.chat || p.models.fast || p.models.embedding;
  const base = { id: p.id, model } as const;

  if (!p.enabled) {
    return { ...base, status: "disabled", latencyMs: null, message: "Disabled in settings." };
  }
  if (!p.hasKey) {
    const env = PROVIDER_META[p.id].keyEnv;
    return { ...base, status: "no_key", latencyMs: null, message: `${env} is not set in the environment.` };
  }
  if (!model) {
    return { ...base, status: "bad_model", latencyMs: null, message: "No model id configured." };
  }

  const started = Date.now();
  try {
    let r: { ok: boolean; httpStatus: number; body: string };
    if (p.id === "GEMINI") {
      r = await probeGemini(model);
    } else if (p.id === "OLLAMA") {
      r = await probeOllama(p.baseUrl || "http://localhost:11434", model);
    } else {
      const keyEnv = PROVIDER_META[p.id].keyEnv!;
      r = await probeOpenAiCompatible(p.baseUrl!, process.env[keyEnv]!, model);
    }
    const latencyMs = Date.now() - started;
    if (r.ok) {
      return { ...base, status: "ok", latencyMs, message: `Responded in ${latencyMs} ms.` };
    }
    const { status, message } = classify(r.httpStatus, r.body);
    return { ...base, status, latencyMs, message };
  } catch (err) {
    const latencyMs = Date.now() - started;
    const msg = err instanceof Error ? err.message : String(err);
    const timedOut = /timeout|abort/i.test(msg);
    return {
      ...base,
      status: timedOut ? "unreachable" : "error",
      latencyMs,
      message: timedOut ? `No response within ${PROBE_TIMEOUT_MS / 1000}s.` : msg.slice(0, 200),
    };
  }
}

/**
 * Probe every provider (or the named ones) in parallel and persist the result.
 *
 * Parallel is safe here: each probe is one tiny request to a DIFFERENT provider,
 * so there is no per-provider burst that could itself trigger a 429.
 */
export async function probeAll(
  ids?: AiProviderId[],
  /** Unsaved model ids from the admin form, keyed by provider. */
  modelOverrides?: Partial<Record<AiProviderId, string>>
): Promise<ProbeResult[]> {
  const all = await getProviderSettings();
  const targets = ids?.length ? all.filter((p) => ids.includes(p.id)) : all;

  const results = await Promise.all(
    targets.map((p) => probeProvider(p, modelOverrides?.[p.id]))
  );

  // Only record a probe that tested the SAVED configuration. Persisting the
  // result of an unsaved experiment would leave the dashboard asserting a
  // status for a model the system is not actually using.
  const saved = new Map(targets.map((p) => [p.id, p.models.chat ?? p.models.fast ?? p.models.embedding]));
  const persistable = results.filter((r) => r.model === saved.get(r.id));

  await Promise.all(
    persistable.map((r) =>
      db.aiProviderConfig
        .upsert({
          where: { id: r.id },
          create: {
            id: r.id,
            priority: PROVIDER_META[r.id].defaultPriority,
            lastStatus: r.status,
            lastCheckedAt: new Date(),
            lastLatencyMs: r.latencyMs,
            lastMessage: r.message,
          },
          update: {
            lastStatus: r.status,
            lastCheckedAt: new Date(),
            lastLatencyMs: r.latencyMs,
            lastMessage: r.message,
          },
        })
        // A failure to RECORD a probe must not fail the probe itself.
        .catch(() => undefined)
    )
  );

  return results;
}
