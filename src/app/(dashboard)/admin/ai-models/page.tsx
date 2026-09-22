"use client";

/**
 * Admin → AI Models.
 *
 * Two jobs, both of which used to require a developer and a deploy:
 *
 *  1. Point a provider at a different model id, because providers retire ids on
 *     their own schedule (llama-3.3-70b started answering 410 Gone; DeepSeek
 *     renamed the same model three times in a few months).
 *  2. Re-order the fallback chain, because the provider that is out of daily
 *     quota changes from day to day.
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
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Spinner } from "@/components/ui/spinner";
import { toast } from "sonner";

// ─── Types (mirror /api/admin/ai-models) ─────────────────────────────────────

type ProviderId = "GEMINI" | "GROQ" | "NVIDIA" | "OPENROUTER" | "OLLAMA";
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

const SLOT_LABEL: Record<Slot, string> = {
  chat: "Flagship model",
  fast: "Fast model",
  embedding: "Embedding model",
};

const SLOT_HELP: Record<Slot, string> = {
  chat: "Question generation, chapter detection, the answer verifier, vision",
  fast: "Bloom tagging, quality checks, tutor fallback",
  embedding: "Semantic search and duplicate detection",
};

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

function timeAgo(iso: string | null): string {
  if (!iso) return "never checked";
  const secs = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000));
  if (secs < 60) return `${secs}s ago`;
  if (secs < 3600) return `${Math.round(secs / 60)}m ago`;
  if (secs < 86400) return `${Math.round(secs / 3600)}h ago`;
  return `${Math.round(secs / 86400)}d ago`;
}

export default function AiModelsPage() {
  const [providers, setProviders] = useState<Provider[]>([]);
  const [original, setOriginal] = useState<Provider[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [checking, setChecking] = useState<ProviderId | "all" | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/ai-models");
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? "Failed to load");
      const data = await res.json();
      setProviders(data.providers);
      setOriginal(JSON.parse(JSON.stringify(data.providers)));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const dirty = useMemo(
    () => JSON.stringify(providers) !== JSON.stringify(original),
    [providers, original]
  );

  /** The order the server will actually try, mirroring getProviderChain(). */
  const effectiveChain = useMemo(
    () =>
      [...providers]
        .sort((a, b) => a.priority - b.priority)
        .filter((p) => p.enabled && p.hasKey && p.models.chat),
    [providers]
  );

  function patch(id: ProviderId, changes: Partial<Provider>) {
    setProviders((prev) => prev.map((p) => (p.id === id ? { ...p, ...changes } : p)));
  }

  function setModel(id: ProviderId, slot: Slot, value: string) {
    setProviders((prev) =>
      prev.map((p) => (p.id === id ? { ...p, models: { ...p.models, [slot]: value } } : p))
    );
  }

  /** Swap priorities with the neighbour, so the chain re-orders by one step. */
  function move(id: ProviderId, dir: -1 | 1) {
    setProviders((prev) => {
      const sorted = [...prev].sort((a, b) => a.priority - b.priority);
      const i = sorted.findIndex((p) => p.id === id);
      const j = i + dir;
      if (i < 0 || j < 0 || j >= sorted.length) return prev;
      // Re-number the whole list so ties and gaps can never accumulate.
      const reordered = [...sorted];
      [reordered[i], reordered[j]] = [reordered[j], reordered[i]];
      const renumbered = reordered.map((p, idx) => ({ ...p, priority: (idx + 1) * 10 }));
      return prev.map((p) => renumbered.find((r) => r.id === p.id) ?? p);
    });
  }

  async function save() {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/ai-models", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          providers: providers.map((p) => ({
            id: p.id,
            enabled: p.enabled,
            priority: p.priority,
            chatModel: p.slots.chat ? p.models.chat ?? "" : undefined,
            fastModel: p.slots.fast ? p.models.fast ?? "" : undefined,
            embeddingModel: p.slots.embedding ? p.models.embedding ?? "" : undefined,
            baseUrl: p.baseUrl ?? "",
          })),
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? "Save failed");
      setProviders(body.providers);
      setOriginal(JSON.parse(JSON.stringify(body.providers)));
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
      const res = await fetch("/api/admin/ai-models/check", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(ids ? { ids } : {}),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? "Check failed");
      const byId = new Map(
        (body.results as { id: ProviderId; status: string; latencyMs: number | null; message: string }[]).map(
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
                lastMessage: r.message,
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
            ? { ...p, lastStatus: r.status, lastLatencyMs: r.latencyMs, lastMessage: r.message, lastCheckedAt: new Date().toISOString() }
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

  if (loading) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <Spinner />
      </div>
    );
  }

  const sorted = [...providers].sort((a, b) => a.priority - b.priority);

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
            Change model ids and fallback order without a deploy. Providers are tried top to
            bottom; the first that succeeds serves the request.
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

      {/* ── Effective chain preview ────────────────────────────────────── */}
      <Card>
        <CardContent className="p-4">
          <div className="mb-3 flex items-center justify-between gap-3">
            <h2 className="text-sm font-semibold text-text-primary">Effective order</h2>
            {dirty && (
              <span className="text-xs font-medium text-warning">Unsaved — not live yet</span>
            )}
          </div>
          {effectiveChain.length === 0 ? (
            <p className="text-sm text-error">
              Nothing can serve a request. Enable a provider that has an API key and a model id.
            </p>
          ) : (
            <div className="flex flex-wrap items-center gap-2">
              {effectiveChain.map((p, i) => (
                <div key={p.id} className="flex items-center gap-2">
                  {i > 0 && <span className="text-text-secondary">→</span>}
                  <span className="rounded-full border border-border bg-gray-50 px-3 py-1 text-xs font-medium text-text-primary">
                    {p.label}
                    <span className="ml-1.5 font-mono text-[11px] text-text-secondary">
                      {p.models.chat}
                    </span>
                  </span>
                </div>
              ))}
            </div>
          )}
          <p className="mt-3 text-xs text-text-secondary">
            Chapter detection always tries NVIDIA last regardless of this order — it reliably
            invents chapters, which would corrupt a textbook split.
          </p>
        </CardContent>
      </Card>

      {/* ── Provider cards ─────────────────────────────────────────────── */}
      <div className="space-y-4">
        {sorted.map((p, idx) => {
          const meta = STATUS_META[p.lastStatus ?? ""] ?? null;
          const StatusIcon = meta?.icon;
          const inChain = p.enabled && p.hasKey && !!p.models.chat;

          return (
            <Card key={p.id} className={p.enabled ? "" : "opacity-70"}>
              <CardContent className="p-5">
                {/* Card header */}
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="flex items-start gap-3">
                    <div className="flex flex-col items-center gap-1 pt-0.5">
                      <button
                        type="button"
                        aria-label={`Move ${p.label} earlier`}
                        disabled={idx === 0}
                        onClick={() => move(p.id, -1)}
                        className="rounded p-0.5 text-text-secondary transition-colors hover:bg-gray-100 hover:text-text-primary disabled:pointer-events-none disabled:opacity-30"
                      >
                        <ArrowUp className="h-4 w-4" />
                      </button>
                      <span className="text-xs font-bold tabular-nums text-text-secondary">
                        {idx + 1}
                      </span>
                      <button
                        type="button"
                        aria-label={`Move ${p.label} later`}
                        disabled={idx === sorted.length - 1}
                        onClick={() => move(p.id, 1)}
                        className="rounded p-0.5 text-text-secondary transition-colors hover:bg-gray-100 hover:text-text-primary disabled:pointer-events-none disabled:opacity-30"
                      >
                        <ArrowDown className="h-4 w-4" />
                      </button>
                    </div>

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
                        {!inChain && p.enabled && (
                          <Badge variant="default">not in chain</Badge>
                        )}
                      </div>
                      <p className="mt-1 max-w-xl text-xs text-text-secondary">{p.hint}</p>
                    </div>
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
                  {(["chat", "fast", "embedding"] as Slot[])
                    .filter((slot) => p.slots[slot])
                    .map((slot) => (
                      <div key={slot}>
                        <label
                          htmlFor={`${p.id}-${slot}`}
                          className="mb-1 flex items-center justify-between text-xs font-medium text-text-primary"
                        >
                          <span>{SLOT_LABEL[slot]}</span>
                          {p.overridden[slot] && (
                            <span className="font-normal text-info">custom</span>
                          )}
                        </label>
                        <input
                          id={`${p.id}-${slot}`}
                          type="text"
                          spellCheck={false}
                          autoComplete="off"
                          value={p.models[slot] ?? ""}
                          onChange={(e) => setModel(p.id, slot, e.target.value)}
                          placeholder="model id"
                          className="w-full rounded-lg border border-border bg-white px-3 py-2 font-mono text-xs text-text-primary outline-none transition-colors focus:border-primary focus:ring-2 focus:ring-primary/20"
                        />
                        <p className="mt-1 text-[11px] leading-snug text-text-secondary">
                          {SLOT_HELP[slot]}
                        </p>
                      </div>
                    ))}
                </div>

                {/* Base URL — only where overriding it is meaningful */}
                {(p.id === "OLLAMA" || p.id === "OPENROUTER") && (
                  <div className="mt-4">
                    <label
                      htmlFor={`${p.id}-base`}
                      className="mb-1 block text-xs font-medium text-text-primary"
                    >
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
                      className="w-full rounded-lg border border-border bg-white px-3 py-2 font-mono text-xs text-text-primary outline-none transition-colors focus:border-primary focus:ring-2 focus:ring-primary/20"
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
              Clear a model field to fall back to the environment variable, then the built-in
              default. Saving applies immediately — no redeploy.
            </span>
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
