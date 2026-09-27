"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useSession } from "next-auth/react";
import {
  AlertCircle,
  AlertTriangle,
  ArrowDownRight,
  ArrowUpRight,
  BarChart3,
  Building2,
  GraduationCap,
  Info,
  RefreshCw,
  Sparkles,
  Users,
} from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/utils";
import {
  featureColors,
  featureName,
  fmtCompact,
  fmtLocal,
  fmtPct,
  fmtUsd,
  ShareBars,
  Sparkline,
  SpendTrendChart,
  type Bucket,
  type TrendPoint,
} from "@/components/admin/usage-charts";

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

interface ActorRow {
  id: string | null;
  name: string;
  grade: number | null;
  schoolName: string | null;
  calls: number;
  totalTokens: number;
  costUsd: number;
  /** Teachers only: generations run in the period. */
  generations?: number;
  /** Teachers only: credits those generations spent from the monthly allowance. */
  credits?: number;
}

interface ProviderRow {
  provider: string;
  calls: number;
  totalTokens: number;
  costUsd: number;
}

interface UsageData {
  note: string;
  period: string;
  currency: string;
  fxPerUsd: number;
  totalTokens: number;
  totalCalls: number;
  totalCostUsd: number;
  totalCost: number;
  previous: { costUsd: number; totalTokens: number; calls: number } | null;
  timeseries: { bucket: Bucket; series: string[]; colorOrder: string[]; points: TrendPoint[] };
  byProvider: ProviderRow[];
  anyUnpriced: boolean;
  attributedCostUsd: number;
  attributedCost: number;
  avgCostPerStudentUsd: number;
  avgCostPerStudent: number;
  studentsWithUsage: number;
  avgCostPerTeacherUsd: number;
  avgCostPerTeacher: number;
  teachersWithUsage: number;
  byTeacher: ActorRow[];
  byStudent: ActorRow[];
  bySchool: ActorRow[];
  byFeature: FeatureRow[];
  detail: DetailRow[];
}

type Period = "today" | "7d" | "30d" | "all";
const PERIODS: { value: Period; label: string; previous: string }[] = [
  { value: "today", label: "Today", previous: "yesterday" },
  { value: "7d", label: "7 days", previous: "previous 7 days" },
  { value: "30d", label: "30 days", previous: "previous 30 days" },
  { value: "all", label: "All time", previous: "" },
];

/** Rows in the feature ranking — enough to fill the card beside the provider list. */
const FEATURE_ROWS = 12;

const PROVIDER_LABELS: Record<string, string> = {
  gemini: "Google Gemini",
  groq: "Groq",
  nvidia: "NVIDIA",
  openrouter: "OpenRouter",
  ollama: "Ollama (local)",
};

function providerName(slug: string): string {
  return PROVIDER_LABELS[slug] ?? slug.charAt(0).toUpperCase() + slug.slice(1);
}

