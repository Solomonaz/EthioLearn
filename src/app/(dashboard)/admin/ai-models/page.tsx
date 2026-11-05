"use client";

/**
 * Admin → AI Models.
 *
 * Two sections, both of which used to require a developer and a deploy:
 *
 *  1. TASKS — each AI task (question generation, tutor, vision …) has its own
 *     ordered chain of provider + model steps. The first step that succeeds
 *     serves the request. This replaced a single provider order shared by every
 *     task, which could not express "Nemotron for questions, Gemini for Bloom
 *     tagging" and which several tasks silently ignored.
 *  2. PROVIDERS — on/off switch, default models, base URL and health per
 *     provider. Turning a provider off skips it in every task.
 *
 * API keys are deliberately absent from this screen. They live in the server's
 * environment; here we only report whether each one is present.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Cpu,
  RefreshCw,
  Save,
  ArrowUp,
  ArrowDown,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  CircleDashed,
  KeyRound,
  Server,
  RotateCcw,
  Activity,
  Plus,
  Trash2,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Spinner } from "@/components/ui/spinner";
import { toast } from "sonner";
import {
  AI_TASKS,
  MAX_CHAIN_STEPS,
  PROVIDER_LABEL,
  stepStatus,
  type AiProvider,
  type AiTask,
  type RouteStep,
  type TaskMeta,
} from "@/lib/ai-tasks";
import { priceFor } from "@/lib/model-pricing";

// ─── Types (mirror /api/admin/ai-models) ─────────────────────────────────────

type ProviderId = AiProvider;
type Slot = "chat" | "fast" | "embedding";

interface Provider {
  id: ProviderId;
  label: string;
  enabled: boolean;
  priority: number;
  models: Record<Slot, string | null>;
  overridden: Record<Slot, boolean>;
  slots: Record<Slot, boolean>;
  baseUrl: string | null;
  defaultBaseUrl: string | null;
  hasKey: boolean;
  keyEnv: string | null;
  local: boolean;
  hint: string;
  lastStatus: string | null;
  lastCheckedAt: string | null;
  lastLatencyMs: number | null;
  lastMessage: string | null;
}

type Chains = Record<AiTask, RouteStep[]>;
type Custom = Record<AiTask, boolean>;

interface Snapshot {
  providers: Provider[];
  routes: Partial<Record<AiTask, RouteStep[]>>;
  ollamaEnabled: boolean;
}

const STATUS_META: Record<
  string,
  { label: string; tone: "success" | "warning" | "error" | "default"; icon: typeof CheckCircle2 }
> = {
  ok: { label: "Working", tone: "success", icon: CheckCircle2 },
  rate_limited: { label: "Rate limited", tone: "warning", icon: AlertTriangle },
  quota_exceeded: { label: "Quota exhausted", tone: "warning", icon: AlertTriangle },
  bad_model: { label: "Model not found", tone: "error", icon: XCircle },
  unauthorized: { label: "Key rejected", tone: "error", icon: XCircle },
  payment_required: { label: "Payment required", tone: "error", icon: XCircle },
  no_key: { label: "No API key", tone: "default", icon: CircleDashed },
  disabled: { label: "Disabled", tone: "default", icon: CircleDashed },
  unreachable: { label: "Unreachable", tone: "error", icon: XCircle },
  error: { label: "Error", tone: "error", icon: XCircle },
};

const INPUT_CLASS =
  "w-full rounded-lg border border-border bg-white px-3 py-2 font-mono text-xs text-text-primary outline-none transition-colors focus:border-primary focus:ring-2 focus:ring-primary/20";

function timeAgo(iso: string | null): string {
  if (!iso) return "never checked";
  const secs = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000));
  if (secs < 60) return `${secs}s ago`;
  if (secs < 3600) return `${Math.round(secs / 60)}m ago`;
  if (secs < 86400) return `${Math.round(secs / 3600)}h ago`;
  return `${Math.round(secs / 86400)}d ago`;
}

/** "$0.75 / $3.75" per 1M tokens, "free" for unbilled, null when unknown. */
function priceLabel(model: string | null): string | null {
  if (!model) return null;
  const p = priceFor(model);
  if (!p) return null;
  if (!p.billed) return "free";
  return `$${p.inputPerMillion} / $${p.outputPerMillion}`;
}

