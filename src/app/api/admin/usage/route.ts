import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/get-session";
import { db } from "@/lib/db";
import { displayCurrency } from "@/lib/model-pricing";

/**
 * Per-feature AI token usage AND list-price cost, read from the durable
 * `usage_events` table.
 *
 * The provider billing console (e.g. Gemini API Spend) breaks spend down by
 * MODEL only, and EthioLearn runs many features through two shared Gemini
 * models — so this attributes both the tokens and the money to the FEATURE that
 * spent them. Every provider call writes one row (see usage-logger), so the
 * numbers survive restarts and cover calls made by any route or instance —
 * unlike the in-memory totals this replaced, which each route bundle held a
 * separate copy of (why a book upload's usage never reached this page).
 *
 * Caveat: cost is list price for the tokens spent. The vendor may apply
 * free-tier credits and bill in a local currency, so this can differ from the
 * console total.
 */

// Period windows, mirroring the vendor console's ranges.
const PERIODS: Record<string, number | null> = {
  today: 1,
  "7d": 7,
  "30d": 30,
  all: null,
};

interface AggRow {
  feature: string;
  provider: string;
  model: string;
  calls: bigint | number;
  promptTokens: bigint | number;
  outputTokens: bigint | number;
  thinkingTokens: bigint | number;
  totalTokens: bigint | number;
  costUsd: number | null;
  unpricedCalls: bigint | number;
}

const num = (v: bigint | number | null): number => (v == null ? 0 : Number(v));

export async function GET(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user || !["SUPER_ADMIN", "SCHOOL_ADMIN"].includes(user.role)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  }

  const periodKey = request.nextUrl.searchParams.get("period") ?? "all";
  const days = periodKey in PERIODS ? PERIODS[periodKey] : null;
  const since = days === null ? null : new Date(Date.now() - days * 24 * 60 * 60 * 1000);

  const { code: currency, perUsd } = displayCurrency();

  // One grouped pass over the table. Aggregation happens in Postgres so it
  // stays cheap as the table grows.
  const rows = since
    ? await db.$queryRaw<AggRow[]>`
        SELECT feature, provider, model,
               COUNT(*)                         AS "calls",
               COALESCE(SUM("promptTokens"),0)  AS "promptTokens",
               COALESCE(SUM("outputTokens"),0)  AS "outputTokens",
               COALESCE(SUM("thinkingTokens"),0) AS "thinkingTokens",
               COALESCE(SUM("totalTokens"),0)   AS "totalTokens",
               COALESCE(SUM("costUsd"),0)       AS "costUsd",
               COALESCE(SUM(CASE WHEN unpriced THEN 1 ELSE 0 END),0) AS "unpricedCalls"
        FROM usage_events
        WHERE "createdAt" >= ${since}
        GROUP BY feature, provider, model
        ORDER BY "costUsd" DESC`
    : await db.$queryRaw<AggRow[]>`
        SELECT feature, provider, model,
               COUNT(*)                         AS "calls",
               COALESCE(SUM("promptTokens"),0)  AS "promptTokens",
               COALESCE(SUM("outputTokens"),0)  AS "outputTokens",
               COALESCE(SUM("thinkingTokens"),0) AS "thinkingTokens",
               COALESCE(SUM("totalTokens"),0)   AS "totalTokens",
               COALESCE(SUM("costUsd"),0)       AS "costUsd",
               COALESCE(SUM(CASE WHEN unpriced THEN 1 ELSE 0 END),0) AS "unpricedCalls"
        FROM usage_events
        GROUP BY feature, provider, model
        ORDER BY "costUsd" DESC`;

  const detail = rows.map((r) => ({
    feature: r.feature,
    provider: r.provider,
    model: r.model,
    calls: num(r.calls),
    promptTokens: num(r.promptTokens),
    outputTokens: num(r.outputTokens),
    thinkingTokens: num(r.thinkingTokens),
    totalTokens: num(r.totalTokens),
    costUsd: num(r.costUsd),
    hasUnpriced: num(r.unpricedCalls) > 0,
  }));

  // Roll the per-(feature, model) rows up to a per-feature summary.
  const byFeature = new Map<string, (typeof detail)[number] & { feature: string }>();
  for (const r of detail) {
    const acc = byFeature.get(r.feature) ?? {
      feature: r.feature,
      provider: "",
      model: "",
      calls: 0,
      promptTokens: 0,
      outputTokens: 0,
      thinkingTokens: 0,
      totalTokens: 0,
      costUsd: 0,
      hasUnpriced: false,
    };
    acc.calls += r.calls;
    acc.promptTokens += r.promptTokens;
    acc.outputTokens += r.outputTokens;
    acc.thinkingTokens += r.thinkingTokens;
    acc.totalTokens += r.totalTokens;
    acc.costUsd += r.costUsd;
    acc.hasUnpriced = acc.hasUnpriced || r.hasUnpriced;
    byFeature.set(r.feature, acc);
  }

  const totalTokens = detail.reduce((s, r) => s + r.totalTokens, 0);
  const totalCostUsd = detail.reduce((s, r) => s + r.costUsd, 0);
  const anyUnpriced = detail.some((r) => r.hasUnpriced);

  return NextResponse.json({
    note: "Cost is list price for the tokens spent — the vendor console may apply free-tier credits and a local currency.",
    period: periodKey in PERIODS ? periodKey : "all",
    currency,
    fxPerUsd: perUsd,
    totalTokens,
    totalCostUsd,
    totalCost: totalCostUsd * perUsd,
    anyUnpriced,
    byFeature: [...byFeature.values()]
      .map(({ provider: _p, model: _m, ...rest }) => rest)
      .sort((a, b) => b.costUsd - a.costUsd),
    detail,
  });
}
