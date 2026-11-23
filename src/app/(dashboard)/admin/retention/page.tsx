"use client";

import { useCallback, useEffect, useState } from "react";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";
import { Repeat, Users, Flame, Bell, Info } from "lucide-react";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/utils";

type Segment = "all" | "independent" | "school";

interface Cohort {
  week: string;
  size: number;
  studiedOnDay0: number | null;
  day1: number | null;
  day1Eligible: number;
  week2: number | null;
  week2Eligible: number;
  month2: number | null;
  month2Eligible: number;
}

interface FirstDayAction {
  action: string;
  share: number | null;
  returnIfDid: number | null;
  returnIfNot: number | null;
  students: number;
}

interface RetentionData {
  today: string;
  summary: { students: number; dau: number; wau: number; mau: number; stickiness: number | null };
  daily: { date: string; active: number }[];
  cohorts: Cohort[];
  firstDayActions: FirstDayAction[];
  firstDayCohort: { students: number; cameBack: number; rate: number | null };
  reach: {
    streaking: number;
    streak7: number;
    telegram: number;
    push: number;
    anyChannel: number;
    paused: number;
    optedOut: number;
    pauseAfter: number;
  };
}

const SEGMENTS: { value: Segment; label: string }[] = [
  { value: "all", label: "All students" },
  { value: "independent", label: "Self sign-ups" },
  { value: "school", label: "School students" },
];

const ACTION_LABELS: Record<string, string> = {
  tour: "Finished the welcome tour",
  quiz: "Practice quiz",
  daily_challenge: "Daily Challenge",
  tutor: "AI tutor",
  battle: "Battle",
  national_exam: "National exam paper",
  activity: "Class activity",
};

function fmtWeek(day: string) {
  return new Date(`${day}T00:00:00Z`).toLocaleDateString(undefined, { month: "short", day: "numeric", timeZone: "UTC" });
}

/** Cell colour scaled on the rate: deeper green = more students came back. */
function rateCell(rate: number | null) {
  if (rate === null) return "text-text-secondary";
  if (rate >= 40) return "bg-green-200 text-green-900";
  if (rate >= 25) return "bg-green-100 text-green-900";
  if (rate >= 10) return "bg-yellow-100 text-yellow-900";
  return "bg-red-50 text-red-800";
}

function Rate({ rate, eligible }: { rate: number | null; eligible?: number }) {
  return (
    <td className={cn("px-3 py-2 text-center text-sm font-semibold", rateCell(rate))} title={eligible !== undefined ? `${eligible} students measurable` : undefined}>
      {rate === null ? "—" : `${rate}%`}
    </td>
  );
}