function clone<T>(v: T): T {
  return JSON.parse(JSON.stringify(v));
}

function sameChain(a: RouteStep[], b: RouteStep[]): boolean {
  return (
    a.length === b.length &&
    a.every((s, i) => s.provider === b[i].provider && (s.model ?? null) === (b[i].model ?? null))
  );
}

function chainsFrom(routes: Snapshot["routes"]): { chains: Chains; custom: Custom } {
  const chains = {} as Chains;
  const custom = {} as Custom;
  for (const t of AI_TASKS) {
    const saved = routes[t.id];
    chains[t.id] = clone(saved ?? t.defaultChain);
    custom[t.id] = !!saved;
  }
  return { chains, custom };
}

export default function AiModelsPage() {
  const [providers, setProviders] = useState<Provider[]>([]);
  const [original, setOriginal] = useState<Provider[]>([]);
  const [chains, setChains] = useState<Chains | null>(null);
  const [custom, setCustom] = useState<Custom | null>(null);
  const [originalChains, setOriginalChains] = useState<{ chains: Chains; custom: Custom } | null>(null);
  const [ollamaEnabled, setOllamaEnabled] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [checking, setChecking] = useState<ProviderId | "all" | null>(null);
  const [error, setError] = useState<string | null>(null);

  const apply = useCallback((data: Snapshot) => {
    setProviders(data.providers);
    setOriginal(clone(data.providers));
    const c = chainsFrom(data.routes ?? {});
    setChains(c.chains);
    setCustom(c.custom);
    setOriginalChains(clone(c));
    setOllamaEnabled(!!data.ollamaEnabled);
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/ai-models");
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? "Failed to load");
      apply(await res.json());
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setLoading(false);
    }
  }, [apply]);

  useEffect(() => {
    load();
  }, [load]);

  const providersDirty = useMemo(
    () => JSON.stringify(providers) !== JSON.stringify(original),
    [providers, original]
  );
  const chainsDirty = useMemo(
    () => !!originalChains && JSON.stringify({ chains, custom }) !== JSON.stringify(originalChains),
    [chains, custom, originalChains]
  );
  const dirty = providersDirty || chainsDirty;

  // Reordering a chain and then refreshing or closing the tab used to discard
  // it silently — which reads as "my settings reverted". Ask first.
  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  const providerById = useMemo(() => new Map(providers.map((p) => [p.id, p])), [providers]);

  /** Which tasks currently list each provider — shown on the provider cards. */
  const usedBy = useMemo(() => {
    const m = new Map<ProviderId, string[]>();
    if (!chains) return m;
    for (const t of AI_TASKS) {
      for (const p of new Set(chains[t.id].map((s) => s.provider))) {
        m.set(p, [...(m.get(p) ?? []), t.label]);
      }
    }
    return m;
  }, [chains]);

  // ── Provider edits ─────────────────────────────────────────────────────────

  function patch(id: ProviderId, changes: Partial<Provider>) {
    setProviders((prev) => prev.map((p) => (p.id === id ? { ...p, ...changes } : p)));
  }

  function setModel(id: ProviderId, slot: Slot, value: string) {
    setProviders((prev) =>
      prev.map((p) => (p.id === id ? { ...p, models: { ...p.models, [slot]: value } } : p))
    );
  }

  // ── Chain edits ────────────────────────────────────────────────────────────

  function editChain(task: AiTask, fn: (steps: RouteStep[]) => RouteStep[]) {
    setChains((prev) => (prev ? { ...prev, [task]: fn(prev[task]) } : prev));
    setCustom((prev) => (prev ? { ...prev, [task]: true } : prev));
  }

  function moveStep(task: AiTask, i: number, dir: -1 | 1) {
    editChain(task, (steps) => {
      const j = i + dir;
      if (j < 0 || j >= steps.length) return steps;
      const next = [...steps];
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    });
  }

  function updateStep(task: AiTask, i: number, changes: Partial<RouteStep>) {
    editChain(task, (steps) => steps.map((s, k) => (k === i ? { ...s, ...changes } : s)));
  }

  function removeStep(task: AiTask, i: number) {
    editChain(task, (steps) => steps.filter((_, k) => k !== i));
  }

  function addStep(t: TaskMeta) {
    editChain(t.id, (steps) => {
      if (steps.length >= MAX_CHAIN_STEPS) return steps;
      // Prefer a supported provider not yet in the chain; otherwise repeat the
      // first one (a second model of the same provider is a valid fallback).
      const unused = t.supported.find((p) => !steps.some((s) => s.provider === p));
      return [...steps, { provider: unused ?? t.supported[0], model: null }];
    });
  }

  function resetTask(t: TaskMeta) {
    setChains((prev) => (prev ? { ...prev, [t.id]: clone(t.defaultChain) } : prev));
    setCustom((prev) => (prev ? { ...prev, [t.id]: false } : prev));
  }

  // ── Save / check ───────────────────────────────────────────────────────────

  async function save() {
    if (!chains || !custom || !originalChains) return;

    // Chains: send only tasks that changed. A chain identical to the built-in
    // default is saved as "default" (null) so future default changes reach it.
    const routes: Record<string, RouteStep[] | null> = {};
    for (const t of AI_TASKS) {
      const steps = chains[t.id].map((s) => ({ provider: s.provider, model: s.model?.trim() || null }));
      const isDefault = !custom[t.id] || sameChain(steps, t.defaultChain);
      const wasDefault = !originalChains.custom[t.id];
      if (isDefault && wasDefault) continue;
      if (!isDefault && !wasDefault && sameChain(steps, originalChains.chains[t.id])) continue;
      if (!isDefault && steps.length === 0) {
        const msg = `${t.label} needs at least one step.`;
        setError(msg);
        toast.error(msg);
        return;
      }
      routes[t.id] = isDefault ? null : steps;
    }

    // Providers: send only the fields that actually changed, so saving never
    // pins today's env/default model into the database as an override.
    const origById = new Map(original.map((p) => [p.id, p]));
    const providerPatches = providers
      .map((p) => {
        const o = origById.get(p.id);
        const out: Record<string, unknown> = { id: p.id };
        if (!o || o.enabled !== p.enabled) out.enabled = p.enabled;
        for (const slot of ["chat", "fast", "embedding"] as Slot[]) {
          if (p.slots[slot] && (!o || (o.models[slot] ?? "") !== (p.models[slot] ?? ""))) {
            out[`${slot}Model`] = p.models[slot] ?? "";
          }
        }
        if (!o || (o.baseUrl ?? "") !== (p.baseUrl ?? "")) out.baseUrl = p.baseUrl ?? "";
        return out;
      })
      .filter((p) => Object.keys(p).length > 1);

    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/ai-models", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...(providerPatches.length ? { providers: providerPatches } : {}),
          ...(Object.keys(routes).length ? { routes } : {}),
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? "Save failed");
      apply(body);
      toast.success("AI model settings saved — applied immediately.");
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Save failed";
      setError(msg);
      toast.error(msg);
    } finally {
      setSaving(false);
    }
  }

  async function check(ids?: ProviderId[]) {
    setChecking(ids && ids.length === 1 ? ids[0] : "all");
    try {
      // Send the model ids currently in the FORM, including unsaved edits, so
      // the button tests what the admin is looking at rather than what is
      // still in the database.
      const models: Record<string, string> = {};
      for (const p of providers) {
        const m = (p.models.chat ?? "").trim();
        if (m && (!ids || ids.includes(p.id))) models[p.id] = m;
      }
      const res = await fetch("/api/admin/ai-models/check", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...(ids ? { ids } : {}), models }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? "Check failed");
      const byId = new Map(
        (body.results as { id: ProviderId; status: string; latencyMs: number | null; message: string; model: string | null }[]).map(
          (r) => [r.id, r]
        )
      );
      setProviders((prev) =>
        prev.map((p) => {
          const r = byId.get(p.id);
          return r
            ? {
                ...p,
                lastStatus: r.status,
                lastLatencyMs: r.latencyMs,
                lastMessage: r.model ? `[${r.model}] ${r.message}` : r.message,
                lastCheckedAt: new Date().toISOString(),
              }
            : p;
        })
      );
      // Probe results are informational — they must not count as unsaved edits.
      setOriginal((prev) =>
        prev.map((p) => {
          const r = byId.get(p.id);
          return r
            ? {
                ...p,
                lastStatus: r.status,
                lastLatencyMs: r.latencyMs,
                lastMessage: r.model ? `[${r.model}] ${r.message}` : r.message,
                lastCheckedAt: new Date().toISOString(),
              }
            : p;
        })
      );
      const bad = (body.results as { status: string }[]).filter(
        (r) => !["ok", "disabled", "no_key"].includes(r.status)
      ).length;
      if (bad === 0) toast.success("All checked providers responded.");
      else toast.warning(`${bad} provider${bad > 1 ? "s" : ""} need attention.`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Check failed");
    } finally {
      setChecking(null);
    }
  }

  if (loading || !chains || !custom) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        {error ? <p className="text-sm text-error">{error}</p> : <Spinner />}
      </div>
    );
  }

  return (
    <div className="space-y-6 pb-16">
      {/* ── Header ─────────────────────────────────────────────────────── */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold text-text-primary">
            <Cpu className="h-6 w-6 text-primary" />
            AI Models
          </h1>
          <p className="mt-1 max-w-2xl text-sm text-text-secondary">
            Pick the provider and model for each AI task, with fallbacks. Steps run top to
            bottom; the first that succeeds serves the request. Saving applies immediately.
          </p>
        </div>
        <div className="flex shrink-0 gap-2">
          <Button
            variant="outline"
            onClick={() => check()}
            isLoading={checking === "all"}
            disabled={!!checking || saving}
          >
            <Activity className="mr-2 h-4 w-4" />
            Check all
          </Button>
          <Button onClick={save} isLoading={saving} disabled={!dirty || saving || !!checking}>
            <Save className="mr-2 h-4 w-4" />
            {dirty ? "Save changes" : "Saved"}
          </Button>
        </div>
      </div>

      {error && (
        <div className="flex items-start gap-2 rounded-lg border border-error/30 bg-red-50 p-4 text-sm text-error">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {/* ── Tasks ──────────────────────────────────────────────────────── */}
      <section className="space-y-3">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-lg font-semibold text-text-primary">Tasks</h2>
          {chainsDirty && <span className="text-xs font-medium text-warning">Unsaved — not live yet</span>}
        </div>

        {/* One datalist per provider: its default models, as suggestions. */}
        {providers.map((p) => (
          <datalist key={p.id} id={`models-${p.id}`}>
            {[...new Set([p.models.chat, p.models.fast].filter(Boolean) as string[])].map((m) => (
              <option key={m} value={m} />
            ))}
          </datalist>
        ))}

        <div className="grid gap-4 xl:grid-cols-2">
          {AI_TASKS.map((t) => {
            const steps = chains[t.id];
            const statuses = steps.map((s) => {
              const p = providerById.get(s.provider);
              return stepStatus(
                t.id,
                s,
                p ? { id: p.id, enabled: p.enabled, hasKey: p.hasKey, models: { chat: p.models.chat, fast: p.models.fast } } : undefined,
                ollamaEnabled
              );
            });
            const runnable = steps
              .map((s, i) => ({ s, st: statuses[i] }))
              .filter(({ st }) => !st.skip);
            const nvidiaNotLast =
              t.id === "chapter-detection" &&
              steps.some((s, i) => s.provider === "NVIDIA" && steps.slice(i + 1).some((x) => x.provider !== "NVIDIA"));

            return (
              <Card key={t.id}>
                <CardContent className="p-4">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <h3 className="font-semibold text-text-primary">{t.label}</h3>
                        {custom[t.id] ? <Badge variant="info">custom</Badge> : <Badge>default</Badge>}
                      </div>
                      <p className="mt-0.5 text-xs text-text-secondary">{t.description}</p>
                    </div>
                    {custom[t.id] && (
                      <Button variant="ghost" size="sm" onClick={() => resetTask(t)}>
                        <RotateCcw className="mr-1.5 h-3.5 w-3.5" />
                        Reset
                      </Button>
                    )}
                  </div>

                  {/* Steps */}
                  <ol className="mt-3 space-y-2">
                    {steps.map((s, i) => {
                      const st = statuses[i];
                      const price = priceLabel(st.effectiveModel);
                      return (
                        <li
                          key={i}
                          className={`rounded-lg border border-border p-2 ${st.skip ? "bg-gray-50 opacity-70" : ""}`}
                        >
                          {/* Phone: number, provider, buttons on one line and the
                              model on its own line. sm+: all on one line. */}
                          <div className="flex flex-wrap items-center gap-2 sm:flex-nowrap">
                            <span className="w-4 shrink-0 text-center text-xs font-bold tabular-nums text-text-secondary">
                              {i + 1}
                            </span>
                            <select
                              aria-label={`${t.label} step ${i + 1} provider`}
                              value={s.provider}
                              onChange={(e) =>
                                updateStep(t.id, i, { provider: e.target.value as AiProvider, model: null })
                              }
                              className="min-w-0 flex-1 rounded-lg border border-border bg-white px-2 py-2 text-xs text-text-primary outline-none focus:border-primary focus:ring-2 focus:ring-primary/20 sm:w-36 sm:flex-none"
                            >
                              {t.supported.map((p) => (
                                <option key={p} value={p}>
                                  {PROVIDER_LABEL[p]}
                                </option>
                              ))}
                            </select>
                            <input
                              aria-label={`${t.label} step ${i + 1} model`}
                              type="text"
                              list={`models-${s.provider}`}
                              spellCheck={false}
                              autoComplete="off"
                              value={s.model ?? ""}
                              onChange={(e) => updateStep(t.id, i, { model: e.target.value || null })}
                              placeholder={
                                st.effectiveModel && !s.model ? `default: ${st.effectiveModel}` : "model id"
                              }
                              className={`${INPUT_CLASS} order-last ml-6 min-w-0 basis-[calc(100%-1.5rem)] py-2 sm:order-none sm:ml-0 sm:flex-1 sm:basis-auto`}
                            />
                            <div className="flex shrink-0 items-center">
                              <button
                                type="button"
                                aria-label="Move up"
                                disabled={i === 0}
                                onClick={() => moveStep(t.id, i, -1)}
                                className="rounded p-1 text-text-secondary hover:bg-gray-100 hover:text-text-primary disabled:pointer-events-none disabled:opacity-30"
                              >
                                <ArrowUp className="h-3.5 w-3.5" />
                              </button>
                              <button
                                type="button"
                                aria-label="Move down"
                                disabled={i === steps.length - 1}
                                onClick={() => moveStep(t.id, i, 1)}
                                className="rounded p-1 text-text-secondary hover:bg-gray-100 hover:text-text-primary disabled:pointer-events-none disabled:opacity-30"
                              >
                                <ArrowDown className="h-3.5 w-3.5" />
                              </button>
                              <button
                                type="button"
                                aria-label="Remove step"
                                disabled={steps.length === 1}
                                onClick={() => removeStep(t.id, i)}
                                className="rounded p-1 text-text-secondary hover:bg-red-50 hover:text-error disabled:pointer-events-none disabled:opacity-30"
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                              </button>
                            </div>
                          </div>
                          {(st.skip || price) && (
                            <p className="mt-1 pl-6 text-[11px] text-text-secondary">
                              {st.skip ? (
                                <span className="text-warning">Skipped: {st.skip}</span>
                              ) : (
                                <span>{price === "free" ? "Free tier" : `${price} per 1M tokens (in / out)`}</span>
                              )}
                            </p>
                          )}
                        </li>
                      );
                    })}
                  </ol>

                  <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => addStep(t)}
                      disabled={steps.length >= MAX_CHAIN_STEPS}
                    >
                      <Plus className="mr-1.5 h-3.5 w-3.5" />
                      Add fallback
                    </Button>
                    {runnable.length === 0 && (
                      <span className="text-xs font-medium text-error">
                        Nothing in this chain can run — this task will fail.
                      </span>
                    )}
                  </div>

                  {nvidiaNotLast && (
                    <p className="mt-2 flex items-start gap-1.5 text-xs text-warning">
                      <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                      NVIDIA Nemotron has invented chapters in testing, which corrupts a textbook
                      split. Keep it last.
                    </p>
                  )}
                  {t.note && <p className="mt-2 text-[11px] leading-snug text-text-secondary">{t.note}</p>}
                </CardContent>
              </Card>
            );
          })}
        </div>
        <p className="text-xs text-text-secondary">
          Embeddings (semantic search and duplicate detection) are not routed per task: changing
          the embedding model would mix incompatible vectors in the index. Set it on the Gemini
          provider below.
        </p>
      </section>

      {/* ── Providers ──────────────────────────────────────────────────── */}
      <section className="space-y-3">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-lg font-semibold text-text-primary">Providers</h2>
          {providersDirty && <span className="text-xs font-medium text-warning">Unsaved — not live yet</span>}
        </div>
        <p className="-mt-1 text-xs text-text-secondary">
          Turning a provider off skips it in every task. Default models are used by any task step
          that leaves its model blank.
        </p>

        <div className="space-y-4">
          {providers.map((p) => {
            const meta = STATUS_META[p.lastStatus ?? ""] ?? null;
            const StatusIcon = meta?.icon;
            const tasks = usedBy.get(p.id) ?? [];
            const fields: { slot: Slot; label: string; help: string }[] = [
              { slot: "chat", label: "Default model", help: "Used when a task step leaves its model blank." },
              ...(p.slots.fast && (p.id === "GEMINI" || p.id === "GEMINI_VERTEX")
                ? [{ slot: "fast" as Slot, label: "Default light model", help: "Blank-model default for Bloom tagging, quality checks, tutor and search rewrite." }]
                : []),
              ...(p.slots.embedding
                ? [{ slot: "embedding" as Slot, label: "Embedding model", help: "Semantic search and duplicate detection. Changing it means re-processing textbooks." }]
                : []),
            ];

            return (
              <Card key={p.id} className={p.enabled ? "" : "opacity-70"}>
                <CardContent className="p-5">
                  {/* Card header */}
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                        <h3 className="font-semibold text-text-primary">{p.label}</h3>
                        {p.local && <Badge variant="info">local</Badge>}
                        {meta && (
                          <Badge variant={meta.tone}>
                            <span className="inline-flex items-center gap-1">
                              {StatusIcon && <StatusIcon className="h-3 w-3" />}
                              {meta.label}
                              {p.lastLatencyMs != null && p.lastStatus === "ok" && (
                                <span className="tabular-nums"> · {p.lastLatencyMs} ms</span>
                              )}
                            </span>
                          </Badge>
                        )}
                      </div>
                      <p className="mt-1 max-w-xl text-xs text-text-secondary">{p.hint}</p>
                      <p className="mt-1 max-w-xl text-xs text-text-secondary">
                        {tasks.length ? (
                          <>
                            <span className="font-medium text-text-primary">Used by:</span> {tasks.join(", ")}
                          </>
                        ) : (
                          "Not used by any task."
                        )}
                      </p>
                    </div>

                    {/* Enable toggle */}
                    <label className="flex shrink-0 cursor-pointer items-center gap-2">
                      <span className="text-xs font-medium text-text-secondary">
                        {p.enabled ? "Enabled" : "Disabled"}
                      </span>
                      <span className="relative inline-flex">
                        <input
                          type="checkbox"
                          className="peer sr-only"
                          checked={p.enabled}
                          onChange={(e) => patch(p.id, { enabled: e.target.checked })}
                        />
                        <span className="h-6 w-11 rounded-full bg-gray-300 transition-colors peer-checked:bg-primary peer-focus-visible:ring-2 peer-focus-visible:ring-primary/40" />
                        <span className="absolute left-0.5 top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform peer-checked:translate-x-5" />
                      </span>
                    </label>
                  </div>

                  {/* Model fields */}
                  <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                    {fields
                      .filter(({ slot }) => p.slots[slot])
                      .map(({ slot, label, help }) => (
                        <div key={slot}>
                          <label
                            htmlFor={`${p.id}-${slot}`}
                            className="mb-1 flex items-center justify-between text-xs font-medium text-text-primary"
                          >
                            <span>{label}</span>
                            {p.overridden[slot] && <span className="font-normal text-info">custom</span>}
                          </label>
                          <input
                            id={`${p.id}-${slot}`}
                            type="text"
                            spellCheck={false}
                            autoComplete="off"
                            value={p.models[slot] ?? ""}
                            onChange={(e) => setModel(p.id, slot, e.target.value)}
                            placeholder="model id"
                            className={INPUT_CLASS}
                          />
                          <p className="mt-1 text-[11px] leading-snug text-text-secondary">{help}</p>
                        </div>
                      ))}
                  </div>

                  {/* Base URL — only where overriding it is meaningful */}
                  {(p.id === "OLLAMA" || p.id === "OPENROUTER") && (
                    <div className="mt-4">
                      <label htmlFor={`${p.id}-base`} className="mb-1 block text-xs font-medium text-text-primary">
                        API base URL
                      </label>
                      <input
                        id={`${p.id}-base`}
                        type="text"
                        spellCheck={false}
                        autoComplete="off"
                        value={p.baseUrl ?? ""}
                        onChange={(e) => patch(p.id, { baseUrl: e.target.value })}
                        placeholder={p.defaultBaseUrl ?? ""}
                        className={INPUT_CLASS}
                      />
                    </div>
                  )}

                  {/* Footer */}
                  <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-border pt-3">
                    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-text-secondary">
                      <span className="inline-flex items-center gap-1.5">
                        <KeyRound className="h-3.5 w-3.5" />
                        {p.keyEnv ? (
                          p.hasKey ? (
                            <span className="text-success">{p.keyEnv} set</span>
                          ) : (
                            <span className="text-error">{p.keyEnv} missing</span>
                          )
                        ) : (
                          <span>no key required</span>
                        )}
                      </span>
                      <span className="inline-flex items-center gap-1.5">
                        <Server className="h-3.5 w-3.5" />
                        checked {timeAgo(p.lastCheckedAt)}
                      </span>
                    </div>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => check([p.id])}
                      isLoading={checking === p.id}
                      disabled={!!checking || saving}
                    >
                      <RefreshCw className="mr-1.5 h-3.5 w-3.5" />
                      Test
                    </Button>
                  </div>

                  {/* Probe detail — the actual provider message, verbatim */}
                  {p.lastMessage && p.lastStatus !== "ok" && (
                    <p className="mt-3 break-words rounded-lg bg-gray-50 p-3 font-mono text-[11px] leading-relaxed text-text-secondary">
                      {p.lastMessage}
                    </p>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      </section>

      {/* ── Footer notes ───────────────────────────────────────────────── */}
      <Card>
        <CardContent className="space-y-2 p-4 text-xs text-text-secondary">
          <p className="flex items-start gap-2">
            <KeyRound className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <span>
              <strong className="text-text-primary">API keys are not editable here.</strong> They
              are read from the server environment, so they never reach a browser, a database row
              or a backup. To add one, set it in <code className="font-mono">.env</code> and
              restart.
            </span>
          </p>
          <p className="flex items-start gap-2">
            <RotateCcw className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <span>
              Leave a step&apos;s model blank to use the provider&apos;s default. Clear a provider&apos;s
              default model to fall back to the environment variable, then the built-in default.
            </span>
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
