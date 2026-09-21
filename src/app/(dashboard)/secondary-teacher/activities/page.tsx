"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { ArrowRight, ChevronRight, ClipboardList } from "lucide-react";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/utils";
import { formatAccuracy, accuracyTone } from "@/lib/class-insights";

/**
 * Everything this teacher has set, newest first, with how far the class has
 * got. No "overdue" state — a due date is advisory and late work is accepted.
 */

interface ActivityRow {
  id: string;
  kind: string;
  format: "QUESTIONS" | "DOCUMENT";
  status: "DRAFT" | "PUBLISHED" | "CLOSED";
  /** Handed in but not yet marked. Written work only. */
  awaitingMarking?: number;
  title: string;
  dueAt: string | null;
  subject: string;
  grade: number;
  section: string;
  questionCount: number;
  createdAt: string;
  assignedCount: number;
  startedCount: number;
  completedCount: number;
  averageScore: number | null;
}

const KIND_LABEL: Record<string, string> = {
  HOMEWORK: "Homework",
  CLASSWORK: "Classwork",
  ASSIGNMENT: "Assignment",
  TEST: "Test",
  PRACTICE: "Practice",
};

function formatDate(value: string | null): string {
  if (!value) return "No due date";
  return new Date(value).toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

export default function SecondaryTeacherActivitiesPage() {
  const [activities, setActivities] = useState<ActivityRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/secondary-teacher/activities");
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? "Failed to load your activities");
      setActivities(data.activities ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <div className="mx-auto max-w-5xl space-y-5">
      <div>
        <h1 className="text-2xl font-bold text-text-primary">Activities</h1>
        <p className="text-sm text-text-secondary">
          Homework, classwork and tests you have set. Start a new one from a class.
        </p>
      </div>

      {loading ? (
        <div className="flex justify-center py-16">
          <Spinner size="lg" className="text-primary" />
        </div>
      ) : error ? (
        <Card>
          <CardContent>
            <p className="py-8 text-center text-sm text-red-600">{error}</p>
          </CardContent>
        </Card>
      ) : activities.length === 0 ? (
        <Card>
          <CardContent>
            <div className="py-12 text-center">
              <ClipboardList className="mx-auto mb-3 h-10 w-10 text-text-muted" />
              <h2 className="font-semibold text-text-primary">Nothing set yet</h2>
              <p className="mx-auto mt-1 max-w-md text-sm text-text-secondary">
                Open one of your classes and use{" "}
                <span className="font-medium text-text-primary">Set activity</span> —
                the weakest chapters have a one-click shortcut.
              </p>
              <Link
                href="/secondary-teacher/classes"
                className="mt-4 inline-flex items-center gap-1.5 rounded-xl bg-primary px-4 py-2 text-sm font-semibold text-white hover:bg-primary-dark"
              >
                Go to my classes <ArrowRight className="h-4 w-4" />
              </Link>
            </div>
          </CardContent>
        </Card>
      ) : (
        /*
          One row per activity, not one card. A teacher scans this list to find
          the thing that needs them today, so the row is dense, the whole row
          is the link (a separate "View" wrapped under long titles), and the
          number that earns the most space is the one they can act on: work
          waiting to be marked.
        */
        <Card className="overflow-hidden">
          <ul className="divide-y divide-border">
            {activities.map((a) => {
              const progress =
                a.assignedCount > 0 ? a.completedCount / a.assignedCount : 0;
              const isDoc = a.format === "DOCUMENT";
              const toMark = a.awaitingMarking ?? 0;

              return (
                <li key={a.id}>
                  <Link
                    href={`/secondary-teacher/activities/${a.id}`}
                    className="flex items-center gap-4 px-4 py-3 transition-colors hover:bg-border/25"
                  >
                    {/* ── What it is ───────────────────────────────── */}
                    <div className="min-w-0 flex-1">
                      <div className="flex min-w-0 items-center gap-2">
                        <span className="truncate text-sm font-semibold text-text-primary">
                          {a.title}
                        </span>
                        {a.status === "DRAFT" && (
                          <span className="shrink-0 rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-amber-800">
                            Draft
                          </span>
                        )}
                        {a.status === "CLOSED" && (
                          <span className="shrink-0 rounded-full bg-red-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-red-700">
                            Closed
                          </span>
                        )}
                      </div>
                      <p className="mt-0.5 truncate text-xs text-text-muted">
                        {KIND_LABEL[a.kind] ?? a.kind} · {a.subject} · Grade {a.grade}{" "}
                        {a.section} ·{" "}
                        {isDoc ? "written work" : `${a.questionCount} questions`} ·{" "}
                        {formatDate(a.dueAt)}
                      </p>
                    </div>

                    {/* ── What needs doing ─────────────────────────── */}
                    {toMark > 0 && (
                      <span className="hidden shrink-0 rounded-full bg-blue-100 px-2.5 py-1 text-xs font-bold text-blue-700 sm:inline">
                        {toMark} to mark
                      </span>
                    )}

                    {/* ── How it is going ──────────────────────────── */}
                    {a.status === "DRAFT" ? (
                      <span className="hidden shrink-0 text-xs text-text-muted sm:inline">
                        Not sent
                      </span>
                    ) : (
                      <div className="hidden w-28 shrink-0 sm:block">
                        <div className="flex items-baseline justify-end gap-1.5">
                          <span className="text-sm font-bold text-text-primary">
                            {a.completedCount}
                          </span>
                          <span className="text-xs text-text-muted">
                            / {a.assignedCount} done
                          </span>
                        </div>
                        <div className="mt-1 h-1 w-full overflow-hidden rounded-full bg-border/60">
                          <div
                            className="h-full rounded-full bg-primary transition-[width]"
                            style={{ width: `${Math.round(progress * 100)}%` }}
                          />
                        </div>
                      </div>
                    )}

                    {/* Average only means something for an auto-marked paper. */}
                    <span className="w-14 shrink-0 text-right">
                      {!isDoc && a.completedCount > 0 ? (
                        <span
                          className={cn(
                            "rounded-full px-2 py-0.5 text-xs font-bold",
                            accuracyTone(
                              a.averageScore !== null ? a.averageScore / 100 : null,
                            ),
                          )}
                        >
                          {formatAccuracy(
                            a.averageScore !== null ? a.averageScore / 100 : null,
                          )}
                        </span>
                      ) : null}
                    </span>

                    <ChevronRight className="h-4 w-4 shrink-0 text-text-muted" />
                  </Link>
                </li>
              );
            })}
          </ul>
        </Card>
      )}
    </div>
  );
}
