"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useSession } from "next-auth/react";
import { useTranslations, useLocale } from "next-intl";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Cell,
  LabelList,
  ResponsiveContainer,
} from "recharts";
import {
  Layers,
  ListChecks,
  BookOpen,
  GraduationCap,
  Swords,
  Grid3x3,
  Bot,
  Palette,
  Puzzle,
  Shuffle,
  Sparkles,
  Plus,
  Play,
  Pencil,
  Trash2,
  ArrowRight,
  CalendarDays,
  Trophy,
  Search,
  SearchX,
  type LucideIcon,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { useSound } from "@/hooks/use-sound";

interface SetSummary {
  id: string;
  title: string;
  subject: string;
  grade: number;
  language: string;
  questionCount: number;
  /** Prompt text of each question (for search); may be absent on older responses. */
  questions?: string[];
  updatedAt: string;
}

/**
 * Teacher dashboard — a playful "game hub" for teachers of young learners.
 * Bright, chunky game tiles lead (kids love colour), anchored by the green
 * brand: a friendly hero, colourful stat cards, playful charts, and the
 * teacher's saved question sets.
 */

const GRAD = {
  green: "linear-gradient(135deg,#1B5E20,#43A047)",
  blue: "linear-gradient(135deg,#2563EB,#60A5FA)",
  teal: "linear-gradient(135deg,#0891B2,#22D3EE)",
  rose: "linear-gradient(135deg,#E11D48,#FB7185)",
  violet: "linear-gradient(135deg,#7C3AED,#A78BFA)",
  amber: "linear-gradient(135deg,#EA580C,#FB923C)",
} as const;

const CHART_COLORS = ["#1B5E20", "#F9A825", "#2563EB", "#E11D48", "#7C3AED", "#0891B2"];
const SUBJECT_DOTS = ["#1B5E20", "#2563EB", "#0891B2", "#E11D48", "#7C3AED", "#EA580C", "#F9A825"];
function subjectColor(subject: string): string {
  let h = 0;
  for (let i = 0; i < subject.length; i++) h = (h * 31 + subject.charCodeAt(i)) >>> 0;
  return SUBJECT_DOTS[h % SUBJECT_DOTS.length];
}

export default function TeacherDashboardPage() {
  return (
    <Suspense fallback={null}>
      <TeacherDashboardInner />
    </Suspense>
  );
}

function TeacherDashboardInner() {
  const { data: session } = useSession();
  const { playSfx } = useSound();
  const t = useTranslations("teacher");
  const g = useTranslations("games");
  const nav = useTranslations("nav");
  const c = useTranslations("common");
  const locale = useLocale();
  const name = session?.user?.name ?? "";

  const [games, setGames] = useState<SetSummary[] | null>(null);
  // Either may be blank: a school admin can record "all of grade 3" or
  // "Mathematics" without the other.
  const [assignments, setAssignments] = useState<{ subject: string | null; grade: number | null }[]>([]);

  const load = () =>
    fetch("/api/teacher/games")
      .then((r) => (r.ok ? r.json() : { games: [] }))
      .then((d) => setGames(d.games ?? []))
      .catch(() => setGames([]));

  useEffect(() => {
    load();
    // What the teacher actually teaches — drives the Subjects & Grades cards.
    fetch("/api/teacher/me/assignments")
      .then((r) => (r.ok ? r.json() : { assignments: [] }))
      .then((d) => setAssignments(d.assignments ?? []))
      .catch(() => {});
  }, []);

  // Distinct subjects / grades from the teacher's assignments (source of truth
  // when set; otherwise we fall back to what's inferred from created game sets).
  const teachSubjects = useMemo(
    () => [...new Set(assignments.map((a) => (a.subject ?? "").trim()).filter(Boolean))],
    [assignments],
  );
  const teachGrades = useMemo(
    () =>
      [...new Set(assignments.map((a) => a.grade))]
        .filter((g): g is number => g !== null)
        .sort((a, b) => a - b),
    [assignments],
  );

  const stats = useMemo(() => {
    const list = games ?? [];
    const totalQuestions = list.reduce((s, x) => s + (x.questionCount || 0), 0);
    const subjects = new Set(list.map((x) => x.subject.trim().toLowerCase()).filter(Boolean));
    const gradesArr = [...new Set(list.map((x) => x.grade))].sort((a, b) => a - b);

    const weekAgo = Date.now() - 7 * 86400000;
    const recent = list.filter((x) => new Date(x.updatedAt).getTime() >= weekAgo);
    const recentSets = recent.length;
    const recentQuestions = recent.reduce((s, x) => s + (x.questionCount || 0), 0);

    const byGrade = Array.from({ length: 6 }, (_, i) => ({
      grade: g("mtGradeN", { n: i + 1 }),
      questions: list.filter((x) => x.grade === i + 1).reduce((s, x) => s + (x.questionCount || 0), 0),
    }));

    const subjMap = new Map<string, number>();
    list.forEach((x) => {
      const key = x.subject.trim() || "—";
      subjMap.set(key, (subjMap.get(key) ?? 0) + 1);
    });
    const bySubject = [...subjMap.entries()]
      .map(([subject, count]) => ({ subject, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 5);

    return {
      totalSets: list.length,
      totalQuestions,
      subjects: subjects.size,
      gradesArr,
      recentSets,
      recentQuestions,
      byGrade,
      bySubject,
    };
  }, [games, g]);

  // ── Search (driven by the ?q= param set by the teacher top bar) ──────
  const searchParams = useSearchParams();
  const query = (searchParams.get("q") ?? "").trim();
  const isSearching = query.length > 0;

  const results = useMemo(() => {
    const q = query.toLowerCase();
    if (!q) return { sets: [] as SetSummary[], questions: [] as { set: SetSummary; question: string }[] };
    const list = games ?? [];

    const sets = list.filter(
      (s) =>
        s.title.toLowerCase().includes(q) ||
        (s.subject || "").toLowerCase().includes(q) ||
        `grade ${s.grade}`.includes(q) ||
        String(s.grade) === q,
    );

    const questions: { set: SetSummary; question: string }[] = [];
    for (const s of list) {
      for (const question of s.questions ?? []) {
        if (question.toLowerCase().includes(q)) {
          questions.push({ set: s, question });
          if (questions.length >= 50) break;
        }
      }
      if (questions.length >= 50) break;
    }

    return { sets, questions };
  }, [games, query]);

  const del = async (id: string) => {
    if (!confirm(t("confirmDelete"))) return;
    const res = await fetch(`/api/teacher/games/${id}`, { method: "DELETE" });
    if (res.ok) {
      toast.success(c("delete"));
      load();
    } else {
      toast.error(c("error"));
    }
  };

  const hasGames = (games?.length ?? 0) > 0;

  const dateStr = new Date().toLocaleDateString(locale === "am" ? "am-ET" : "en-US", {
    weekday: "long",
    month: "short",
    day: "numeric",
  });

  // Prefer the teacher's real assignments; fall back to grades seen in sets.
  const gradesForLabel = teachGrades.length > 0 ? teachGrades : stats.gradesArr;
  const gradesLabel = (() => {
    const a = gradesForLabel;
    if (a.length === 0) return t("dashNoGrades");
    if (a.length === 1) return t("gradeOption", { grade: a[0] });
    if (a.length === 2) return t("dashGrades2", { a: a[0], b: a[1] });
    return t("dashGradesRange", { a: a[0], b: a[a.length - 1] });
  })();

  // Card values: real assignments when present, otherwise inferred from sets.
  const subjectsCount = teachSubjects.length > 0 ? teachSubjects.length : stats.subjects;
  const gradesCount = teachGrades.length > 0 ? teachGrades.length : stats.gradesArr.length;
  const subjectsDelta =
    teachSubjects.length > 0
      ? t("dashTopSubject", { subject: teachSubjects[0] })
      : stats.bySubject.length > 0
        ? t("dashTopSubject", { subject: stats.bySubject[0].subject })
        : t("dashInClass");

  const gameTiles: {
    href: string;
    icon: LucideIcon;
    name: string;
    desc: string;
    emoji: string;
    grad: string;
    cta: string;
  }[] = [
    { href: "/teacher/games/tug", icon: Swords, name: nav("tugOfWar"), desc: g("mtSubtitle"), emoji: "💪", grad: GRAD.green, cta: g("play") },
    { href: "/teacher/games/memory", icon: Grid3x3, name: nav("numberMemory"), desc: g("numWatchSub"), emoji: "🧠", grad: GRAD.blue, cta: g("play") },
    { href: "/teacher/games/routing", icon: Bot, name: nav("routing"), desc: g("routeSub"), emoji: "🤖", grad: GRAD.teal, cta: g("play") },
    { href: "/teacher/games/find-color", icon: Palette, name: nav("findColor"), desc: g("colorSub"), emoji: "🎨", grad: GRAD.rose, cta: g("play") },
    { href: "/teacher/games/find-pair", icon: Puzzle, name: nav("findPair"), desc: g("fpSubtitle"), emoji: "🧩", grad: GRAD.violet, cta: g("play") },
    { href: "/teacher/games/picker", icon: Shuffle, name: nav("randomPicker"), desc: t("pickerDesc"), emoji: "🎲", grad: GRAD.amber, cta: t("open") },
  ];

  const statCards: {
    label: string;
    value: string | number;
    icon: LucideIcon;
    color: string;
    delta: string;
  }[] = [
    { label: t("dashSets"), value: games === null ? "…" : stats.totalSets, icon: Layers, color: "#1B5E20", delta: stats.recentSets > 0 ? t("dashThisWeek", { n: stats.recentSets }) : t("dashReady") },
    { label: t("dashQuestions"), value: games === null ? "…" : stats.totalQuestions, icon: ListChecks, color: "#F9A825", delta: stats.recentQuestions > 0 ? t("dashThisWeek", { n: stats.recentQuestions }) : t("dashAcrossSets", { n: stats.totalSets }) },
    { label: t("dashSubjects"), value: games === null ? "…" : subjectsCount, icon: BookOpen, color: "#2563EB", delta: subjectsDelta },
    { label: t("dashGrades"), value: games === null ? "…" : gradesCount, icon: GraduationCap, color: "#E11D48", delta: gradesLabel },
  ];

  const maxSubject = Math.max(1, ...stats.bySubject.map((s) => s.count));

  /** Wrap the first occurrence of the query in the given text with a highlight. */
  const highlight = (text: string) => {
    if (!query) return text;
    const idx = text.toLowerCase().indexOf(query.toLowerCase());
    if (idx === -1) return text;
    return (
      <>
        {text.slice(0, idx)}
        <mark className="rounded bg-secondary/40 px-0.5 text-text-primary">
          {text.slice(idx, idx + query.length)}
        </mark>
        {text.slice(idx + query.length)}
      </>
    );
  };

  // ── Search results view (replaces the dashboard while a query is active) ──
  if (isSearching) {
    const totalMatches = results.sets.length + results.questions.length;
    return (
      <div className="mx-auto max-w-6xl space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            <h1 className="flex items-center gap-2 text-xl font-extrabold text-text-primary sm:text-2xl">
              <Search className="h-5 w-5 text-primary" />
              <span className="truncate">{t("searchResultsFor", { q: query })}</span>
            </h1>
            <p className="mt-0.5 text-sm text-text-secondary">
              {games === null ? c("loading") : t("searchMatchCount", { n: totalMatches })}
            </p>
          </div>
          <Link
            href="/teacher"
            className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-border bg-surface px-4 py-2 text-sm font-semibold text-text-secondary shadow-sm transition hover:border-primary/40 hover:text-primary"
          >
            <ArrowRight className="h-4 w-4 rotate-180" /> {t("searchBack")}
          </Link>
        </div>

        {games === null ? (
          <div className="flex justify-center py-16">
            <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
          </div>
        ) : totalMatches === 0 ? (
          <div className="flex flex-col items-center gap-4 rounded-3xl border border-dashed border-border bg-surface px-6 py-16 text-center">
            <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-primary/10 text-primary">
              <SearchX className="h-8 w-8" />
            </div>
            <div>
              <h3 className="text-lg font-bold text-text-primary">{t("searchNoResults", { q: query })}</h3>
              <p className="mt-1 text-text-secondary">{t("searchNoResultsDesc")}</p>
            </div>
          </div>
        ) : (
          <div className="space-y-6">
            {/* Matching game sets */}
            {results.sets.length > 0 && (
              <section>
                <h2 className="mb-3 flex items-center gap-2 text-base font-extrabold text-text-primary">
                  <Layers className="h-5 w-5 text-primary" /> {t("searchGamesHeading")}
                  <span className="rounded-full bg-primary/10 px-2 py-0.5 text-xs font-bold text-primary">
                    {results.sets.length}
                  </span>
                </h2>
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  {results.sets.map((s) => (
                    <div
                      key={s.id}
                      className="group flex flex-col rounded-2xl border border-border bg-surface p-4 shadow-sm transition hover:shadow-md"
                    >
                      <div className="flex items-start gap-2">
                        <span className="mt-1.5 h-3 w-3 shrink-0 rounded-full" style={{ backgroundColor: subjectColor(s.subject || "—") }} />
                        <div className="min-w-0 flex-1">
                          <h3 className="truncate font-bold text-text-primary">{highlight(s.title)}</h3>
                          <p className="truncate text-sm text-text-secondary">{highlight(s.subject || "—")}</p>
                        </div>
                      </div>
                      <div className="mt-3 flex flex-wrap items-center gap-1.5">
                        <span className="rounded-full bg-primary/10 px-2.5 py-0.5 text-xs font-semibold text-primary">
                          {t("gradeOption", { grade: s.grade })}
                        </span>
                        <span className="rounded-full bg-border/60 px-2.5 py-0.5 text-xs font-medium text-text-secondary">
                          {t("itemsCount", { count: s.questionCount })}
                        </span>
                      </div>
                      <div className="mt-4 flex items-center gap-1.5 border-t border-border pt-3">
                        <Link
                          href={`/teacher/games/tug?set=${s.id}`}
                          className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-primary px-3 py-2 text-sm font-bold text-white transition hover:bg-primary-dark"
                        >
                          <Play className="h-4 w-4" /> {g("play")}
                        </Link>
                        <Link
                          href={`/teacher/games/create?edit=${s.id}`}
                          title={c("edit")}
                          className="rounded-lg p-2 text-text-muted transition hover:bg-border/50 hover:text-text-primary"
                        >
                          <Pencil className="h-4 w-4" />
                        </Link>
                      </div>
                    </div>
                  ))}
                </div>
              </section>
            )}

            {/* Matching questions */}
            {results.questions.length > 0 && (
              <section>
                <h2 className="mb-3 flex items-center gap-2 text-base font-extrabold text-text-primary">
                  <ListChecks className="h-5 w-5 text-secondary-dark" /> {t("searchQuestionsHeading")}
                  <span className="rounded-full bg-secondary/20 px-2 py-0.5 text-xs font-bold text-secondary-dark">
                    {results.questions.length}
                  </span>
                </h2>
                <ul className="space-y-2">
                  {results.questions.map(({ set, question }, i) => (
                    <li
                      key={`${set.id}-${i}`}
                      className="flex items-start gap-3 rounded-2xl border border-border bg-surface p-4 shadow-sm transition hover:shadow-md"
                    >
                      <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-secondary/15 text-secondary-dark">
                        <ListChecks className="h-4 w-4" />
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-semibold text-text-primary">{highlight(question)}</p>
                        <p className="mt-0.5 truncate text-xs text-text-secondary">
                          {t("searchInSet", { title: set.title })} · {t("gradeOption", { grade: set.grade })}
                          {set.subject ? ` · ${set.subject}` : ""}
                        </p>
                      </div>
                      <Link
                        href={`/teacher/games/create?edit=${set.id}`}
                        title={c("edit")}
                        className="shrink-0 rounded-lg p-2 text-text-muted transition hover:bg-border/50 hover:text-text-primary"
                      >
                        <Pencil className="h-4 w-4" />
                      </Link>
                    </li>
                  ))}
                </ul>
              </section>
            )}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      {/* ── Hero ─────────────────────────────────────────── */}
      <div
        className="relative overflow-hidden rounded-3xl p-6 shadow-md sm:p-8"
        style={{ backgroundImage: GRAD.green }}
      >
        <div className="pointer-events-none absolute -right-10 -top-10 h-44 w-44 rounded-full bg-white/10" />
        <div className="pointer-events-none absolute -bottom-16 right-24 h-40 w-40 rounded-full bg-black/10" />
        <div className="pointer-events-none absolute right-40 top-10 select-none text-3xl">🎈</div>
        <div className="relative">
          <span className="inline-flex items-center gap-1.5 rounded-full bg-white/15 px-3 py-1 text-xs font-bold text-white ring-1 ring-inset ring-white/25 backdrop-blur-sm">
            <CalendarDays className="h-3.5 w-3.5" /> {dateStr}
          </span>
          <h1 className="mt-3 text-2xl font-extrabold leading-tight text-white sm:text-4xl">
            {t("dashGreeting", { name: name || "Teacher" })} <span className="inline-block">🎉</span>
          </h1>
          <p className="mt-2 max-w-xl text-base font-medium text-white/85">
            {t.rich("dashHeroLine", {
              q: stats.totalQuestions,
              s: stats.totalSets,
              b: (chunks) => <b className="font-extrabold text-white">{chunks}</b>,
            })}
          </p>
          <div className="mt-5 flex flex-wrap gap-2.5">
            <Link
              href="/teacher/games/tug"
              className="inline-flex items-center gap-2 rounded-full bg-secondary-dark px-5 py-2.5 text-sm font-bold text-white shadow-sm transition hover:brightness-105 active:scale-95"
            >
              <Swords className="h-4 w-4" /> {t("dashStartTug")}
            </Link>
            <Link
              href="/teacher/games/create"
              className="inline-flex items-center gap-2 rounded-full bg-white/15 px-5 py-2.5 text-sm font-bold text-white ring-1 ring-inset ring-white/40 backdrop-blur-sm transition hover:bg-white/25 active:scale-95"
            >
              <Plus className="h-4 w-4" /> {t("dashNew")}
            </Link>
          </div>
        </div>
      </div>

      {/* ── Stat cards ───────────────────────────────────── */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {statCards.map((s) => (
          <div
            key={s.label}
            className="relative overflow-hidden rounded-2xl border border-border bg-surface p-4 shadow-sm"
          >
            <div
              className="pointer-events-none absolute -right-4 -top-4 h-16 w-16 rounded-full opacity-15"
              style={{ backgroundColor: s.color }}
            />
            <div className="relative flex items-center gap-2.5">
              <span
                className="flex h-9 w-9 items-center justify-center rounded-xl text-white shadow-sm"
                style={{ backgroundColor: s.color }}
              >
                <s.icon className="h-5 w-5" />
              </span>
              <span className="text-sm font-semibold text-text-secondary">{s.label}</span>
            </div>
            <div className="relative mt-3 flex items-baseline gap-2">
              <span className="text-3xl font-extrabold leading-none text-text-primary tabular-nums">
                {s.value}
              </span>
              <span className="text-xs font-bold" style={{ color: s.color }}>
                {s.delta}
              </span>
            </div>
          </div>
        ))}
      </div>

      {/* ── Charts ───────────────────────────────────────── */}
      {hasGames && (
        <div className="grid gap-4 lg:grid-cols-2">
          {/* Questions by grade */}
          <div className="rounded-3xl border border-border bg-surface p-5 shadow-sm">
            <div className="mb-1 flex items-start justify-between gap-3">
              <div>
                <h2 className="flex items-center gap-2 text-base font-extrabold text-text-primary">
                  <span>📊</span> {t("dashByGrade")}
                </h2>
                <p className="text-xs text-text-secondary">{t("dashByGradeSub")}</p>
              </div>
              <span className="shrink-0 rounded-full bg-primary/10 px-3 py-1 text-xs font-bold text-primary">
                {t("dashTotalN", { n: stats.totalQuestions })}
              </span>
            </div>
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={stats.byGrade} margin={{ top: 22, right: 8, left: -20, bottom: 0 }}>
                <XAxis dataKey="grade" tick={{ fontSize: 11, fill: "var(--color-text-secondary)" }} tickLine={false} axisLine={false} />
                <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: "var(--color-text-secondary)" }} tickLine={false} axisLine={false} />
                <Bar dataKey="questions" radius={[10, 10, 4, 4]} maxBarSize={54}>
                  <LabelList dataKey="questions" position="top" style={{ fontSize: 12, fontWeight: 800, fill: "var(--color-text-primary)" }} />
                  {stats.byGrade.map((d, i) => (
                    <Cell key={i} fill={d.questions === 0 ? "var(--color-border)" : CHART_COLORS[i % CHART_COLORS.length]} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>

          {/* Sets by subject */}
          <div className="rounded-3xl border border-border bg-surface p-5 shadow-sm">
            <h2 className="flex items-center gap-2 text-base font-extrabold text-text-primary">
              <span>🎨</span> {t("dashBySubject")}
            </h2>
            <p className="mb-4 text-xs text-text-secondary">{t("dashBySubjectSub")}</p>
            <div className="space-y-3.5">
              {stats.bySubject.map((s, i) => {
                const color = CHART_COLORS[i % CHART_COLORS.length];
                return (
                  <div key={s.subject}>
                    <div className="mb-1 flex items-center justify-between text-sm">
                      <span className="flex items-center gap-2 font-semibold text-text-primary">
                        <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: color }} />
                        {s.subject}
                      </span>
                      <span className="font-bold tabular-nums" style={{ color }}>
                        {s.count}
                      </span>
                    </div>
                    <div className="h-2.5 overflow-hidden rounded-full bg-border">
                      <div className="h-full rounded-full transition-all" style={{ width: `${(s.count / maxSubject) * 100}%`, backgroundColor: color }} />
                    </div>
                  </div>
                );
              })}
            </div>
            {stats.bySubject.length > 0 && (
              <div className="mt-4 flex items-center justify-between rounded-2xl bg-primary/5 px-4 py-2.5">
                <span className="flex items-center gap-2 text-sm font-medium text-text-secondary">
                  <Trophy className="h-4 w-4 text-secondary-dark" /> {t("dashMostActive")}
                </span>
                <span className="text-sm font-extrabold text-primary">{stats.bySubject[0].subject}</span>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── Game hub ─────────────────────────────────────── */}
      <section>
        <h2 className="mb-3 flex items-center gap-2 text-lg font-extrabold text-text-primary">
          <span className="text-xl">🎮</span> {t("dashPlayHeading")}
        </h2>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {gameTiles.map((game) => (
            <Link
              key={game.href}
              href={game.href}
              onClick={() => playSfx("click")}
              style={{ backgroundImage: game.grad }}
              className="group relative flex flex-col overflow-hidden rounded-3xl p-5 shadow-md transition-all duration-200 hover:-translate-y-1 hover:shadow-xl focus:outline-none focus-visible:ring-4 focus-visible:ring-primary/30"
            >
              <div className="pointer-events-none absolute -right-6 -top-6 h-24 w-24 rounded-full bg-white/15 transition-transform duration-300 group-hover:scale-125" />
              <div className="pointer-events-none absolute -bottom-8 -left-4 h-20 w-20 rounded-full bg-black/10" />
              <div className="relative flex items-center gap-3">
                <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-white/25 backdrop-blur-sm">
                  <game.icon className="h-6 w-6 text-white" />
                </div>
                <span className="text-2xl" aria-hidden>
                  {game.emoji}
                </span>
              </div>
              <h3 className="relative mt-3 text-lg font-extrabold text-white">{game.name}</h3>
              <p className="relative mt-1 line-clamp-2 text-sm font-medium text-white/85">{game.desc}</p>
              <span className="relative mt-4 inline-flex items-center gap-1 text-sm font-bold text-white">
                {game.cta}
                <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-1" />
              </span>
            </Link>
          ))}
        </div>
      </section>

      {/* ── Create banner ────────────────────────────────── */}
      <Link
        href="/teacher/games/create"
        className="group relative flex items-center gap-4 overflow-hidden rounded-3xl border border-border bg-surface p-5 shadow-sm transition hover:shadow-md sm:p-6"
      >
        <div
          className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl text-white shadow-sm"
          style={{ backgroundImage: GRAD.green }}
        >
          <Sparkles className="h-7 w-7" />
        </div>
        <div className="min-w-0 flex-1">
          <h3 className="text-base font-bold text-text-primary sm:text-lg">{nav("teacherCreate")}</h3>
          <p className="mt-0.5 line-clamp-2 text-sm text-text-secondary">{t("createDesc")}</p>
        </div>
        <ArrowRight className="h-5 w-5 shrink-0 text-text-muted transition-transform group-hover:translate-x-1 group-hover:text-primary" />
      </Link>

      {/* ── Your game sets ───────────────────────────────── */}
      <section>
        <div className="mb-3 flex items-center justify-between gap-3">
          <h2 className="flex items-center gap-2 text-lg font-extrabold text-text-primary">
            <span className="text-xl">📚</span> {t("dashYourGames")}
          </h2>
          <Link
            href="/teacher/games/create"
            className="inline-flex items-center gap-1.5 rounded-full border border-border bg-surface px-3.5 py-1.5 text-sm font-semibold text-text-secondary shadow-sm transition hover:border-primary/40 hover:text-primary"
          >
            <Plus className="h-4 w-4" /> {t("dashNew")}
          </Link>
        </div>

        {hasGames ? (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {(games ?? []).map((s) => (
              <div
                key={s.id}
                className="group flex flex-col rounded-2xl border border-border bg-surface p-4 shadow-sm transition hover:shadow-md"
              >
                <div className="flex items-start gap-2">
                  <span className="mt-1.5 h-3 w-3 shrink-0 rounded-full" style={{ backgroundColor: subjectColor(s.subject || "—") }} />
                  <div className="min-w-0 flex-1">
                    <h3 className="truncate font-bold text-text-primary">{s.title}</h3>
                    <p className="truncate text-sm text-text-secondary">{s.subject || "—"}</p>
                  </div>
                </div>
                <div className="mt-3 flex flex-wrap items-center gap-1.5">
                  <span className="rounded-full bg-primary/10 px-2.5 py-0.5 text-xs font-semibold text-primary">
                    {t("gradeOption", { grade: s.grade })}
                  </span>
                  <span className="rounded-full bg-border/60 px-2.5 py-0.5 text-xs font-medium text-text-secondary">
                    {t("itemsCount", { count: s.questionCount })}
                  </span>
                </div>
                <div className="mt-4 flex items-center gap-1.5 border-t border-border pt-3">
                  <Link
                    href={`/teacher/games/tug?set=${s.id}`}
                    className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-primary px-3 py-2 text-sm font-bold text-white transition hover:bg-primary-dark"
                  >
                    <Play className="h-4 w-4" /> {g("play")}
                  </Link>
                  <Link
                    href={`/teacher/games/create?edit=${s.id}`}
                    title={c("edit")}
                    className="rounded-lg p-2 text-text-muted transition hover:bg-border/50 hover:text-text-primary"
                  >
                    <Pencil className="h-4 w-4" />
                  </Link>
                  <button
                    onClick={() => del(s.id)}
                    title={c("delete")}
                    className="rounded-lg p-2 text-text-muted transition hover:bg-error/10 hover:text-error"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="flex flex-col items-center gap-4 rounded-3xl border border-dashed border-border bg-surface px-6 py-12 text-center">
            <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-primary/10 text-3xl">🎯</div>
            <div>
              <h3 className="text-lg font-bold text-text-primary">
                {games === null ? c("loading") : t("dashEmptyTitle")}
              </h3>
              {games !== null && <p className="mt-1 text-text-secondary">{t("dashEmptyDesc")}</p>}
            </div>
            {games !== null && (
              <Link
                href="/teacher/games/create"
                className="inline-flex items-center gap-2 rounded-full bg-primary px-5 py-2.5 text-sm font-bold text-white shadow-sm transition hover:bg-primary-dark active:scale-95"
              >
                <Plus className="h-4 w-4" /> {t("dashNew")}
              </Link>
            )}
          </div>
        )}
      </section>
    </div>
  );
}
