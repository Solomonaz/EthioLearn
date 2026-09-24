"use client";

import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { AlertTriangle, ArrowRight, GraduationCap, Plus, Users } from "lucide-react";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/utils";
import type { ClassInsight } from "@/types/secondary-teacher";
import {
  formatAccuracy,
  accuracyTone,
  needsHelp,
  MIN_ANSWERS_TO_JUDGE,
} from "@/lib/class-insights";
import { displayChapterTitle, displaySubject } from "@/lib/display-text";
import {
  SetActivityDialog,
  type SetActivityTarget,
} from "@/components/secondary-teacher/set-activity-dialog";

/**
 * Class detail for a grades 9-12 teacher: pick one class — a (subject, grade,
 * section) triple — and see its weak chapters and its students, weakest first.
 */
export default function SecondaryTeacherClassesPage() {
  return (
    <Suspense
      fallback={
        <div className="flex justify-center py-16">
          <Spinner size="lg" className="text-primary" />
        </div>
      }
    >
      <ClassesView />
    </Suspense>
  );
}

function ClassesView() {
  const searchParams = useSearchParams();
  const requestedId = searchParams.get("class");

  const [classes, setClasses] = useState<ClassInsight[]>([]);
  const [windowDays, setWindowDays] = useState(90);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activityTarget, setActivityTarget] = useState<SetActivityTarget | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/secondary-teacher/classes");
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? "Failed to load your classes");
      const list: ClassInsight[] = data.classes ?? [];
      setClasses(list);
      setWindowDays(data.windowDays ?? 90);
      // Honour ?class= only when it names a pair this teacher actually holds.
      // Otherwise open the class with the most going on — the first class
      // alphabetically was often an empty one ("biology · 0 students").
      const wanted = list.find((c) => c.id === requestedId);
      const busiest = [...list].sort(
        (a, b) => b.studentCount - a.studentCount || b.answered - a.answered,
      )[0];
      setSelectedId(wanted?.id ?? busiest?.id ?? null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setLoading(false);
    }
  }, [requestedId]);

  useEffect(() => {
    load();
  }, [load]);

  const selected = useMemo(
    () => classes.find((c) => c.id === selectedId) ?? null,
    [classes, selectedId],
  );

  // Students whose overall standing — quiz accuracy AND marked written work,
  // see lib/class-insights — is below the threshold, on enough evidence to
  // judge. Students with little or no activity are excluded: sending extra
  // work on five answers, or for being absent, would be the wrong signal.
  const strugglers = useMemo(
    () => (selected?.students ?? []).filter((s) => needsHelp(s)),
    [selected],
  );

  /**
   * Open the dialog for the selected class. Audience defaults to the whole
   * class everywhere; `defaultAudience` is only passed by the remedial entry
   * point, and even then the teacher can switch back inside the dialog.
   */
  const openDialog = useCallback(
    (opts: { chapterId?: string; defaultAudience?: "class" | "struggling" } = {}) => {
      if (!selected) return;
      setActivityTarget({
        classId: selected.id,
        subject: selected.subject,
        grade: selected.grade,
        section: selected.section,
        chapterId: opts.chapterId,
        studentCount: selected.studentCount,
        strugglingIds: strugglers.map((s) => s.id),
        defaultAudience: opts.defaultAudience,
      });
    },
    [selected, strugglers],
  );

  if (loading) {
    return (
      <div className="flex justify-center py-16">
        <Spinner size="lg" className="text-primary" />
      </div>
    );
  }

  if (error) {
    return (
      <Card>
        <CardContent>
          <p className="py-8 text-center text-sm text-red-600">{error}</p>
        </CardContent>
      </Card>
    );
  }

  if (classes.length === 0) {
    return (
      <Card>
        <CardContent>
          <div className="py-12 text-center">
            <GraduationCap className="mx-auto mb-3 h-10 w-10 text-text-muted" />
            <h2 className="font-semibold text-text-primary">No classes yet</h2>
            <p className="mx-auto mt-1 max-w-md text-sm text-text-secondary">
              Add the subjects and grades you teach on your profile to see your
              classes here.
            </p>
            <Link
              href="/secondary-teacher/profile"
              className="mt-4 inline-flex items-center gap-1.5 rounded-xl bg-primary px-4 py-2 text-sm font-semibold text-white hover:bg-primary-dark"
            >
              Go to profile <ArrowRight className="h-4 w-4" />
            </Link>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="mx-auto max-w-6xl space-y-5">
      <div>
        <h1 className="text-2xl font-bold text-text-primary">My classes</h1>
        <p className="text-sm text-text-secondary">
          Based on quiz answers from the last {windowDays} days.
        </p>
      </div>

      {/* ── Pair picker ──────────────────────────────────────────────── */}
      <div className="flex flex-wrap gap-2">
        {classes.map((c) => (
          <button
            key={c.id}
            type="button"
            onClick={() => setSelectedId(c.id)}
            className={cn(
              "rounded-2xl border px-4 py-2 text-left transition",
              selectedId === c.id
                ? "border-primary bg-primary/10"
                : "border-border bg-surface hover:border-primary/40",
            )}
          >
            <span className="block text-sm font-bold text-text-primary">
              {displaySubject(c.subject)}
            </span>
            <span className="block text-xs text-text-muted">
              Grade {c.grade}
              {c.section ? ` ${c.section}` : " (all)"} · {c.studentCount}{" "}
              {c.studentCount === 1 ? "student" : "students"}
            </span>
          </button>
        ))}
      </div>

      {/* Primary action. Homework, assignments and practice are set for the
          whole class — that is the default path and it leads here. */}
      {selected && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-border bg-surface px-4 py-3">
          <div className="min-w-0">
            <p className="text-sm font-semibold text-text-primary">
              Set homework, classwork or a test
            </p>
            <p className="text-xs text-text-muted">
              Goes to {selected.studentCount === 1 ? "the 1 student" : `all ${selected.studentCount} students`}{" "}
              in {displaySubject(selected.subject)} grade {selected.grade}
              {selected.section ? ` ${selected.section}` : ""}.
              {strugglers.length > 0
                ? " You can narrow it to those who are behind in the next step."
                : ""}
            </p>
          </div>
          <Button
            type="button"
            onClick={() => openDialog()}
            disabled={selected.studentCount === 0}
          >
            <Plus className="mr-1.5 h-4 w-4" /> Set activity
          </Button>
        </div>
      )}

      {activityTarget && (
        <SetActivityDialog
          target={activityTarget}
          onClose={() => setActivityTarget(null)}
        />
      )}

      {selected && (
        <div className="grid gap-5 lg:grid-cols-3">
          {/* ── Weak chapters ──────────────────────────────────────── */}
          <div className="lg:col-span-1">
            <Card>
              <CardHeader>
                <h2 className="font-semibold text-text-primary">Weakest chapters</h2>
                <p className="text-xs text-text-muted">
                  Lowest accuracy first, from chapters with enough answers to judge.
                </p>
              </CardHeader>
              <CardContent>
                {selected.weakChapters.length === 0 ? (
                  <p className="py-6 text-center text-sm text-text-muted">
                    Not enough answers yet.
                  </p>
                ) : (
                  <ul className="space-y-2">
                    {selected.weakChapters.map((ch) => (
                      <li
                        key={ch.id}
                        className="flex items-center justify-between gap-2 rounded-xl bg-border/30 px-3 py-2"
                      >
                        <div className="min-w-0">
                          <p className="truncate text-sm font-medium text-text-primary">
                            {ch.chapterNumber}. {displayChapterTitle(ch.title)}
                          </p>
                          <p className="text-[11px] text-text-muted">
                            {ch.answered} answers
                          </p>
                        </div>
                        <div className="flex shrink-0 items-center gap-1.5">
                          <span
                            className={cn(
                              "rounded-full px-2 py-0.5 text-xs font-bold",
                              accuracyTone(ch.accuracy),
                            )}
                          >
                            {formatAccuracy(ch.accuracy)}
                          </span>
                          <button
                            type="button"
                            onClick={() => openDialog({ chapterId: ch.id })}
                            className="rounded-lg px-2 py-0.5 text-xs font-bold text-primary transition hover:bg-primary/10"
                          >
                            Set
                          </button>
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </CardContent>
            </Card>
          </div>

          {/* ── Students ───────────────────────────────────────────── */}
          <div className="lg:col-span-2">
            <Card>
              <CardHeader>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <Users className="h-5 w-5 text-primary" />
                    <h2 className="font-semibold text-text-primary">
                      {displaySubject(selected.subject)} · Grade {selected.grade}
                      {selected.section ? ` Section ${selected.section}` : " (all sections)"}
                    </h2>
                  </div>
                  <div className="flex items-center gap-2">
                    <span
                      className={cn(
                        "rounded-full px-2.5 py-1 text-xs font-bold",
                        selected.answered >= MIN_ANSWERS_TO_JUDGE
                          ? accuracyTone(selected.accuracy)
                          : accuracyTone(null),
                      )}
                    >
                      Quiz average {formatAccuracy(selected.accuracy)}
                    </span>
                    {strugglers.length > 0 && (
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        onClick={() =>
                          openDialog({
                            chapterId: selected.weakChapters[0]?.id,
                            defaultAudience: "struggling",
                          })
                        }
                      >
                        Extra work for {strugglers.length} behind
                      </Button>
                    )}
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                {selected.students.length === 0 ? (
                  <p className="flex items-start justify-center gap-1.5 py-8 text-center text-sm text-amber-600">
                    <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                    No students are registered in grade {selected.grade}
                    {selected.section ? ` section ${selected.section}` : ""} at your
                    school yet.
                  </p>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b border-border text-left text-xs uppercase text-text-muted">
                          <th className="pb-2 pr-3 font-semibold">Student</th>
                          {/* Only a whole-grade class has more than one section to tell apart. */}
                          {!selected.section && (
                            <th className="pb-2 pr-3 font-semibold">Section</th>
                          )}
                          <th
                            className="pb-2 pr-3 text-right font-semibold"
                            title={`Quiz accuracy is trusted from ${MIN_ANSWERS_TO_JUDGE} answers`}
                          >
                            Quizzes
                          </th>
                          <th className="pb-2 pr-3 text-right font-semibold">Marked work</th>
                          <th className="pb-2 pr-3 text-right font-semibold">Work done</th>
                          <th className="pb-2 text-right font-semibold">Last active</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-border">
                        {selected.students.map((s) => {
                          return (
                            <tr key={s.id}>
                              <td className="py-2 pr-3">
                                <Link
                                  href={`/secondary-teacher/students/${s.id}?class=${selected.id}`}
                                  className="font-medium text-text-primary hover:text-primary hover:underline"
                                >
                                  {s.name}
                                </Link>
                                {needsHelp(s) && (
                                  <span className="ml-2 rounded-full bg-red-100 px-1.5 py-0.5 text-[10px] font-bold text-red-700">
                                    needs help
                                  </span>
                                )}
                              </td>
                              {!selected.section && (
                                <td className="py-2 pr-3 text-text-secondary">
                                  {s.section ?? "—"}
                                </td>
                              )}
                              <td className="py-2 pr-3 text-right">
                                <span
                                  className={cn(
                                    "rounded-full px-2 py-0.5 text-xs font-bold",
                                    // Too few answers to judge: shown, but not coloured as a verdict.
                                    s.answered >= MIN_ANSWERS_TO_JUDGE
                                      ? accuracyTone(s.accuracy)
                                      : accuracyTone(null),
                                  )}
                                >
                                  {formatAccuracy(s.accuracy)}
                                </span>
                                <span className="block text-[10px] text-text-muted">
                                  {s.answered} {s.answered === 1 ? "answer" : "answers"}
                                </span>
                              </td>
                              <td className="py-2 pr-3 text-right">
                                <span
                                  className={cn(
                                    "rounded-full px-2 py-0.5 text-xs font-bold",
                                    accuracyTone(s.markedAverage),
                                  )}
                                >
                                  {formatAccuracy(s.markedAverage)}
                                </span>
                                {s.markedCount > 0 && (
                                  <span className="block text-[10px] text-text-muted">
                                    {s.markedCount} marked
                                  </span>
                                )}
                              </td>
                              <td className="py-2 pr-3 text-right text-text-secondary">
                                {s.workAssigned > 0 ? `${s.workDone}/${s.workAssigned}` : "—"}
                              </td>
                              <td className="py-2 text-right text-xs text-text-secondary">
                                {lastActive(s.lastActiveAt)}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        </div>
      )}
    </div>
  );
}

/** "Today", "3 days ago", "2 weeks ago" — or "Never" for a student who has not signed in. */
function lastActive(iso: string | null): string {
  if (!iso) return "Never";
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
  if (days <= 0) return "Today";
  if (days === 1) return "Yesterday";
  if (days < 14) return `${days} days ago`;
  if (days < 60) return `${Math.floor(days / 7)} weeks ago`;
  return `${Math.floor(days / 30)} months ago`;
}
