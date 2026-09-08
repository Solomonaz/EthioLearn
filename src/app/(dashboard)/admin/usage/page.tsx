"use client";

import { useCallback, useEffect, useState } from "react";
import {
  Coins,
  Cpu,
  RefreshCw,
  AlertCircle,
  AlertTriangle,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { Badge } from "@/components/ui/badge";

// ─── Types (mirror /api/admin/usage) ──────────────────────────────────────────

interface FeatureRow {
  feature: string;
  calls: number;
  promptTokens: number;
  outputTokens: number;
  thinkingTokens: number;
  totalTokens: number;
  costUsd: number;
  hasUnpriced: boolean;
}

interface DetailRow extends FeatureRow {
  provider: string;
  model: string;
}

interface UsageData {
  note: string;
  period: string;
  currency: string;
  fxPerUsd: number;
  totalTokens: number;
  totalCostUsd: number;
  totalCost: number;
  anyUnpriced: boolean;
  byFeature: FeatureRow[];
  detail: DetailRow[];
}

type Period = "today" | "7d" | "30d" | "all";
const PERIOD_LABELS: Record<Period, string> = {
  today: "Today",
  "7d": "Last 7 days",
  "30d": "Last 30 days",
  all: "All time",
};

// Friendly names for the machine feature slugs.
const FEATURE_LABELS: Record<string, string> = {
  "question-generation": "Question generation",
  "chapter-detection": "Chapter detection",
  "answer-verification": "Answer verification",
  "quality-check": "Quality checks",
  "bloom-tagging": "Bloom tagging",
  "tutor-chat": "AI tutor chat",
  "video-script": "Video scripts",
  "vision-graph": "Graph reading (vision)",
  "vision-equation": "Equation reading (vision)",
  "vision-solid": "3D solid reading (vision)",
  "graph-qa": "Graph Q&A",
};

function featureName(slug: string): string {
  return FEATURE_LABELS[slug] ?? slug;
}

function fmtTokens(n: number): string {
  return n.toLocaleString("en-US");
}

// Money is tiny per call — show enough precision to be meaningful.
function fmtMoney(n: number, code: string): string {
  const digits = n > 0 && n < 0.01 ? 4 : 2;
  return `${code} ${n.toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits })}`;
}

export default function AiUsagePage() {
  const [data, setData] = useState<UsageData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [period, setPeriod] = useState<Period>("all");

  const fetchUsage = useCallback(async (p: Period) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/usage?period=${p}`);
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? "Failed to load usage");
      }
      setData(await res.json());
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchUsage(period);
  }, [period, fetchUsage]);

  if (loading && !data) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <Spinner />
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="flex min-h-[60vh] flex-col items-center justify-center gap-4">
        <AlertCircle className="h-10 w-10 text-red-400" />
        <p className="text-sm text-gray-500">{error ?? "No data"}</p>
        <Button variant="outline" onClick={() => fetchUsage(period)}>
          <RefreshCw className="h-4 w-4" /> Retry
        </Button>
      </div>
    );
  }

  const showLocal = data.currency !== "USD" && data.fxPerUsd !== 1;
  const empty = data.byFeature.length === 0;

  return (
    <div className="mx-auto max-w-6xl space-y-6 p-4 sm:p-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">AI Usage &amp; Cost</h1>
          <p className="text-sm text-gray-500">
            Tokens and list-price cost per feature, across all AI providers.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <select
            value={period}
            onChange={(e) => setPeriod(e.target.value as Period)}
            className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-700 focus:border-[#1B5E20] focus:outline-none"
            aria-label="Time period"
          >
            {(Object.keys(PERIOD_LABELS) as Period[]).map((p) => (
              <option key={p} value={p}>
                {PERIOD_LABELS[p]}
              </option>
            ))}
          </select>
          <Button variant="outline" onClick={() => fetchUsage(period)} disabled={loading}>
            <RefreshCw className={loading ? "h-4 w-4 animate-spin" : "h-4 w-4"} /> Refresh
          </Button>
        </div>
      </div>

      {/* Caveat banner — list price vs the vendor console, not billing truth. */}
      <div className="flex items-start gap-3 rounded-xl border border-amber-200 bg-amber-50 p-4">
        <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-500" />
        <p className="text-sm text-amber-800">{data.note}</p>
      </div>

      {/* Totals */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Card>
          <CardContent className="pt-5">
            <div className="flex items-start justify-between">
              <div>
                <p className="text-xs font-medium text-gray-500">Total cost (USD, list price)</p>
                <p className="mt-1 text-2xl font-bold text-gray-900">
                  {fmtMoney(data.totalCostUsd, "USD")}
                </p>
                {showLocal && (
                  <p className="mt-1 text-xs text-gray-500">
                    ≈ {fmtMoney(data.totalCost, data.currency)}
                  </p>
                )}
              </div>
              <div className="rounded-lg bg-green-50 p-2">
                <Coins className="h-5 w-5 text-[#1B5E20]" />
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-5">
            <div className="flex items-start justify-between">
              <div>
                <p className="text-xs font-medium text-gray-500">Total tokens</p>
                <p className="mt-1 text-2xl font-bold text-gray-900">{fmtTokens(data.totalTokens)}</p>
              </div>
              <div className="rounded-lg bg-green-50 p-2">
                <Cpu className="h-5 w-5 text-[#1B5E20]" />
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-5">
            <div className="flex items-start justify-between">
              <div>
                <p className="text-xs font-medium text-gray-500">Features tracked</p>
                <p className="mt-1 text-2xl font-bold text-gray-900">{data.byFeature.length}</p>
              </div>
              <div className="rounded-lg bg-green-50 p-2">
                <Cpu className="h-5 w-5 text-[#1B5E20]" />
              </div>
            </div>
            {data.anyUnpriced && (
              <div className="mt-2">
                <Badge variant="warning" className="text-xs">
                  Some models unpriced — cost understated
                </Badge>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Per-feature breakdown */}
      <Card>
        <CardContent className="p-0">
          <div className="border-b border-gray-100 px-5 py-4">
            <h2 className="text-sm font-semibold text-gray-900">Cost by feature</h2>
          </div>

          {empty ? (
            <div className="px-5 py-10 text-center text-sm text-gray-500">
              No AI calls recorded in this period. Generate a quiz,
              detect chapters, or use the tutor, then refresh.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[720px] text-sm">
                <thead>
                  <tr className="border-b border-gray-100 text-left text-xs uppercase tracking-wide text-gray-500">
                    <th className="px-5 py-3 font-medium">Feature</th>
                    <th className="px-5 py-3 text-right font-medium">Calls</th>
                    <th className="px-5 py-3 text-right font-medium">Input</th>
                    <th className="px-5 py-3 text-right font-medium">Output</th>
                    <th className="px-5 py-3 text-right font-medium">Total tokens</th>
                    <th className="px-5 py-3 text-right font-medium">Cost (USD)</th>
                  </tr>
                </thead>
                <tbody>
                  {data.byFeature.map((f) => (
                    <tr key={f.feature} className="border-b border-gray-50 last:border-0">
                      <td className="px-5 py-3 font-medium text-gray-900">
                        {featureName(f.feature)}
                        {f.hasUnpriced && (
                          <span className="ml-2 align-middle text-xs text-amber-600">(unpriced model)</span>
                        )}
                      </td>
                      <td className="px-5 py-3 text-right text-gray-600">{fmtTokens(f.calls)}</td>
                      <td className="px-5 py-3 text-right text-gray-600">{fmtTokens(f.promptTokens)}</td>
                      <td className="px-5 py-3 text-right text-gray-600">
                        {fmtTokens(f.outputTokens + f.thinkingTokens)}
                      </td>
                      <td className="px-5 py-3 text-right text-gray-600">{fmtTokens(f.totalTokens)}</td>
                      <td className="px-5 py-3 text-right font-semibold text-gray-900">
                        {fmtMoney(f.costUsd, "USD")}
                        {showLocal && (
                          <span className="block text-xs font-normal text-gray-400">
                            {fmtMoney(f.costUsd * data.fxPerUsd, data.currency)}
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Per model+provider detail */}
      {data.detail.length > 0 && (
        <Card>
          <CardContent className="p-0">
            <div className="border-b border-gray-100 px-5 py-4">
              <h2 className="text-sm font-semibold text-gray-900">Detail by model &amp; provider</h2>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[720px] text-sm">
                <thead>
                  <tr className="border-b border-gray-100 text-left text-xs uppercase tracking-wide text-gray-500">
                    <th className="px-5 py-3 font-medium">Feature</th>
                    <th className="px-5 py-3 font-medium">Provider</th>
                    <th className="px-5 py-3 font-medium">Model</th>
                    <th className="px-5 py-3 text-right font-medium">Calls</th>
                    <th className="px-5 py-3 text-right font-medium">Total tokens</th>
                    <th className="px-5 py-3 text-right font-medium">Cost (USD)</th>
                  </tr>
                </thead>
                <tbody>
                  {data.detail.map((r) => (
                    <tr key={`${r.feature}|${r.provider}|${r.model}`} className="border-b border-gray-50 last:border-0">
                      <td className="px-5 py-3 text-gray-900">{featureName(r.feature)}</td>
                      <td className="px-5 py-3 text-gray-600">{r.provider}</td>
                      <td className="px-5 py-3 font-mono text-xs text-gray-600">{r.model}</td>
                      <td className="px-5 py-3 text-right text-gray-600">{fmtTokens(r.calls)}</td>
                      <td className="px-5 py-3 text-right text-gray-600">{fmtTokens(r.totalTokens)}</td>
                      <td className="px-5 py-3 text-right text-gray-900">
                        {r.hasUnpriced ? (
                          <span className="text-amber-600">unpriced</span>
                        ) : (
                          fmtMoney(r.costUsd, "USD")
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