export default function AiUsagePage() {
  const { data: session } = useSession();
  const isSchoolAdmin = (session?.user as { role?: string } | undefined)?.role === "SCHOOL_ADMIN";

  const [data, setData] = useState<UsageData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [period, setPeriod] = useState<Period>("30d");

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

  const colorOf = useMemo(() => featureColors(data?.timeseries.colorOrder ?? []), [data]);

  if (loading && !data) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <Spinner />
      </div>
    );
  }

  if (!data) {
    return (
      <div className="flex min-h-[60vh] flex-col items-center justify-center gap-4">
        <AlertCircle className="h-10 w-10 text-error" />
        <p className="text-sm text-text-secondary">{error ?? "No data"}</p>
        <Button variant="outline" onClick={() => fetchUsage(period)}>
          <RefreshCw className="h-4 w-4" /> Retry
        </Button>
      </div>
    );
  }

  const showLocal = data.currency !== "USD" && data.fxPerUsd !== 1;
  const empty = data.byFeature.length === 0;
  const periodInfo = PERIODS.find((p) => p.value === period)!;

  return (
    <div className="mx-auto max-w-7xl space-y-6 p-4 sm:p-6">
      {/* ── Header + the one filter row that scopes everything below ── */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold text-text-primary">
            <Sparkles className="h-6 w-6 text-primary" /> AI usage &amp; cost
          </h1>
          <p className="mt-1 text-sm text-text-secondary">
            What AI spend goes to, who it serves and where it is heading.
            {isSchoolAdmin && " Showing your school only."}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div role="tablist" aria-label="Time period" className="flex rounded-xl border border-border bg-surface p-1">
            {PERIODS.map((p) => (
              <button
                key={p.value}
                role="tab"
                aria-selected={period === p.value}
                onClick={() => setPeriod(p.value)}
                className={cn(
                  "rounded-lg px-3 py-1.5 text-sm font-medium transition-colors",
                  period === p.value
                    ? "bg-primary text-white shadow-sm"
                    : "text-text-secondary hover:bg-background hover:text-text-primary",
                )}
              >
                {p.label}
              </button>
            ))}
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => fetchUsage(period)}
            disabled={loading}
            aria-label="Refresh"
            className="h-10 w-10 p-0"
          >
            <RefreshCw className={cn("h-4 w-4", loading && "animate-spin")} />
          </Button>
        </div>
      </div>

      {error && (
        <p className="flex items-center gap-2 rounded-lg border border-error/30 bg-error/5 px-3 py-2 text-sm text-error">
          <AlertCircle className="h-4 w-4" /> {error} — showing the last loaded numbers.
        </p>
      )}

      {/* A refetch holds the previous render, dimmed, rather than flashing. */}
      <div className={cn("space-y-6 transition-opacity", loading && "opacity-60")}>
        {/* ── KPI row ── */}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <StatTile
            label="Total spend"
            value={fmtUsd(data.totalCostUsd)}
            sub={showLocal ? `≈ ${fmtLocal(data.totalCost, data.currency)}` : "List price, all providers"}
            delta={deltaOf(data.totalCostUsd, data.previous?.costUsd)}
            upIsBad
            periodLabel={periodInfo.previous}
            trend={data.timeseries.points.map((p) => p.total)}
            highlight
          />
          <StatTile
            label="AI calls"
            value={fmtCompact(data.totalCalls)}
            sub={`${fmtCompact(data.totalTokens)} tokens`}
            delta={deltaOf(data.totalCalls, data.previous?.calls)}
            periodLabel={periodInfo.previous}
          />
          <StatTile
            label="Avg cost per student"
            value={data.studentsWithUsage > 0 ? fmtUsd(data.avgCostPerStudentUsd) : "—"}
            sub={
              (showLocal ? `≈ ${fmtLocal(data.avgCostPerStudent, data.currency)} · ` : "") +
              `${data.studentsWithUsage} student${data.studentsWithUsage === 1 ? "" : "s"} using AI`
            }
            icon={<Users className="h-4 w-4" />}
          />
          <StatTile
            label="Avg cost per teacher"
            value={data.teachersWithUsage > 0 ? fmtUsd(data.avgCostPerTeacherUsd) : "—"}
            sub={
              (showLocal ? `≈ ${fmtLocal(data.avgCostPerTeacher, data.currency)} · ` : "") +
              `${data.teachersWithUsage} teacher${data.teachersWithUsage === 1 ? "" : "s"} using AI`
            }
            icon={<GraduationCap className="h-4 w-4" />}
          />
        </div>

        {data.anyUnpriced && (
          <p className="flex items-center gap-2 text-sm text-warning">
            <AlertTriangle className="h-4 w-4 shrink-0" />
            Some calls used a model with no price entry, so spend is understated.
          </p>
        )}

        {empty ? (
          <Card className="flex flex-col items-center gap-3 px-6 py-16 text-center">
            <div className="rounded-full bg-primary/10 p-4">
              <BarChart3 className="h-8 w-8 text-primary" />
            </div>
            <p className="font-semibold text-text-primary">No AI calls in this period</p>
            <p className="max-w-sm text-sm text-text-secondary">
              Generate a quiz, use the tutor or the teaching assistant, then refresh — or pick a longer
              period above.
            </p>
          </Card>
        ) : (
          <>
            {/* ── Spend over time ── */}
            <Card className="p-5">
              <SectionHeader
                title="Spend over time"
                subtitle={`Cost per ${data.timeseries.bucket}, split by the features that cost the most`}
              />
              <Legend
                items={data.timeseries.series.map((s) => ({ key: s, label: featureName(s), color: colorOf(s) }))}
              />
              <SpendTrendChart
                points={data.timeseries.points}
                series={data.timeseries.series}
                bucket={data.timeseries.bucket}
                colorOf={colorOf}
              />
            </Card>

            {/* ── Where it goes ── */}
            <div className="grid gap-6 lg:grid-cols-5">
              <Card className="p-5 lg:col-span-3">
                <SectionHeader title="Cost by feature" subtitle="Hover a bar for its share, calls and tokens" />
                <ShareBars
                  total={data.totalCostUsd}
                  rows={data.byFeature.slice(0, FEATURE_ROWS).map((f) => ({
                    key: f.feature,
                    label: featureName(f.feature),
                    value: f.costUsd,
                    valueLabel: fmtUsd(f.costUsd),
                    detail: `${fmtCompact(f.calls)} calls · ${fmtCompact(f.totalTokens)} tokens`,
                    color: colorOf(f.feature),
                  }))}
                />
                {data.byFeature.length > FEATURE_ROWS && (
                  <p className="mt-3 text-xs text-text-muted">
                    + {data.byFeature.length - FEATURE_ROWS} smaller features — see the full breakdown below.
                  </p>
                )}
              </Card>

              <Card className="p-5 lg:col-span-2">
                <SectionHeader title="By provider" subtitle="Each provider sends its own bill" />
                <ul className="space-y-4">
                  {data.byProvider.map((p) => {
                    const share = data.totalCostUsd > 0 ? p.costUsd / data.totalCostUsd : 0;
                    return (
                      <li key={p.provider}>
                        <div className="flex items-baseline justify-between gap-3">
                          <span className="text-sm font-medium text-text-primary">
                            {providerName(p.provider)}
                          </span>
                          <span className="text-sm font-semibold tabular-nums text-text-primary">
                            {fmtUsd(p.costUsd)}
                          </span>
                        </div>
                        <div className="mt-1.5 h-2 rounded-full bg-[var(--chart-accent-soft)]">
                          <div
                            className="h-2 rounded-full bg-[var(--chart-accent)]"
                            style={{ width: `${Math.max(share > 0 ? 2 : 0, share * 100)}%` }}
                          />
                        </div>
                        <p className="mt-1 text-xs text-text-muted">
                          {fmtPct(share)} of spend · {fmtCompact(p.calls)} calls · {fmtCompact(p.totalTokens)} tokens
                        </p>
                      </li>
                    );
                  })}
                </ul>
                <TokenMix features={data.byFeature} />
              </Card>
            </div>

            {/* ── Who it serves ── */}
            <Attribution data={data} />

            {/* ── Full breakdown (the table view of every chart above) ── */}
            <Breakdown data={data} showLocal={showLocal} />
          </>
        )}

        <p className="flex items-start gap-2 text-xs text-text-muted">
          <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          {data.note}
        </p>
      </div>
    </div>
  );
}

