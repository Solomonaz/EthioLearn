"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import {
  ArrowLeft,
  CheckCircle2,
  Circle,
  ClipboardList,
  Clock,
  Flame,
} from "lucide-react";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/utils";
import {
  formatAccuracy,
  accuracyTone,
  MIN_ANSWERS_TO_JUDGE,
  type MasteryLevel,
} from "@/lib/class-insights";
import { displayChapterTitle, displaySubject } from "@/lib/display-text";

/**
 * One student as their teacher sees them: mastery, everything the teacher set,
 * and the practice the student did on their own.
 *
 * Only the subjects this teacher teaches them appear — the API decides that,
 * and the page never asks for more.
 */

interface StudentDetail {
  student: {
    id: string;
    name: string;
    grade: number | null;
    section: string | null;
    lastActiveAt: string | null;
    streakDays: number;
    isActive: boolean;
  };
  subjects: string[];
  summary: {
    windowDays: number;
    answered: number;
    accuracy: number | null;
    activitiesAssigned: number;
    activitiesCompleted: number;
    activityAverage: number | null;
  };
  chapters: {
    id: string;
    title: string;
    chapterNumber: number;
    subject: string;
    answered: number;
    accuracy: number | null;
    masteryLevel: MasteryLevel;
  }[];
  activities: {
    id: string;
    kind: string;
    format: "QUESTIONS" | "DOCUMENT";
    title: string;
    subject: string;
    dueAt: string | null;
    createdAt: string;
    questionCount: number;
    maxMarks: number | null;
    marks: number | null;
    state: "not_started" | "in_progress" | "done" | "submitted" | "marked";
    correctAnswers: number | null;
    totalQuestions: number | null;
  }[];
  practiceQuizzes: {
    id: string;
    mode: string;
    score: number;
    correctAnswers: number;
    totalQuestions: number;
    completedAt: string | null;
    fromActivity: boolean;
  }[];
}

const MASTERY_TONE: Record<MasteryLevel, string> = {
  NOT_STARTED: "bg-border/50 text-text-secondary",
  IN_PROGRESS: "bg-red-100 text-red-700",
  PROFICIENT: "bg-amber-100 text-amber-700",
  MASTERED: "bg-green-100 text-green-700",
};

const MASTERY_LABEL: Record<MasteryLevel, string> = {
  NOT_STARTED: "Not started",
  IN_PROGRESS: "In progress",
  PROFICIENT: "Proficient",
  MASTERED: "Mastered",
};

// Every state the API can emit must have an entry. A missing one would throw
// on `meta.icon`, so this is indexed defensively as well.
const STATE_META: Record<
  string,
  { label: string; icon: typeof Circle; tone: string }
> = {
  not_started: { label: "Not started", icon: Circle, tone: "text-text-muted" },
  in_progress: { label: "In progress", icon: Clock, tone: "text-amber-600" },
  submitted: { label: "Handed in", icon: Clock, tone: "text-blue-600" },
  done: { label: "Done", icon: CheckCircle2, tone: "text-green-600" },
  marked: { label: "Marked", icon: CheckCircle2, tone: "text-green-600" },
};

const UNKNOWN_STATE = {
  label: "Unknown",
  icon: Circle,
  tone: "text-text-muted",
} as const;

