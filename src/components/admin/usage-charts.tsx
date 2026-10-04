"use client";

/**
 * Charts for the AI usage dashboard (/admin/usage).
 *
 * Colours come from the `--chart-*` tokens in globals.css: a validated
 * colour-blind-safe categorical order for features, the brand green for
 * single-series marks. A feature keeps its colour everywhere on the page
 * (trend + ranking), so "blue = tutor chat" holds from one chart to the next.
 */

import { Area, AreaChart, Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { cn } from "@/lib/utils";

// ─── Formatting ──────────────────────────────────────────────────────────────

/** Money in USD, precise enough for the tiny per-call amounts AI costs. */
export function fmtUsd(n: number): string {
  if (n === 0) return "$0";
  if (n > 0 && n < 0.0001) return "<$0.0001";
  if (Math.abs(n) >= 1000) {
    return "$" + n.toLocaleString("en-US", { notation: "compact", maximumFractionDigits: 1 });
  }
  const digits = Math.abs(n) < 0.01 ? 4 : 2;
  return "$" + n.toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

/** Local-currency money, e.g. "ETB 1,240.50". */
export function fmtLocal(n: number, code: string): string {
  const digits = n > 0 && n < 0.01 ? 4 : 2;
  return `${code} ${n.toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits })}`;
}

/** Compact counts: 1,284 / 12.9K / 4.2M. */
export function fmtCompact(n: number): string {
  return n < 10_000
    ? n.toLocaleString("en-US")
    : n.toLocaleString("en-US", { notation: "compact", maximumFractionDigits: 1 });
}

export function fmtPct(share: number): string {
  if (share > 0 && share < 0.01) return "<1%";
  return `${Math.round(share * 100)}%`;
}

// ─── Feature identity ────────────────────────────────────────────────────────

const FEATURE_LABELS: Record<string, string> = {
  "question-generation": "Question generation",
  "chapter-detection": "Chapter detection",
  "answer-verification": "Answer verification",
  "quality-check": "Quality checks",
  "factual-tiebreak": "Factual tie-break",
  "bloom-tagging": "Bloom tagging",
  "tutor-chat": "AI tutor chat",
  "teacher-assistant": "Teacher assistant",
  "exam-extraction": "National exam extraction",
  "query-rewrite": "Tutor search rewrite",
  "vision-graph": "Graph reading (vision)",
  "vision-equation": "Equation reading (vision)",
  "vision-solid": "3D solid reading (vision)",
  "graph-qa": "Graph Q&A",
  "embedding-ingest": "Embedding · textbook ingest",
  "embedding-dedup": "Embedding · question dedupe",
  "embedding-query": "Embedding · tutor search",
  other: "Everything else",
};

export function featureName(slug: string): string {
  return FEATURE_LABELS[slug] ?? slug;
}

const SLOTS = ["var(--chart-1)", "var(--chart-2)", "var(--chart-3)", "var(--chart-4)", "var(--chart-5)"];

/**
 * Colour per feature, fixed by the all-time cost ranking the API returns as
 * `colorOrder` — never by a row's position in the current period, so changing
 * the period never repaints a feature. Everything else is "other" grey.
 */
export function featureColors(colorOrder: string[]): (feature: string) => string {
  return (feature) => {
    const i = colorOrder.indexOf(feature);
    return i >= 0 && i < SLOTS.length ? SLOTS[i] : "var(--chart-other)";
  };
}

// ─── Spend over time ─────────────────────────────────────────────────────────

export type Bucket = "hour" | "day" | "week";
export type TrendPoint = { t: string; calls: number; total: number } & Record<string, number | string>;

function tickLabel(iso: string, bucket: Bucket): string {
  const d = new Date(iso);
  if (bucket === "hour") {
    return d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: "UTC" });
  }
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
}

function tooltipTitle(iso: string, bucket: Bucket): string {
  const d = new Date(iso);
  if (bucket === "hour") return `${tickLabel(iso, bucket)} UTC`;
  const day = d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" });
  return bucket === "week" ? `Week of ${day}` : day;
}

/**
 * Stacked columns: cost per bucket, split by the costliest features. Only the
 * top segment of a column gets the rounded data-end, and a 2px surface gap
 * separates segments instead of an outline.
 */