// ─── Pieces ──────────────────────────────────────────────────────────────────

/** Relative change vs the previous window; null when there is nothing to compare. */
function deltaOf(current: number, previous: number | undefined): number | "new" | null {
  if (previous === undefined) return null;
  if (previous === 0) return current > 0 ? "new" : null;
  return (current - previous) / previous;
}

function StatTile({
  label,
  value,
  sub,
  delta,
  upIsBad = false,
  periodLabel,
  trend,
  icon,
  highlight = false,
}: {
  label: string;
  value: string;
  sub: string;
  delta?: number | "new" | null;
  upIsBad?: boolean;
  periodLabel?: string;
  trend?: number[];
  icon?: React.ReactNode;
  highlight?: boolean;
}) {
  const hasDelta = delta !== undefined && delta !== null;
  const up = delta === "new" || (typeof delta === "number" && delta > 0);
  const flat = typeof delta === "number" && Math.abs(delta) < 0.005;
  // Direction × whether up is good. Neutral metrics stay in secondary ink.
  const tone = flat || !upIsBad ? "text-text-secondary" : up ? "text-error" : "text-success";

  return (
    <Card className={cn("flex flex-col p-5", highlight && "border-primary/30")}>
      <div className="flex items-center justify-between">
        <p className="text-sm font-medium text-text-secondary">{label}</p>
        {icon && <span className="rounded-lg bg-primary/10 p-1.5 text-primary">{icon}</span>}
      </div>
      <p className={cn("mt-2 font-bold text-text-primary", highlight ? "text-4xl" : "text-3xl")}>{value}</p>
      <p className="mt-1 text-xs text-text-muted">{sub}</p>
      {hasDelta && (
        <p className={cn("mt-2 flex items-center gap-1 text-xs font-medium", tone)}>
          {!flat && (up ? <ArrowUpRight className="h-3.5 w-3.5" /> : <ArrowDownRight className="h-3.5 w-3.5" />)}
          {delta === "new"
            ? "New this period"
            : flat
              ? "No change"
              : `${up ? "+" : "−"}${fmtPct(Math.abs(delta as number))}`}
          <span className="font-normal text-text-muted">vs {periodLabel}</span>
        </p>
      )}
      {trend && trend.length > 1 && (
        <div className="mt-auto pt-3">
          <Sparkline values={trend} />
        </div>
      )}
    </Card>
  );
}