export default function TeacherStudentPage() {
  const params = useParams<{ id: string }>();
  const studentId = params?.id;

  const [data, setData] = useState<StudentDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // The class the teacher came from, so "Back" returns to it rather than to
  // whichever class the list opens on. Read once on mount: useSearchParams
  // would need a Suspense boundary for a single link.
  const [backHref, setBackHref] = useState("/secondary-teacher/classes");
  useEffect(() => {
    const cls = new URLSearchParams(window.location.search).get("class");
    if (cls) setBackHref(`/secondary-teacher/classes?class=${encodeURIComponent(cls)}`);
  }, []);

  const load = useCallback(async () => {
    if (!studentId) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/secondary-teacher/students/${studentId}`);
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? "Failed to load this student");
      setData(body);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setLoading(false);
    }
  }, [studentId]);

  useEffect(() => {
    load();
  }, [load]);

  if (loading) {
    return (
      <div className="flex justify-center py-16">
        <Spinner size="lg" className="text-primary" />
      </div>
    );
  }

  if (error || !data) {
    return (
      <Card>
        <CardContent>
          <p className="py-8 text-center text-sm text-red-600">
            {error ?? "Student unavailable"}
          </p>
        </CardContent>
      </Card>
    );
  }

  const { student, summary, chapters, activities, practiceQuizzes, subjects } = data;

  return (
    <div className="mx-auto max-w-5xl space-y-5">
      <Link
        href={backHref}
        className="inline-flex items-center gap-1.5 text-sm font-semibold text-primary hover:underline"
      >
        <ArrowLeft className="h-4 w-4" /> Back to my classes
      </Link>

      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-2xl font-bold text-text-primary">{student.name}</h1>
          <p className="text-sm text-text-secondary">
            Grade {student.grade}
            {student.section ? ` ${student.section}` : ""} ·{" "}
            {subjects.map(displaySubject).join(", ")} · Last active{" "}
            {student.lastActiveAt
              ? new Date(student.lastActiveAt).toLocaleDateString()
              : "never"}
          </p>
        </div>
        {student.streakDays > 0 && (
          <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-100 px-3 py-1 text-xs font-bold text-amber-700">
            <Flame className="h-3.5 w-3.5" /> {student.streakDays}-day streak
          </span>
        )}
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <Tile
          label={`Accuracy (last ${summary.windowDays} days)`}
          value={formatAccuracy(summary.accuracy)}
          // Below the answer count that can be trusted, shown but not coloured
          // as a verdict — the same rule as the class list.
          tone={accuracyTone(summary.answered >= MIN_ANSWERS_TO_JUDGE ? summary.accuracy : null)}
          hint={`${summary.answered} questions answered`}
        />
        <Tile
          label="Your activities"
          value={`${summary.activitiesCompleted} of ${summary.activitiesAssigned}`}
          hint="completed"
        />
        <Tile
          label="Activity average"
          value={formatAccuracy(summary.activityAverage)}
          tone={accuracyTone(summary.activityAverage)}
          hint="across completed work"
        />
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        {/* ── Chapter mastery ────────────────────────────────────────── */}
        <Card>
          <CardHeader>
            <h2 className="font-semibold text-text-primary">Chapter mastery</h2>
            <p className="text-xs text-text-muted">
              Weakest first, in the subjects you teach them.
            </p>
          </CardHeader>
          <CardContent>
            {chapters.length === 0 ? (
              <p className="py-6 text-center text-sm text-text-muted">
                No answers yet.
              </p>
            ) : (
              <ul className="space-y-2">
                {chapters.map((c) => (
                  <li
                    key={c.id}
                    className="flex items-center justify-between gap-2 rounded-xl bg-border/30 px-3 py-2"
                  >
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-text-primary">
                        {c.chapterNumber}. {displayChapterTitle(c.title)}
                      </p>
                      <p className="text-[11px] text-text-muted">
                        {displaySubject(c.subject)} · {c.answered} answered
                      </p>
                    </div>
                    <span
                      className={cn(
                        "shrink-0 rounded-full px-2 py-0.5 text-xs font-bold",
                        MASTERY_TONE[c.masteryLevel],
                      )}
                    >
                      {MASTERY_LABEL[c.masteryLevel]}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        {/* ── Activities you set ─────────────────────────────────────── */}
        <Card>
          <CardHeader>
            <h2 className="font-semibold text-text-primary">Work you set</h2>
            <p className="text-xs text-text-muted">
              Newest first. Nothing is marked late.
            </p>
          </CardHeader>
          <CardContent>
            {activities.length === 0 ? (
              <div className="py-6 text-center">
                <ClipboardList className="mx-auto mb-2 h-7 w-7 text-text-muted" />
                <p className="text-sm text-text-muted">
                  You have not set anything for this student yet.
                </p>
              </div>
            ) : (
              <ul className="divide-y divide-border">
                {activities.map((a) => {
                  const meta = STATE_META[a.state] ?? UNKNOWN_STATE;
                  const Icon = meta.icon;
                  return (
                    <li key={a.id} className="flex items-center justify-between gap-3 py-2">
                      <div className="flex min-w-0 items-center gap-2">
                        <Icon className={cn("h-4 w-4 shrink-0", meta.tone)} />
                        <div className="min-w-0">
                          <Link
                            href={`/secondary-teacher/activities/${a.id}`}
                            title={a.title}
                            className="block truncate text-sm font-medium text-text-primary hover:underline"
                          >
                            {a.title}
                          </Link>
                          <p className="text-[11px] text-text-muted">
                            {a.kind.toLowerCase()} · {meta.label}
                          </p>
                        </div>
                      </div>
                      <span className="shrink-0 rounded-full bg-border/50 px-2 py-0.5 text-xs font-bold text-text-secondary">
                        {a.format === "DOCUMENT"
                          ? a.state === "marked"
                            ? a.marks !== null && a.maxMarks
                              ? `${a.marks}/${a.maxMarks}`
                              : "Marked"
                            : a.state === "submitted"
                              ? "To mark"
                              : a.state === "done"
                                ? "Done"
                                : "—"
                          : a.state === "done"
                            ? `${a.correctAnswers}/${a.totalQuestions}`
                            : "—"}
                      </span>
                    </li>
                  );
                })}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>

      {/* ── Their own practice ───────────────────────────────────────── */}
      <Card>
        <CardHeader>
          <h2 className="font-semibold text-text-primary">Recent practice</h2>
          <p className="text-xs text-text-muted">
            Quizzes they completed in your subjects, including work you set.
          </p>
        </CardHeader>
        <CardContent>
          {practiceQuizzes.length === 0 ? (
            <p className="py-6 text-center text-sm text-text-muted">
              No completed quizzes yet.
            </p>
          ) : (
            <ul className="divide-y divide-border">
              {practiceQuizzes.map((q) => (
                <li key={q.id} className="flex items-center justify-between gap-3 py-2">
                  <div className="min-w-0">
                    <p className="text-sm text-text-primary">
                      {q.correctAnswers} of {q.totalQuestions} correct
                    </p>
                    <p className="text-[11px] text-text-muted">
                      {q.completedAt
                        ? new Date(q.completedAt).toLocaleDateString()
                        : "—"}
                      {q.fromActivity ? " · from work you set" : " · own practice"}
                    </p>
                  </div>
                  <span
                    className={cn(
                      "shrink-0 rounded-full px-2 py-0.5 text-xs font-bold",
                      accuracyTone(q.score / 100),
                    )}
                  >
                    {q.score}%
                  </span>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function Tile({
  label,
  value,
  hint,
  tone,
}: {
  label: string;
  value: string;
  hint?: string;
  tone?: string;
}) {
  return (
    <Card>
      <CardContent>
        <div className="py-1">
          <span
            className={cn(
              "inline-block text-xl font-bold text-text-primary",
              tone && "rounded-full px-2 py-0.5",
              tone,
            )}
          >
            {value}
          </span>
          <p className="mt-1 text-xs text-text-secondary">{label}</p>
          {hint && <p className="text-[11px] text-text-muted">{hint}</p>}
        </div>
      </CardContent>
    </Card>
  );
}
