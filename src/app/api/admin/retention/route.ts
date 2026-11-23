import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { getCurrentUser } from "@/lib/get-session";
import { db } from "@/lib/db";
import { addDays, addisDayKey, addisWeekStart } from "@/lib/study-time";
import { MAX_MISSES } from "@/lib/reminders";

/**
 * GET /api/admin/retention?segment=all|independent|school
 *
 * Do students come back? Built from the days each student actually studied
 * (Addis Ababa calendar days), reconstructed from every record of study the
 * app keeps — study_days (written from now on), completed quizzes, national
 * exam attempts, tutor messages, battles and class activities — so history
 * from before study_days existed still counts.
 *
 * Students in grades 1–8 are left out: they use the /play games, which keep no
 * per-student record, so they would always look like they never came back.
 * Email sign-ups that never confirmed their address are left out too (they
 * cannot sign in).
 */

type Segment = "all" | "independent" | "school";

const COHORT_WEEKS = 8;

function segmentSql(segment: Segment): Prisma.Sql {
  if (segment === "independent") return Prisma.sql`AND u."schoolId" IS NULL`;
  if (segment === "school") return Prisma.sql`AND u."schoolId" IS NOT NULL`;
  return Prisma.empty;
}

/** Students in scope, as a CTE body. */
function studentsSql(segment: Segment): Prisma.Sql {
  return Prisma.sql`
    SELECT u.id, (u."createdAt" + interval '3 hours')::date AS signup, u."createdAt"
    FROM users u
    WHERE u.role = 'STUDENT'
      AND (u.grade IS NULL OR u.grade >= 9)
      AND NOT (u.email IS NOT NULL AND u."emailVerifiedAt" IS NULL AND u."googleId" IS NULL
               AND u."telegramId" IS NULL AND u."schoolId" IS NULL AND u.username IS NULL)
      ${segmentSql(segment)}`;
}

/** Every (student, day, kind of study) the database can show. */
const EVENTS_SQL = Prisma.sql`
  SELECT sd."userId" AS uid, sd.day::date AS d, unnest(CASE WHEN cardinality(sd.sources) = 0 THEN ARRAY['study'] ELSE sd.sources END) AS src
    FROM study_days sd WHERE NOT sd.frozen
  UNION ALL
  SELECT q."studentId", (q."completedAt" + interval '3 hours')::date,
         CASE WHEN q."isDailyChallenge" THEN 'daily_challenge' WHEN q."activityId" IS NOT NULL THEN 'activity'
              WHEN q."gameRoomId" IS NOT NULL THEN 'battle' ELSE 'quiz' END
    FROM quizzes q WHERE q."completedAt" IS NOT NULL
  UNION ALL
  SELECT a."studentId", (a."startedAt" + interval '3 hours')::date, 'national_exam' FROM national_exam_attempts a
  UNION ALL
  SELECT e."studentId", (e."createdAt" + interval '3 hours')::date, 'tutor'
    FROM usage_events e WHERE e.feature = 'tutor-chat' AND e."studentId" IS NOT NULL
  UNION ALL
  SELECT g."userId", (g."joinedAt" + interval '3 hours')::date, 'battle' FROM game_players g
  UNION ALL
  SELECT t."studentId", (COALESCE(t."submittedAt", t."completedAt") + interval '3 hours')::date, 'activity'
    FROM class_activity_targets t WHERE COALESCE(t."submittedAt", t."completedAt") IS NOT NULL`;

const n = (v: bigint | number | null | undefined) => Number(v ?? 0);
const pct = (num: number, den: number) => (den > 0 ? Math.round((num / den) * 1000) / 10 : null);

