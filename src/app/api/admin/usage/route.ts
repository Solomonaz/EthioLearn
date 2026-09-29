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
 * MODEL only, and Abugida runs many features through two shared Gemini
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

  // A school admin sees only their OWN school's spend; a super-admin sees all.
  // Applied to every aggregate — features and the trend included — so a
  // school admin never sees platform-wide numbers. Content-side work carries
  // no school, so it is (correctly) absent from a school's view.
  const scoped = user.role === "SCHOOL_ADMIN" ? user.schoolId ?? "__none__" : null;
  const timeFilter = since ? Prisma.sql`AND ue."createdAt" >= ${since}` : Prisma.empty;
  const schoolFilter = scoped ? Prisma.sql`AND ue."schoolId" = ${scoped}` : Prisma.empty;

  // One grouped pass over the table. Aggregation happens in Postgres so it
  // stays cheap as the table grows.
  const rows = await db.$queryRaw<AggRow[]>`
    SELECT feature, provider, model,
           COUNT(*)                            AS "calls",
           COALESCE(SUM("promptTokens"),0)     AS "promptTokens",
           COALESCE(SUM("outputTokens"),0)     AS "outputTokens",
           COALESCE(SUM("thinkingTokens"),0)   AS "thinkingTokens",
           COALESCE(SUM("totalTokens"),0)      AS "totalTokens",
           COALESCE(SUM("costUsd"),0)          AS "costUsd",
           COALESCE(SUM(CASE WHEN unpriced THEN 1 ELSE 0 END),0) AS "unpricedCalls"
    FROM usage_events ue
    WHERE TRUE ${timeFilter} ${schoolFilter}
    GROUP BY feature, provider, model
    ORDER BY "costUsd" DESC`;

  // The same totals for the window just before this one, so each headline
  // number can say whether spend is rising. None for "all time".
  let previous: { costUsd: number; totalTokens: number; calls: number } | null = null;
  if (since && days !== null) {
    const prevSince = new Date(since.getTime() - days * 24 * 60 * 60 * 1000);
    const [prev] = await db.$queryRaw<{ calls: bigint; totalTokens: bigint; costUsd: number | null }[]>`
      SELECT COUNT(*)                          AS "calls",
             COALESCE(SUM(ue."totalTokens"),0) AS "totalTokens",
             COALESCE(SUM(ue."costUsd"),0)     AS "costUsd"
      FROM usage_events ue
      WHERE ue."createdAt" >= ${prevSince} AND ue."createdAt" < ${since} ${schoolFilter}`;
    previous = { costUsd: num(prev?.costUsd ?? 0), totalTokens: num(prev?.totalTokens ?? 0), calls: num(prev?.calls ?? 0) };
  }

  const timeseries = await buildTimeseries(periodKey, since, timeFilter, schoolFilter);

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

  // Per-teacher spend (secondary teachers), with the generations counted
  // against their monthly allowance over the same window — cost per
  // generation is what a sensible allowance is set from.
  const byTeacher = await db.$queryRaw<ActorRow[]>`
    SELECT ue."teacherId"                    AS "id",
           u.name                            AS "name",
           NULL::int                         AS "grade",
           s.name                            AS "schoolName",
           COUNT(*)                          AS "calls",
           COALESCE(SUM(ue."totalTokens"),0) AS "totalTokens",
           COALESCE(SUM(ue."costUsd"),0)     AS "costUsd"
    FROM usage_events ue
    LEFT JOIN users   u ON u.id = ue."teacherId"
    LEFT JOIN schools s ON s.id = ue."schoolId"
    WHERE ue."teacherId" IS NOT NULL ${timeFilter} ${schoolFilter}
    GROUP BY ue."teacherId", u.name, s.name
    ORDER BY "costUsd" DESC
    LIMIT 100`;
  const generationRows = await db.teacherAiUse.groupBy({
    by: ["teacherId"],
    where: {
      teacherId: { in: byTeacher.map((r) => r.id).filter((id): id is string => Boolean(id)) },
      ...(since ? { createdAt: { gte: since } } : {}),
    },
    _count: { _all: true },
    _sum: { credits: true },
  });
  const generations = new Map(generationRows.map((g) => [g.teacherId, g._count._all]));
  const credits = new Map(generationRows.map((g) => [g.teacherId, g._sum.credits ?? 0]));

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
  const teachers = byTeacher.map((r) => ({
    ...asActor(r),
    generations: r.id ? generations.get(r.id) ?? 0 : 0,
    credits: r.id ? credits.get(r.id) ?? 0 : 0,
  }));
  const teacherCostUsd = teachers.reduce((s, r) => s + r.costUsd, 0);
  const avgCostPerTeacherUsd = teachers.length ? teacherCostUsd / teachers.length : 0;

  // Attributed spend divided by the students who caused it — the number that
  // tells you whether a per-student price covers its own AI cost.
  const attributedCostUsd = students.reduce((s, r) => s + r.costUsd, 0);
  const avgCostPerStudentUsd = students.length ? attributedCostUsd / students.length : 0;

  // Spend per provider — the vendor bills arrive per provider.
  const byProviderMap = new Map<string, { provider: string; calls: number; totalTokens: number; costUsd: number }>();
  for (const r of detail) {
    const acc = byProviderMap.get(r.provider) ?? { provider: r.provider, calls: 0, totalTokens: 0, costUsd: 0 };
    acc.calls += r.calls;
    acc.totalTokens += r.totalTokens;
    acc.costUsd += r.costUsd;
    byProviderMap.set(r.provider, acc);
  }

  const totalTokens = detail.reduce((s, r) => s + r.totalTokens, 0);
  const totalCalls = detail.reduce((s, r) => s + r.calls, 0);
  const totalCostUsd = detail.reduce((s, r) => s + r.costUsd, 0);
  const anyUnpriced = detail.some((r) => r.hasUnpriced);

  return NextResponse.json({
    note: "Cost is list price for the tokens spent — the vendor console may apply free-tier credits and a local currency.",
    period: periodKey in PERIODS ? periodKey : "all",
    currency,
    fxPerUsd: perUsd,
    totalTokens,
    totalCalls,
    totalCostUsd,
    previous,
    timeseries,
    byProvider: [...byProviderMap.values()].sort((a, b) => b.costUsd - a.costUsd),
    totalCost: totalCostUsd * perUsd,
    anyUnpriced,
    attributedCostUsd,
    attributedCost: attributedCostUsd * perUsd,
    avgCostPerStudentUsd,
    avgCostPerStudent: avgCostPerStudentUsd * perUsd,
    studentsWithUsage: students.length,
    avgCostPerTeacherUsd,
    avgCostPerTeacher: avgCostPerTeacherUsd * perUsd,
    teachersWithUsage: teachers.length,
    byTeacher: teachers,
    byStudent: students,
    bySchool: schools,
    byFeature: [...byFeature.values()]
      .map(({ provider: _p, model: _m, ...rest }) => rest)
      .sort((a, b) => b.costUsd - a.costUsd),
    detail,
  });
}