function SectionHeader({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <div className="mb-4">
      <h2 className="text-base font-semibold text-text-primary">{title}</h2>
      {subtitle && <p className="text-xs text-text-muted">{subtitle}</p>}
    </div>
  );
}

function Legend({ items }: { items: { key: string; label: string; color: string }[] }) {
  return (
    <ul className="mb-3 flex flex-wrap gap-x-4 gap-y-1.5">
      {items.map((i) => (
        <li key={i.key} className="flex items-center gap-1.5 text-xs text-text-secondary">
          <span className="h-2.5 w-2.5 rounded-[3px]" style={{ background: i.color }} />
          {i.label}
        </li>
      ))}
    </ul>
  );
}

/** Where the tokens go: reading (input) vs writing (output + thinking). */
function TokenMix({ features }: { features: FeatureRow[] }) {
  const input = features.reduce((s, f) => s + f.promptTokens, 0);
  const output = features.reduce((s, f) => s + f.outputTokens, 0);
  const thinking = features.reduce((s, f) => s + f.thinkingTokens, 0);
  const total = input + output + thinking;
  if (total === 0) return null;
  const parts = [
    { label: "Input", value: input },
    { label: "Output", value: output },
    { label: "Thinking", value: thinking },
  ];
  return (
    <div className="mt-6 border-t border-border pt-4">
      <p className="text-xs font-semibold uppercase tracking-wide text-text-muted">Token mix</p>
      <div className="mt-3 grid grid-cols-3 gap-3">
        {parts.map((p) => (
          <div key={p.label}>
            <p className="text-lg font-semibold text-text-primary">{fmtPct(p.value / total)}</p>
            <p className="text-xs text-text-muted">
              {p.label} · {fmtCompact(p.value)}
            </p>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Attribution: students / teachers / schools ─────────────────────────────

type ActorTab = "students" | "teachers" | "schools";

function Attribution({ data }: { data: UsageData }) {
  const [tab, setTab] = useState<ActorTab>("students");
  const [showAll, setShowAll] = useState(false);

  const tabs: { value: ActorTab; label: string; icon: React.ReactNode; rows: ActorRow[] }[] = [
    { value: "students", label: "Students", icon: <Users className="h-4 w-4" />, rows: data.byStudent },
    { value: "teachers", label: "Teachers", icon: <GraduationCap className="h-4 w-4" />, rows: data.byTeacher },
    { value: "schools", label: "Schools", icon: <Building2 className="h-4 w-4" />, rows: data.bySchool },
  ];
  const active = tabs.find((t) => t.value === tab)!;
  const rows = showAll ? active.rows : active.rows.slice(0, 10);
  const max = Math.max(...active.rows.map((r) => r.costUsd), 0);

  const notes: Record<ActorTab, string> = {
    students:
      "Content-side work (question generation, chapter detection) carries no student — it is one-time per textbook and shared by everyone.",
    teachers:
      "Generations are what the plan's monthly allowance counts; documents reused from the library are free and not counted.",
    schools: "Includes calls made by a school's admins and teachers.",
  };

  return (
    <Card className="overflow-hidden">
      <div className="flex flex-col gap-3 border-b border-border px-5 pt-5 sm:flex-row sm:items-end sm:justify-between">
        <SectionHeader title="Who the spend serves" subtitle="The heaviest AI users, costliest first" />
        <div role="tablist" className="-mb-px flex gap-1">
          {tabs.map((t) => (
            <button
              key={t.value}
              role="tab"
              aria-selected={tab === t.value}
              onClick={() => {
                setTab(t.value);
                setShowAll(false);
              }}
              className={cn(
                "flex items-center gap-1.5 border-b-2 px-3 pb-3 text-sm font-medium transition-colors",
                tab === t.value
                  ? "border-primary text-primary"
                  : "border-transparent text-text-secondary hover:text-text-primary",
              )}
            >
              {t.icon}
              {t.label}
              <span className="rounded-full bg-background px-1.5 text-xs text-text-muted">{t.rows.length}</span>
            </button>
          ))}
        </div>
      </div>

      {rows.length === 0 ? (
        <p className="px-5 py-12 text-center text-sm text-text-secondary">
          No {active.label.toLowerCase()} with AI use in this period.
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-sm">
            <thead>
              <tr className="text-left text-xs uppercase tracking-wide text-text-muted">
                <th className="w-10 px-5 py-3 font-medium">#</th>
                <th className="px-3 py-3 font-medium">{active.label.slice(0, -1)}</th>
                {tab === "students" && <th className="px-3 py-3 font-medium">Grade</th>}
                {tab !== "schools" && <th className="px-3 py-3 font-medium">School</th>}
                {tab === "teachers" && <th className="px-3 py-3 text-right font-medium">Generations</th>}
                {tab === "teachers" && <th className="px-3 py-3 text-right font-medium">Credits</th>}
                <th className="px-3 py-3 text-right font-medium">Calls</th>
                <th className="px-3 py-3 text-right font-medium">Tokens</th>
                <th className="w-[28%] px-5 py-3 font-medium">Cost</th>
              </tr>
            </thead>
            <tbody className="tabular-nums">
              {rows.map((r, i) => (
                <tr key={r.id ?? r.name} className="border-t border-border/60 hover:bg-background/60">
                  <td className="px-5 py-3 text-text-muted">{i + 1}</td>
                  <td className="px-3 py-3 font-medium text-text-primary">{r.name}</td>
                  {tab === "students" && <td className="px-3 py-3 text-text-secondary">{r.grade ?? "—"}</td>}
                  {tab !== "schools" && (
                    <td className="px-3 py-3 text-text-secondary">{r.schoolName ?? "Independent"}</td>
                  )}
                  {tab === "teachers" && (
                    <td className="px-3 py-3 text-right text-text-secondary">{r.generations ?? 0}</td>
                  )}
                  {tab === "teachers" && (
                    <td className="px-3 py-3 text-right text-text-secondary">{r.credits ?? 0}</td>
                  )}
                  <td className="px-3 py-3 text-right text-text-secondary">{fmtCompact(r.calls)}</td>
                  <td className="px-3 py-3 text-right text-text-secondary">{fmtCompact(r.totalTokens)}</td>
                  <td className="px-5 py-3">
                    <div className="flex items-center gap-3">
                      <div className="h-1.5 flex-1 rounded-full bg-[var(--chart-accent-soft)]">
                        <div
                          className="h-1.5 rounded-full bg-[var(--chart-accent)]"
                          style={{ width: `${max > 0 ? Math.max(2, (r.costUsd / max) * 100) : 0}%` }}
                        />
                      </div>
                      <span className="w-20 text-right font-semibold text-text-primary">{fmtUsd(r.costUsd)}</span>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="flex flex-col gap-2 border-t border-border px-5 py-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-xs text-text-muted">{notes[tab]}</p>
        {active.rows.length > 10 && (
          <button
            onClick={() => setShowAll((v) => !v)}
            className="shrink-0 text-xs font-semibold text-primary hover:underline"
          >
            {showAll ? "Show top 10" : `Show all ${active.rows.length}`}
          </button>
        )}
      </div>
    </Card>
  );
}

// ─── Full breakdown tables ───────────────────────────────────────────────────

function Breakdown({ data, showLocal }: { data: UsageData; showLocal: boolean }) {
  const [view, setView] = useState<"feature" | "model">("feature");
  const colorOf = featureColors(data.timeseries.colorOrder);

  return (
    <Card className="overflow-hidden">
      <div className="flex flex-col gap-3 border-b border-border px-5 pt-5 sm:flex-row sm:items-end sm:justify-between">
        <SectionHeader title="Full breakdown" subtitle="Every number behind the charts above" />
        <div role="tablist" className="-mb-px flex gap-1">
          {(["feature", "model"] as const).map((v) => (
            <button
              key={v}
              role="tab"
              aria-selected={view === v}
              onClick={() => setView(v)}
              className={cn(
                "border-b-2 px-3 pb-3 text-sm font-medium transition-colors",
                view === v
                  ? "border-primary text-primary"
                  : "border-transparent text-text-secondary hover:text-text-primary",
              )}
            >
              By {v}
            </button>
          ))}
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full min-w-[760px] text-sm">
          <thead>
            <tr className="text-left text-xs uppercase tracking-wide text-text-muted">
              <th className="px-5 py-3 font-medium">Feature</th>
              {view === "model" && <th className="px-3 py-3 font-medium">Model</th>}
              <th className="px-3 py-3 text-right font-medium">Calls</th>
              <th className="px-3 py-3 text-right font-medium">Input</th>
              <th className="px-3 py-3 text-right font-medium">Output</th>
              <th className="px-3 py-3 text-right font-medium">Share</th>
              <th className="px-5 py-3 text-right font-medium">Cost</th>
            </tr>
          </thead>
          <tbody className="tabular-nums">
            {(view === "feature" ? data.byFeature : data.detail).map((r) => {
              const d = r as DetailRow;
              const share = data.totalCostUsd > 0 ? r.costUsd / data.totalCostUsd : 0;
              return (
                <tr
                  key={view === "feature" ? r.feature : `${r.feature}|${d.provider}|${d.model}`}
                  className="border-t border-border/60 hover:bg-background/60"
                >
                  <td className="px-5 py-3">
                    <span className="flex items-center gap-2 font-medium text-text-primary">
                      <span className="h-2.5 w-2.5 shrink-0 rounded-[3px]" style={{ background: colorOf(r.feature) }} />
                      {featureName(r.feature)}
                      {r.hasUnpriced && <span className="text-xs font-normal text-warning">unpriced</span>}
                    </span>
                  </td>
                  {view === "model" && (
                    <td className="px-3 py-3">
                      <span className="block font-mono text-xs text-text-secondary">{d.model}</span>
                      <span className="text-xs text-text-muted">{providerName(d.provider)}</span>
                    </td>
                  )}
                  <td className="px-3 py-3 text-right text-text-secondary">{fmtCompact(r.calls)}</td>
                  <td className="px-3 py-3 text-right text-text-secondary">{fmtCompact(r.promptTokens)}</td>
                  <td className="px-3 py-3 text-right text-text-secondary">
                    {fmtCompact(r.outputTokens + r.thinkingTokens)}
                  </td>
                  <td className="px-3 py-3 text-right text-text-secondary">{fmtPct(share)}</td>
                  <td className="px-5 py-3 text-right">
                    <span className="font-semibold text-text-primary">{fmtUsd(r.costUsd)}</span>
                    {showLocal && (
                      <span className="block text-xs text-text-muted">
                        {fmtLocal(r.costUsd * data.fxPerUsd, data.currency)}
                      </span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </Card>
  );
}