export function SpendTrendChart({
  points,
  series,
  bucket,
  colorOf,
}: {
  points: TrendPoint[];
  series: string[];
  bucket: Bucket;
  colorOf: (feature: string) => string;
}) {
  // Stack bottom→top in the same order as the legend reads left→right.
  const topKey = (p: Record<string, unknown>) =>
    [...series].reverse().find((s) => Number(p[s]) > 0) ?? null;
  const bottomKey = (p: Record<string, unknown>) => series.find((s) => Number(p[s]) > 0) ?? null;

  return (
    <div className="h-[300px] w-full">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={points} margin={{ top: 8, right: 4, bottom: 0, left: 0 }} barCategoryGap="20%">
          <CartesianGrid vertical={false} stroke="var(--chart-grid)" />
          <XAxis
            dataKey="t"
            tickFormatter={(v) => tickLabel(String(v), bucket)}
            tick={{ fill: "var(--chart-axis)", fontSize: 11 }}
            tickLine={false}
            axisLine={{ stroke: "var(--chart-grid)" }}
            minTickGap={24}
          />
          <YAxis
            tickFormatter={(v) => fmtUsd(Number(v))}
            tick={{ fill: "var(--chart-axis)", fontSize: 11 }}
            tickLine={false}
            axisLine={false}
            width={64}
          />
          <Tooltip
            cursor={{ fill: "var(--chart-accent-soft)" }}
            content={({ active, payload, label }) => {
              if (!active || !payload?.length) return null;
              const p = payload[0].payload as TrendPoint;
              return (
                <ChartTooltip title={tooltipTitle(String(label), bucket)}>
                  {[...series].reverse().map((s) => (
                    <TooltipRow key={s} color={colorOf(s)} value={fmtUsd(Number(p[s]) || 0)} label={featureName(s)} />
                  ))}
                  <div className="mt-1.5 flex items-baseline justify-between gap-6 border-t border-border pt-1.5">
                    <span className="font-semibold text-text-primary">{fmtUsd(p.total)}</span>
                    <span className="text-text-secondary">{fmtCompact(p.calls)} calls</span>
                  </div>
                </ChartTooltip>
              );
            }}
          />
          {series.map((s) => (
            <Bar
              key={s}
              dataKey={s}
              stackId="cost"
              fill={colorOf(s)}
              maxBarSize={24}
              isAnimationActive={false}
              shape={(props: unknown) => {
                const { x, y, width, height, fill, payload } = props as {
                  x: number;
                  y: number;
                  width: number;
                  height: number;
                  fill: string;
                  payload: Record<string, unknown>;
                };
                if (!height || height <= 0) return <g />;
                const isTop = topKey(payload) === s;
                const isBottom = bottomKey(payload) === s;
                // Gap: every segment above the bottom one gives up 2px at its base.
                const h = Math.max(0, isBottom ? height : height - 2);
                const r = isTop ? Math.min(4, h, width / 2) : 0;
                return (
                  <path
                    fill={fill}
                    d={
                      `M${x},${y + h} L${x},${y + r} Q${x},${y} ${x + r},${y} ` +
                      `L${x + width - r},${y} Q${x + width},${y} ${x + width},${y + r} ` +
                      `L${x + width},${y + h} Z`
                    }
                  />
                );
              }}
            />
          ))}
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

// ─── Sparkline (stat tile) ───────────────────────────────────────────────────

export function Sparkline({ values }: { values: number[] }) {
  if (values.length < 2) return null;
  const data = values.map((v, i) => ({ i, v }));
  return (
    <div className="h-10 w-full" aria-hidden>
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 4, right: 0, bottom: 0, left: 0 }}>
          <Area
            type="monotone"
            dataKey="v"
            stroke="var(--chart-accent)"
            strokeWidth={2}
            fill="var(--chart-accent)"
            fillOpacity={0.1}
            isAnimationActive={false}
            dot={false}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

// ─── Horizontal share bars (HTML — crisp text, no SVG measuring) ─────────────

export interface ShareBarRow {
  key: string;
  label: string;
  value: number;
  /** Shown at the bar's tip. */
  valueLabel: string;
  /** Extra detail for the hover/focus card. */
  detail?: string;
  color?: string;
}

/**
 * A ranked list of horizontal bars, value at the tip. Each row is focusable
 * and shows its detail on hover or focus; every value is also in the tables
 * further down, so nothing lives only in the hover card.
 */
export function ShareBars({ rows, total }: { rows: ShareBarRow[]; total: number }) {
  const max = Math.max(...rows.map((r) => r.value), 0);
  return (
    <ul className="space-y-2.5">
      {rows.map((r) => {
        const width = max > 0 ? Math.max(1.5, (r.value / max) * 100) : 0;
        return (
          <li
            key={r.key}
            tabIndex={0}
            className="group relative grid grid-cols-1 items-center gap-x-3 gap-y-1 rounded-md outline-none focus-visible:ring-2 focus-visible:ring-primary/40 sm:grid-cols-[minmax(0,13rem)_1fr]"
          >
            <span className="truncate text-sm text-text-secondary" title={r.label}>
              {r.label}
            </span>
            <span className="flex min-w-0 items-center gap-2">
              <span className="h-3 min-w-0 flex-1">
                <span
                  className="block h-3 rounded-r-[4px] transition-opacity group-hover:opacity-80"
                  style={{ width: `${width}%`, background: r.color ?? "var(--chart-accent)" }}
                />
              </span>
              <span className="w-24 shrink-0 text-right text-sm font-semibold tabular-nums text-text-primary">
                {r.valueLabel}
              </span>
            </span>
            {r.detail && (
              <span
                role="tooltip"
                className="pointer-events-none absolute -top-9 left-1/3 z-10 hidden whitespace-nowrap rounded-lg border border-border bg-surface px-3 py-1.5 text-xs text-text-secondary shadow-lg group-hover:block group-focus-visible:block"
              >
                <span className="font-semibold text-text-primary">{fmtPct(total > 0 ? r.value / total : 0)}</span> of
                spend · {r.detail}
              </span>
            )}
          </li>
        );
      })}
    </ul>
  );
}

// ─── Tooltip pieces ──────────────────────────────────────────────────────────

function ChartTooltip({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="min-w-[200px] rounded-lg border border-border bg-surface px-3 py-2 text-xs shadow-lg">
      <p className="mb-1.5 font-medium text-text-secondary">{title}</p>
      <div className="space-y-1">{children}</div>
    </div>
  );
}

/** Value leads, label follows; a short stroke of the series colour keys it. */
function TooltipRow({ color, value, label }: { color: string; value: string; label: string }) {
  return (
    <div className="flex items-center gap-2">
      <span className="h-0.5 w-3 shrink-0 rounded-full" style={{ background: color }} />
      <span className="font-semibold tabular-nums text-text-primary">{value}</span>
      <span className={cn("truncate text-text-secondary")}>{label}</span>
    </div>
  );
}