// ─── Spend over time ─────────────────────────────────────────────────────────

/** Features drawn as their own series in the trend; the rest fold into "other". */
const TREND_SERIES = 4;

type Bucket = "hour" | "day" | "week";

/**
 * Cost per time bucket, split by the costliest features (the tail folded into
 * "other" so the chart never needs more than five colours). Empty buckets are
 * filled with zeros so a quiet day reads as a gap in spend, not a missing bar.
 *
 * Which features get their own colour is ranked over ALL time, not the chosen
 * period, and returned as `colorOrder` — so switching from "30 days" to
 * "Today" never repaints a feature in a different colour.
 */
async function buildTimeseries(
  periodKey: string,
  since: Date | null,
  timeFilter: Prisma.Sql,
  schoolFilter: Prisma.Sql,
) {
  // Where the window starts — for "all time", the first event on record.
  let start = since;
  if (!start) {
    const [first] = await db.$queryRaw<{ first: Date | null }[]>`
      SELECT MIN(ue."createdAt") AS "first" FROM usage_events ue WHERE TRUE ${schoolFilter}`;
    start = first?.first ?? null;
  }
  if (!start) return { bucket: "day" as Bucket, series: [] as string[], colorOrder: [] as string[], points: [] };

  const spanDays = (Date.now() - start.getTime()) / 86_400_000;
  const bucket: Bucket = periodKey === "today" ? "hour" : spanDays > 120 ? "week" : "day";

  const rows = await db.$queryRaw<{ t: Date; feature: string; costUsd: number | null; calls: bigint }[]>`
    SELECT date_trunc(${bucket}, ue."createdAt") AS "t",
           ue.feature                           AS "feature",
           COALESCE(SUM(ue."costUsd"),0)        AS "costUsd",
           COUNT(*)                             AS "calls"
    FROM usage_events ue
    WHERE TRUE ${timeFilter} ${schoolFilter}
    GROUP BY 1, 2
    ORDER BY 1`;

  // The all-time costliest features own the colours; of those, the ones with
  // spend in this window are drawn, and everything else folds into "other".
  const allTime = await db.$queryRaw<{ feature: string }[]>`
    SELECT ue.feature AS "feature"
    FROM usage_events ue
    WHERE TRUE ${schoolFilter}
    GROUP BY ue.feature
    ORDER BY COALESCE(SUM(ue."costUsd"),0) DESC
    LIMIT ${TREND_SERIES}`;
  const colorOrder = allTime.map((r) => r.feature);
  const inWindow = new Set(rows.filter((r) => num(r.costUsd) > 0).map((r) => r.feature));
  const series = colorOrder.filter((f) => inWindow.has(f));
  const hasOther = [...inWindow].some((f) => !colorOrder.includes(f));

  // Every bucket from the start to now, zero-filled.
  const step = bucket === "hour" ? 3_600_000 : bucket === "day" ? 86_400_000 : 7 * 86_400_000;
  const floor = (d: Date): number => {
    const x = new Date(d);
    if (bucket === "hour") x.setUTCMinutes(0, 0, 0);
    else {
      x.setUTCHours(0, 0, 0, 0);
      // Postgres weeks start on Monday.
      if (bucket === "week") x.setUTCDate(x.getUTCDate() - ((x.getUTCDay() + 6) % 7));
    }
    return x.getTime();
  };
  type Point = { t: string; calls: number; total: number } & Record<string, number | string>;
  const points = new Map<number, Point>();
  for (let t = floor(start); t <= Date.now(); t += step) {
    const p: Point = { t: new Date(t).toISOString(), calls: 0, total: 0 };
    for (const f of series) p[f] = 0;
    if (hasOther) p.other = 0;
    points.set(t, p);
  }

  for (const r of rows) {
    const p = points.get(floor(new Date(r.t)));
    if (!p) continue;
    const key = series.includes(r.feature) ? r.feature : "other";
    const cost = num(r.costUsd);
    p[key] = (p[key] as number) + cost;
    p.total += cost;
    p.calls += num(r.calls);
  }

  return {
    bucket,
    series: hasOther ? [...series, "other"] : series,
    colorOrder,
    points: [...points.values()],
  };
}