export default function AdminRetentionPage() {
  const [segment, setSegment] = useState<Segment>("all");
  const [data, setData] = useState<RetentionData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/retention?segment=${segment}`);
      if (!res.ok) throw new Error("Failed to load retention");
      setData(await res.json());
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setLoading(false);
    }
  }, [segment]);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <div className="mx-auto max-w-6xl space-y-6 p-4 sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10">
            <Repeat className="h-5 w-5 text-primary" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-text-primary">Retention</h1>
            <p className="text-sm text-text-secondary">Do students come back after their first visit?</p>
          </div>
        </div>
        <div className="flex gap-1 rounded-xl border border-border bg-gray-50 p-1">
          {SEGMENTS.map((s) => (
            <button
              key={s.value}
              onClick={() => setSegment(s.value)}
              className={cn(
                "rounded-lg px-3 py-1.5 text-sm font-medium transition-all",
                segment === s.value ? "bg-white text-primary shadow-sm" : "text-text-secondary hover:text-text-primary",
              )}
            >
              {s.label}
            </button>
          ))}
        </div>
      </div>

      {loading && !data ? (
        <div className="flex justify-center py-20">
          <Spinner />
        </div>
      ) : error || !data ? (
        <div className="flex flex-col items-center gap-3 py-16">
          <p className="text-sm text-text-secondary">{error}</p>
          <Button variant="outline" size="sm" onClick={load}>
            Try again
          </Button>
        </div>
      ) : (
        <div className={cn("space-y-6", loading && "opacity-60")}>
          {/* Summary */}
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
            <Stat label="Students (grades 9–12)" value={data.summary.students} />
            <Stat label="Studied today" value={data.summary.dau} />
            <Stat label="Studied last 7 days" value={data.summary.wau} />
            <Stat label="Studied last 30 days" value={data.summary.mau} />
            <Stat
              label="Stickiness (today ÷ 30 days)"
              value={data.summary.stickiness === null ? "—" : `${data.summary.stickiness}%`}
            />
          </div>

          {/* Daily actives */}
          <Card>
            <CardHeader>
              <h2 className="text-base font-semibold text-text-primary">Students who studied, per day (last 30 days)</h2>
            </CardHeader>
            <CardContent>
              <div className="h-56">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={data.daily} margin={{ left: -20, right: 8, top: 8 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                    <XAxis dataKey="date" tickFormatter={fmtWeek} tick={{ fontSize: 11 }} interval="preserveStartEnd" />
                    <YAxis allowDecimals={false} tick={{ fontSize: 11 }} />
                    <Tooltip labelFormatter={(l) => fmtWeek(String(l))} formatter={(v) => [v, "Students"]} />
                    <Line type="monotone" dataKey="active" stroke="#2E7D32" strokeWidth={2} dot={false} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </CardContent>
          </Card>

          {/* Cohorts */}
          <Card>
            <CardHeader>
              <h2 className="text-base font-semibold text-text-primary">Sign-up cohorts: who came back</h2>
              <p className="mt-1 text-xs text-text-secondary">
                <b>Day 1</b>: studied the day after signing up. <b>Week 2</b>: studied on any of days 7–13.{" "}
                <b>Month 2</b>: any of days 30–59. A rate shows only once its window has passed for at least one
                student (hover a cell for how many).
              </p>
            </CardHeader>
            <CardContent className="overflow-x-auto">
              {data.cohorts.length === 0 ? (
                <p className="py-6 text-center text-sm text-text-secondary">No sign-ups in the last 8 weeks.</p>
              ) : (
                <table className="w-full min-w-[560px] border-separate border-spacing-y-1">
                  <thead>
                    <tr className="text-left text-xs uppercase tracking-wide text-text-secondary">
                      <th className="px-3 py-1">Week of</th>
                      <th className="px-3 py-1 text-right">Sign-ups</th>
                      <th className="px-3 py-1 text-center">Studied day 0</th>
                      <th className="px-3 py-1 text-center">Day 1</th>
                      <th className="px-3 py-1 text-center">Week 2</th>
                      <th className="px-3 py-1 text-center">Month 2</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.cohorts.map((c) => (
                      <tr key={c.week}>
                        <td className="px-3 py-2 text-sm font-medium text-text-primary">{fmtWeek(c.week)}</td>
                        <td className="px-3 py-2 text-right text-sm text-text-primary">{c.size}</td>
                        <Rate rate={c.studiedOnDay0} />
                        <Rate rate={c.day1} eligible={c.day1Eligible} />
                        <Rate rate={c.week2} eligible={c.week2Eligible} />
                        <Rate rate={c.month2} eligible={c.month2Eligible} />
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </CardContent>
          </Card>

          {/* First-day actions */}
          <Card>
            <CardHeader>
              <h2 className="text-base font-semibold text-text-primary">What did returning students do on day one?</h2>
              <p className="mt-1 text-xs text-text-secondary">
                Students who signed up 14–90 days ago ({data.firstDayCohort.students}). Overall{" "}
                {data.firstDayCohort.rate === null ? "—" : `${data.firstDayCohort.rate}%`} came back within two weeks.
                A big gap between the last two columns marks a first-day step worth steering new students to. This shows
                which steps go with returning, not proof that a step causes it.
              </p>
            </CardHeader>
            <CardContent className="overflow-x-auto">
              <table className="w-full min-w-[560px]">
                <thead>
                  <tr className="text-left text-xs uppercase tracking-wide text-text-secondary">
                    <th className="px-3 py-1">On their first day they…</th>
                    <th className="px-3 py-1 text-right">Share of students</th>
                    <th className="px-3 py-1 text-center">Came back if they did</th>
                    <th className="px-3 py-1 text-center">Came back if they didn&apos;t</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {data.firstDayActions.map((a) => (
                    <tr key={a.action}>
                      <td className="px-3 py-2 text-sm text-text-primary">{ACTION_LABELS[a.action] ?? a.action}</td>
                      <td className="px-3 py-2 text-right text-sm text-text-primary">
                        {a.share === null ? "—" : `${a.share}%`}{" "}
                        <span className="text-xs text-text-secondary">({a.students})</span>
                      </td>
                      <Rate rate={a.returnIfDid} />
                      <Rate rate={a.returnIfNot} />
                    </tr>
                  ))}
                </tbody>
              </table>
            </CardContent>
          </Card>

          {/* Streaks & reminder reach */}
          <div className="grid gap-4 md:grid-cols-2">
            <Card>
              <CardHeader>
                <h2 className="flex items-center gap-2 text-base font-semibold text-text-primary">
                  <Flame className="h-4 w-4 text-orange-500" /> Streaks
                </h2>
              </CardHeader>
              <CardContent className="grid grid-cols-2 gap-3">
                <Stat label="On a streak now" value={data.reach.streaking} />
                <Stat label="Streak of 7+ days" value={data.reach.streak7} />
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <h2 className="flex items-center gap-2 text-base font-semibold text-text-primary">
                  <Bell className="h-4 w-4 text-primary" /> Reminder reach
                </h2>
              </CardHeader>
              <CardContent className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                <Stat label="Reachable (any)" value={data.reach.anyChannel} />
                <Stat label="Telegram" value={data.reach.telegram} />
                <Stat label="Push" value={data.reach.push} />
                <Stat label="Paused (ignored)" value={data.reach.paused} />
                <Stat label="Turned off" value={data.reach.optedOut} />
              </CardContent>
              <p className="flex items-start gap-1.5 px-6 pb-5 text-xs text-text-secondary">
                <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                Reminders pause after {data.reach.pauseAfter} in a row go unanswered and restart when the student
                studies again.
              </p>
            </Card>
          </div>

          <p className="flex items-start gap-1.5 text-xs text-text-secondary">
            <Users className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            &ldquo;Studied&rdquo; means a quiz, the Daily Challenge, the AI tutor, a battle, a national exam paper or a
            class activity, counted by Ethiopian calendar day. Grades 1–8 (the /play games) and unconfirmed email
            sign-ups are not included.
          </p>
        </div>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="rounded-xl border border-border bg-surface px-4 py-3">
      <p className="text-xs text-text-secondary">{label}</p>
      <p className="mt-1 text-xl font-bold text-text-primary">{typeof value === "number" ? value.toLocaleString() : value}</p>
    </div>
  );
}
