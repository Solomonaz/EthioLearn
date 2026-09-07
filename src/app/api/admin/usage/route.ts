import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/get-session";
import { getUsageTotals } from "@/lib/usage-logger";
import { displayCurrency } from "@/lib/model-pricing";

/**
 * Per-feature AI token usage AND list-price cost since this server instance
 * started.
 *
 * The provider billing console (e.g. Gemini API Spend) breaks spend down by
 * MODEL only, and EthioLearn runs many features through two shared Gemini
 * models — so this attributes both the tokens and the money to the FEATURE that
 * spent them.
 *
 * Caveats:
 *  - Totals live in ONE server instance's memory and reset on redeploy or when
 *    a serverless instance recycles. The durable record is the `[Usage]` log
 *    lines each call emits.
 *  - Cost is list price for the tokens spent. The vendor may apply free-tier
 *    credits and bill in a local currency, so this can differ from the console.
 */
export async function GET() {
  const user = await getCurrentUser();
  if (!user || !["SUPER_ADMIN", "SCHOOL_ADMIN"].includes(user.role)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  }

  const rows = getUsageTotals();
  const { code: currency, perUsd } = displayCurrency();

  // Roll the per-(feature, model) rows up to a per-feature summary.
  const byFeature = new Map<
    string,
    {
      feature: string;
      calls: number;
      promptTokens: number;
      outputTokens: number;
      thinkingTokens: number;
      totalTokens: number;
      costUsd: number;
      hasUnpriced: boolean;
    }
  >();
  for (const r of rows) {
    const acc = byFeature.get(r.feature) ?? {
      feature: r.feature,
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

  const totalTokens = rows.reduce((s, r) => s + r.totalTokens, 0);
  const totalCostUsd = rows.reduce((s, r) => s + r.costUsd, 0);
  const anyUnpriced = rows.some((r) => r.hasUnpriced);

  return NextResponse.json({
    note: "Live snapshot since this server instance started; resets on redeploy. Cost is list price for the tokens spent — the vendor console may apply free-tier credits and a local currency. Durable record is the [Usage] server logs.",
    currency,
    fxPerUsd: perUsd,
    totalTokens,
    totalCostUsd,
    totalCost: totalCostUsd * perUsd,
    anyUnpriced,
    byFeature: [...byFeature.values()].sort((a, b) => b.costUsd - a.costUsd),
    detail: rows, // per (feature, provider, model)
  });
}
