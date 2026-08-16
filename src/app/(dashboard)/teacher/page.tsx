"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useSession } from "next-auth/react";
import { useTranslations } from "next-intl";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Cell,
} from "recharts";
import {
  Layers,
  ListChecks,
  BookOpen,
  GraduationCap,
  Swords,
  Plus,
  Play,
  Pencil,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { StatCard } from "@/components/shared/stat-card";

interface SetSummary {
  id: string;
  title: string;
  subject: string;
  grade: number;
  language: string;
  questionCount: number;
  updatedAt: string;
}

const PRIMARY = "#1B5E20";
const SUBJECT_COLORS = ["#1B5E20", "#2e7d32", "#4CAF50", "#66BB6A", "#f59e0b", "#0ea5e9"];

export default function TeacherDashboardPage() {
  const { data: session } = useSession();
  const t = useTranslations("teacher");
  const g = useTranslations("games");
  const c = useTranslations("common");
  const name = session?.user?.name ?? "";

  const [games, setGames] = useState<SetSummary[] | null>(null);

  const load = () =>
    fetch("/api/teacher/games")
      .then((r) => (r.ok ? r.json() : { games: [] }))
      .then((d) => setGames(d.games ?? []))
      .catch(() => setGames([]));

  useEffect(() => {
    load();
  }, []);

  const stats = useMemo(() => {
    const list = games ?? [];
    const totalQuestions = list.reduce((s, x) => s + (x.questionCount || 0), 0);
    const subjects = new Set(list.map((x) => x.subject.trim().toLowerCase()).filter(Boolean));
    const grades = new Set(list.map((x) => x.grade));

    const byGrade = Array.from({ length: 6 }, (_, i) => {
      const grade = i + 1;
      return {
        grade: `${g("mtGradeN", { n: grade })}`,
        questions: list.filter((x) => x.grade === grade).reduce((s, x) => s + (x.questionCount || 0), 0),
      };
    });

    const subjMap = new Map<string, number>();
    list.forEach((x) => {
      const key = x.subject.trim() || "—";
      subjMap.set(key, (subjMap.get(key) ?? 0) + 1);
    });
    const bySubject = Array.from(subjMap.entries())
      .map(([subject, count]) => ({ subject, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 6);

    return { totalSets: list.length, totalQuestions, subjects: subjects.size, grades: grades.size, byGrade, bySubject };
  }, [games, g]);

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

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      {/* header */}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-text-primary sm:text-3xl">{t("welcome", { name })}</h1>
          <p className="mt-1 text-text-secondary">{t("subtitle")}</p>
        </div>
        <div className="flex items-center gap-2">
          <Link href="/teacher/games/create">
            <Button variant="outline">
              <Plus className="h-4 w-4" /> {t("dashNew")}
            </Button>
          </Link>
          <Link href="/teacher/games/tug">
            <Button>
              <Swords className="h-4 w-4" /> {t("dashStartTug")}
            </Button>
          </Link>
        </div>
      </div>

      {/* stats */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label={t("dashSets")} value={games === null ? "…" : stats.totalSets} icon={Layers} />
        <StatCard label={t("dashQuestions")} value={games === null ? "…" : stats.totalQuestions} icon={ListChecks} />
        <StatCard label={t("dashSubjects")} value={games === null ? "…" : stats.subjects} icon={BookOpen} />
        <StatCard label={t("dashGrades")} value={games === null ? "…" : stats.grades} icon={GraduationCap} />
      </div>

      {hasGames ? (
        <>
          {/* charts */}
          <div className="grid gap-4 lg:grid-cols-2">
            <Card className="p-5">
              <h2 className="mb-4 text-sm font-semibold text-text-primary">{t("dashByGrade")}</h2>
              <ResponsiveContainer width="100%" height={220}>
                <BarChart data={stats.byGrade} margin={{ top: 4, right: 8, left: -18, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" vertical={false} />
                  <XAxis dataKey="grade" tick={{ fontSize: 11, fill: "var(--color-text-secondary)" }} tickLine={false} axisLine={false} />
                  <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: "var(--color-text-secondary)" }} tickLine={false} axisLine={false} />
                  <Tooltip cursor={{ fill: "var(--color-border)", opacity: 0.4 }} contentStyle={{ borderRadius: 8, fontSize: 12 }} />
                  <Bar dataKey="questions" fill={PRIMARY} radius={[6, 6, 0, 0]} maxBarSize={48} />
                </BarChart>
              </ResponsiveContainer>
            </Card>

            <Card className="p-5">
              <h2 className="mb-4 text-sm font-semibold text-text-primary">{t("dashBySubject")}</h2>
              <ResponsiveContainer width="100%" height={220}>
                <BarChart data={stats.bySubject} layout="vertical" margin={{ top: 4, right: 8, left: 8, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" horizontal={false} />
                  <XAxis type="number" allowDecimals={false} tick={{ fontSize: 11, fill: "var(--color-text-secondary)" }} tickLine={false} axisLine={false} />
                  <YAxis type="category" dataKey="subject" width={90} tick={{ fontSize: 11, fill: "var(--color-text-secondary)" }} tickLine={false} axisLine={false} />
                  <Tooltip cursor={{ fill: "var(--color-border)", opacity: 0.4 }} contentStyle={{ borderRadius: 8, fontSize: 12 }} />
                  <Bar dataKey="count" radius={[0, 6, 6, 0]} maxBarSize={26}>
                    {stats.bySubject.map((_, i) => (
                      <Cell key={i} fill={SUBJECT_COLORS[i % SUBJECT_COLORS.length]} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </Card>
          </div>

          {/* manageable game sets */}
          <Card className="overflow-hidden">
            <div className="flex items-center justify-between gap-3 border-b border-border px-5 py-4">
              <h2 className="font-semibold text-text-primary">{t("dashYourGames")}</h2>
              <Link href="/teacher/games/create">
                <Button size="sm" variant="outline">
                  <Plus className="h-4 w-4" /> {t("dashNew")}
                </Button>
              </Link>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="border-b border-border text-xs uppercase tracking-wide text-text-muted">
                    <th className="px-5 py-3 font-medium">{t("dashColTitle")}</th>
                    <th className="px-3 py-3 font-medium">{t("dashColSubject")}</th>
                    <th className="px-3 py-3 font-medium">{t("dashColGrade")}</th>
                    <th className="px-3 py-3 font-medium">{t("dashColQuestions")}</th>
                    <th className="px-3 py-3 font-medium">{t("dashColUpdated")}</th>
                    <th className="px-5 py-3 text-right font-medium"></th>
                  </tr>
                </thead>
                <tbody>
                  {(games ?? []).map((s) => (
                    <tr key={s.id} className="border-b border-border/60 last:border-0 hover:bg-border/20">
                      <td className="px-5 py-3 font-medium text-text-primary">{s.title}</td>
                      <td className="px-3 py-3 text-text-secondary">{s.subject}</td>
                      <td className="px-3 py-3 text-text-secondary">{t("gradeOption", { grade: s.grade })}</td>
                      <td className="px-3 py-3 text-text-secondary">{s.questionCount}</td>
                      <td className="px-3 py-3 text-text-muted">{new Date(s.updatedAt).toLocaleDateString()}</td>
                      <td className="px-5 py-3">
                        <div className="flex items-center justify-end gap-1">
                          <Link href={`/teacher/games/tug?set=${s.id}`} title={g("play")} className="rounded-lg p-2 text-text-muted hover:bg-border/50 hover:text-primary">
                            <Play className="h-4 w-4" />
                          </Link>
                          <Link href={`/teacher/games/create?edit=${s.id}`} title={c("edit")} className="rounded-lg p-2 text-text-muted hover:bg-border/50 hover:text-text-primary">
                            <Pencil className="h-4 w-4" />
                          </Link>
                          <button onClick={() => del(s.id)} title={c("delete")} className="rounded-lg p-2 text-text-muted hover:bg-border/50 hover:text-error">
                            <Trash2 className="h-4 w-4" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        </>
      ) : (
        /* empty state */
        <Card className="flex flex-col items-center gap-4 px-6 py-12 text-center">
          <div className="rounded-2xl bg-primary/10 p-4">
            <Swords className="h-8 w-8 text-primary" />
          </div>
          <div>
            <h2 className="text-lg font-bold text-text-primary">
              {games === null ? c("loading") : t("dashEmptyTitle")}
            </h2>
            {games !== null && <p className="mt-1 text-text-secondary">{t("dashEmptyDesc")}</p>}
          </div>
          {games !== null && (
            <div className="flex flex-wrap items-center justify-center gap-2">
              <Link href="/teacher/games/create">
                <Button>
                  <Plus className="h-4 w-4" /> {t("dashNew")}
                </Button>
              </Link>
              <Link href="/teacher/games/tug">
                <Button variant="outline">
                  <Swords className="h-4 w-4" /> {t("dashStartTug")}
                </Button>
              </Link>
            </div>
          )}
        </Card>
      )}
    </div>
  );
}
