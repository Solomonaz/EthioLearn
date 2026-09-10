import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
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
 * Spend is also attributed to the STUDENT and SCHOOL a call was made for, so
 * "what does a student actually cost us per month" is answerable from data
 * rather than estimated. Content-side work (question generation, chapter
 * detection) carries no student — it is one-time per textbook and amortised
 * across everyone who uses it, so it is deliberately excluded from the
 * per-student table rather than being spread across students arbitrarily.
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

interface ActorRow {
  id: string | null;
  name: string | null;
  grade: number | null;
  schoolName: string | null;
  calls: bigint | number;
  totalTokens: bigint | number;
  costUsd: number | null;
}

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

  // A school admin sees only their OWN school's spend; a super-admin sees all.
  const scoped = user.role === "SCHOOL_ADMIN" ? user.schoolId ?? "__none__" : null;
  const timeFilter = since ? Prisma.sql`AND ue."createdAt" >= ${since}` : Prisma.empty;
  const schoolFilter = scoped ? Prisma.sql`AND ue."schoolId" = ${scoped}` : Prisma.empty;

  // Per-student spend. Only rows that carry a student — see the note above.
  const byStudent = await db.$queryRaw<ActorRow[]>`
    SELECT ue."studentId"                    AS "id",
           u.name                            AS "name",
           u.grade                           AS "grade",
           s.name                            AS "schoolName",
           COUNT(*)                          AS "calls",
           COALESCE(SUM(ue."totalTokens"),0) AS "totalTokens",
           COALESCE(SUM(ue."costUsd"),0)     AS "costUsd"
    FROM usage_events ue
    LEFT JOIN users   u ON u.id = ue."studentId"
    LEFT JOIN schools s ON s.id = ue."schoolId"
    WHERE ue."studentId" IS NOT NULL ${timeFilter} ${schoolFilter}
    GROUP BY ue."studentId", u.name, u.grade, s.name
    ORDER BY "costUsd" DESC
    LIMIT 100`;

  // Per-school spend, including calls made by a school's admins/teachers.
  const bySchool = await db.$queryRaw<ActorRow[]>`
    SELECT ue."schoolId"                     AS "id",
           s.name                            AS "name",
           NULL::int                         AS "grade",
           NULL::text                        AS "schoolName",
           COUNT(*)                          AS "calls",
           COALESCE(SUM(ue."totalTokens"),0) AS "totalTokens",
           COALESCE(SUM(ue."costUsd"),0)     AS "costUsd"
    FROM usage_events ue
    LEFT JOIN schools s ON s.id = ue."schoolId"
    WHERE ue."schoolId" IS NOT NULL ${timeFilter} ${schoolFilter}
    GROUP BY ue."schoolId", s.name
    ORDER BY "costUsd" DESC
    LIMIT 100`;

  const asActor = (r: ActorRow) => ({
    id: r.id,
    name: r.name ?? "(deleted user)",
    grade: r.grade,
    schoolName: r.schoolName,
    calls: num(r.calls),
    totalTokens: num(r.totalTokens),
    costUsd: num(r.costUsd),
  });

  const students = byStudent.map(asActor);
  const schools = bySchool.map(asActor);

  // Attributed spend divided by the students who caused it — the number that
  // tells you whether a per-student price covers its own AI cost.
  const attributedCostUsd = students.reduce((s, r) => s + r.costUsd, 0);
  const avgCostPerStudentUsd = students.length ? attributedCostUsd / students.length : 0;

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
    attributedCostUsd,
    attributedCost: attributedCostUsd * perUsd,
    avgCostPerStudentUsd,
    avgCostPerStudent: avgCostPerStudentUsd * perUsd,
    studentsWithUsage: students.length,
    byStudent: students,
    bySchool: schools,
    byFeature: [...byFeature.values()]
      .map(({ provider: _p, model: _m, ...rest }) => rest)
      .sort((a, b) => b.costUsd - a.costUsd),
    detail,
  });
}