export async function GET(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user || user.role !== "SUPER_ADMIN") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const raw = request.nextUrl.searchParams.get("segment");
  const segment: Segment = raw === "independent" || raw === "school" ? raw : "all";
  const today = addisDayKey();
  const from30 = addDays(today, -29);
  const cohortFrom = addisDayKey(new Date(addisWeekStart().getTime() - (COHORT_WEEKS - 1) * 7 * 86_400_000));

  try {
    const base = Prisma.sql`
      WITH students AS (${studentsSql(segment)}),
      days AS (
        SELECT DISTINCT ev.uid, ev.d FROM (${EVENTS_SQL}) ev JOIN students s ON s.id = ev.uid
      )`;

    // ── Daily actives, last 30 days ─────────────────────────────────────────
    const dailyRows = await db.$queryRaw<{ d: Date; dau: bigint }[]>`
      ${base}
      SELECT d, COUNT(*)::bigint AS dau FROM days
      WHERE d BETWEEN ${from30}::date AND ${today}::date
      GROUP BY d ORDER BY d`;
    const dauByDay = new Map(dailyRows.map((r) => [r.d.toISOString().slice(0, 10), n(r.dau)]));
    const daily = Array.from({ length: 30 }, (_, i) => {
      const day = addDays(from30, i);
      return { date: day, active: dauByDay.get(day) ?? 0 };
    });

    const [summary] = await db.$queryRaw<{ dau: bigint; wau: bigint; mau: bigint; students: bigint }[]>`
      ${base}
      SELECT
        (SELECT COUNT(DISTINCT uid) FROM days WHERE d = ${today}::date)::bigint AS dau,
        (SELECT COUNT(DISTINCT uid) FROM days WHERE d > ${today}::date - 7)::bigint AS wau,
        (SELECT COUNT(DISTINCT uid) FROM days WHERE d > ${today}::date - 30)::bigint AS mau,
        (SELECT COUNT(*) FROM students)::bigint AS students`;

    // ── Weekly sign-up cohorts ───────────────────────────────────────────────
    // Day 1 = studied the day after signing up. Week 2 = studied on any of
    // days 7–13. Month 2 = any of days 30–59. Each rate only counts students
    // whose window has fully passed, so a young cohort is not understated.
    const cohortRows = await db.$queryRaw<
      {
        week: Date;
        size: bigint;
        studied_day0: bigint;
        d1_elig: bigint; d1: bigint;
        w2_elig: bigint; w2: bigint;
        m2_elig: bigint; m2: bigint;
      }[]
    >`
      ${base},
      c AS (
        SELECT s.id, s.signup, date_trunc('week', s.signup)::date AS week FROM students s
        WHERE s.signup >= ${cohortFrom}::date
      )
      SELECT c.week,
        COUNT(*)::bigint AS size,
        COUNT(*) FILTER (WHERE EXISTS (SELECT 1 FROM days x WHERE x.uid = c.id AND x.d = c.signup))::bigint AS studied_day0,
        COUNT(*) FILTER (WHERE c.signup + 1 < ${today}::date)::bigint AS d1_elig,
        COUNT(*) FILTER (WHERE c.signup + 1 < ${today}::date
          AND EXISTS (SELECT 1 FROM days x WHERE x.uid = c.id AND x.d = c.signup + 1))::bigint AS d1,
        COUNT(*) FILTER (WHERE c.signup + 13 < ${today}::date)::bigint AS w2_elig,
        COUNT(*) FILTER (WHERE c.signup + 13 < ${today}::date
          AND EXISTS (SELECT 1 FROM days x WHERE x.uid = c.id AND x.d BETWEEN c.signup + 7 AND c.signup + 13))::bigint AS w2,
        COUNT(*) FILTER (WHERE c.signup + 59 < ${today}::date)::bigint AS m2_elig,
        COUNT(*) FILTER (WHERE c.signup + 59 < ${today}::date
          AND EXISTS (SELECT 1 FROM days x WHERE x.uid = c.id AND x.d BETWEEN c.signup + 30 AND c.signup + 59))::bigint AS m2
      FROM c GROUP BY c.week ORDER BY c.week DESC`;
    const cohorts = cohortRows.map((r) => ({
      week: r.week.toISOString().slice(0, 10),
      size: n(r.size),
      studiedOnDay0: pct(n(r.studied_day0), n(r.size)),
      day1: pct(n(r.d1), n(r.d1_elig)),
      day1Eligible: n(r.d1_elig),
      week2: pct(n(r.w2), n(r.w2_elig)),
      week2Eligible: n(r.w2_elig),
      month2: pct(n(r.m2), n(r.m2_elig)),
      month2Eligible: n(r.m2_elig),
    }));

    // ── What first-day behaviour goes with coming back? ──────────────────────
    // Students who signed up 14–90 days ago. "Came back" = studied on any
    // later day within their first 14 days.
    const actionRows = await db.$queryRaw<{ src: string; did: bigint; did_back: bigint; total: bigint; total_back: bigint }[]>`
      WITH students AS (${studentsSql(segment)}),
      ev AS (SELECT DISTINCT e.uid, e.d, e.src FROM (${EVENTS_SQL}) e JOIN students s ON s.id = e.uid),
      cohort AS (
        SELECT s.id, s.signup,
          EXISTS (SELECT 1 FROM ev WHERE ev.uid = s.id AND ev.d BETWEEN s.signup + 1 AND s.signup + 13) AS back
        FROM students s
        WHERE s.signup BETWEEN ${today}::date - 90 AND ${today}::date - 14
      ),
      first_day AS (
        SELECT DISTINCT c.id, ev.src FROM cohort c JOIN ev ON ev.uid = c.id AND ev.d = c.signup
        UNION
        -- Finished (not skipped) the welcome tour on day one. Not study, so
        -- it is only here, never in the activity days above.
        SELECT c.id, 'tour' FROM cohort c JOIN users u ON u.id = c.id
        WHERE u."onboardingCompletedAt" IS NOT NULL AND NOT u."onboardingSkipped"
          AND (u."onboardingCompletedAt" + interval '3 hours')::date = c.signup
      ),
      kinds AS (SELECT unnest(ARRAY['tour','quiz','daily_challenge','tutor','battle','national_exam','activity']) AS src)
      SELECT k.src,
        (SELECT COUNT(*) FROM first_day f WHERE f.src = k.src)::bigint AS did,
        (SELECT COUNT(*) FROM first_day f JOIN cohort c ON c.id = f.id WHERE f.src = k.src AND c.back)::bigint AS did_back,
        (SELECT COUNT(*) FROM cohort)::bigint AS total,
        (SELECT COUNT(*) FROM cohort WHERE back)::bigint AS total_back
      FROM kinds k`;
    const total = n(actionRows[0]?.total);
    const totalBack = n(actionRows[0]?.total_back);
    const firstDayActions = actionRows.map((r) => {
      const did = n(r.did);
      const didBack = n(r.did_back);
      return {
        action: r.src,
        share: pct(did, total),
        returnIfDid: pct(didBack, did),
        returnIfNot: pct(totalBack - didBack, total - did),
        students: did,
      };
    });

    // ── Streaks & reminder reach ─────────────────────────────────────────────
    const [reach] = await db.$queryRaw<
      { streaking: bigint; streak7: bigint; telegram: bigint; push: bigint; any_channel: bigint; paused: bigint; opted_out: bigint }[]
    >`
      WITH students AS (${studentsSql(segment)})
      SELECT
        COUNT(*) FILTER (WHERE u."streakDays" > 0)::bigint AS streaking,
        COUNT(*) FILTER (WHERE u."streakDays" >= 7)::bigint AS streak7,
        COUNT(*) FILTER (WHERE u."telegramId" IS NOT NULL AND u."telegramBlockedAt" IS NULL)::bigint AS telegram,
        COUNT(*) FILTER (WHERE EXISTS (SELECT 1 FROM push_subscriptions p WHERE p."userId" = u.id))::bigint AS push,
        COUNT(*) FILTER (WHERE (u."telegramId" IS NOT NULL AND u."telegramBlockedAt" IS NULL)
          OR EXISTS (SELECT 1 FROM push_subscriptions p WHERE p."userId" = u.id))::bigint AS any_channel,
        COUNT(*) FILTER (WHERE u."remindersPausedAt" IS NOT NULL)::bigint AS paused,
        COUNT(*) FILTER (WHERE NOT u."remindersEnabled")::bigint AS opted_out
      FROM users u JOIN students s ON s.id = u.id
      WHERE u.grade >= 9`;

    const dau = n(summary?.dau);
    const mau = n(summary?.mau);
    return NextResponse.json({
      segment,
      today,
      summary: {
        students: n(summary?.students),
        dau,
        wau: n(summary?.wau),
        mau,
        stickiness: pct(dau, mau),
      },
      daily,
      cohorts,
      firstDayActions,
      firstDayCohort: { students: total, cameBack: totalBack, rate: pct(totalBack, total) },
      reach: {
        streaking: n(reach?.streaking),
        streak7: n(reach?.streak7),
        telegram: n(reach?.telegram),
        push: n(reach?.push),
        anyChannel: n(reach?.any_channel),
        paused: n(reach?.paused),
        optedOut: n(reach?.opted_out),
        pauseAfter: MAX_MISSES,
      },
    });
  } catch (error) {
    console.error("[admin/retention]", error);
    return NextResponse.json({ error: "Failed to load retention" }, { status: 500 });
  }
}
