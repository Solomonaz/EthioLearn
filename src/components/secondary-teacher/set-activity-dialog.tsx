"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { toast } from "@/components/ui/sonner";
import { cn } from "@/lib/utils";
import { displayChapterTitle, displaySubject } from "@/lib/display-text";
import { getStudyScope } from "@/lib/grade-scope";
import { consumeSse } from "@/lib/sse-client";
import {
  GenerationProgressCard,
  type GenerationProgressState,
} from "@/components/ui/generation-progress";

/**
 * Set an activity for one class — the "one click" surface.
 *
 * Opened from a class (and optionally from a weak chapter, which pre-selects
 * that chapter), so the common path is: open, confirm, done. Everything else
 * has a sensible default.
 */

const KINDS = [
  { value: "HOMEWORK", label: "Homework" },
  { value: "CLASSWORK", label: "Classwork" },
  { value: "ASSIGNMENT", label: "Assignment" },
  { value: "TEST", label: "Test" },
  { value: "PRACTICE", label: "Practice" },
] as const;

const DIFFICULTIES = [
  { value: "", label: "Mixed" },
  { value: "EASY", label: "Easy" },
  { value: "MEDIUM", label: "Medium" },
  { value: "HARD", label: "Hard" },
] as const;

const COUNTS = [5, 10, 15, 20, 30];

/** Question types a teacher can ask for, matching the QuestionType enum. */
const QUESTION_TYPES = [
  { value: "MCQ", label: "Multiple choice" },
  { value: "TRUE_FALSE", label: "True / false" },
  { value: "FILL_IN_BLANK", label: "Fill in the blank" },
  { value: "MATCH_PAIRS", label: "Match pairs" },
  { value: "ORDERING", label: "Ordering" },
] as const;

interface Textbook {
  id: string;
  title: string;
  grade: number;
}

interface Chapter {
  id: string;
  title: string;
  chapterNumber: number;
}

export interface SetActivityTarget {
  /** TeachingAssignment id. */
  classId: string;
  subject: string;
  grade: number;
  section: string | null;
  /** Pre-select this chapter (from a weak-chapter shortcut). */
  chapterId?: string;
  /** Everyone in the class. This is the default audience. */
  studentCount: number;
  /**
   * Students currently below the weak threshold. Offered as an OPTIONAL
   * narrowing, never the default: homework, assignments and practice are set
   * for the whole class, and remedial work is the exception.
   */
  strugglingIds?: string[];
  /** Which audience to open on. Defaults to the whole class. */
  defaultAudience?: Audience;
}

type Audience = "class" | "struggling";

export function SetActivityDialog({
  target,
  onClose,
  onCreated,
}: {
  target: SetActivityTarget;
  onClose: () => void;
  onCreated?: () => void;
}) {
  const router = useRouter();
  const [textbooks, setTextbooks] = useState<Textbook[]>([]);
  const [textbookId, setTextbookId] = useState("");
  const [chapters, setChapters] = useState<Chapter[]>([]);
  // Many chapters, not one: revision before a test rarely sits in a single
  // chapter. The first selected one is still the "primary" for the server.
  const [chapterIds, setChapterIds] = useState<string[]>(
    target.chapterId ? [target.chapterId] : [],
  );
  const [loadingBooks, setLoadingBooks] = useState(true);
  const [loadingChapters, setLoadingChapters] = useState(false);

  const [audience, setAudience] = useState<Audience>(
    target.defaultAudience ?? "class",
  );
  const [kind, setKind] = useState<string>("HOMEWORK");
  const [questionCount, setQuestionCount] = useState(10);
  const [difficulty, setDifficulty] = useState("");
  const [questionTypes, setQuestionTypes] = useState<string[]>(["MCQ"]);
  /**
   * A question paper is auto-marked; workout problems are calculations the
   * student works on paper and the teacher marks. They are different kinds of
   * thing, so this is a choice rather than another question-type chip.
   */
  const [paperType, setPaperType] = useState<"QUESTIONS" | "WORKOUT">("QUESTIONS");
  const [maxMarks, setMaxMarks] = useState<number | "">("");
  /**
   * Where a question paper's questions come from. No default: the teacher must
   * choose, because the two differ in cost and freshness — "BANK" serves only
   * stored questions (instant, no AI), "AI" writes a brand-new set.
   */
  const [source, setSource] = useState<"BANK" | "AI" | null>(null);
  const useAi = source === "AI";
  const [progress, setProgress] = useState<GenerationProgressState | null>(null);
  const [dueAt, setDueAt] = useState("");
  const [title, setTitle] = useState("");
  const [instructions, setInstructions] = useState("");
  const [submitting, setSubmitting] = useState(false);

  // Textbooks for this class's subject, across every grade the class may
  // study. Ethiopian cycles are cumulative, so a grade 12 class can be set
  // grade 11 revision — the activities route accepts it, and asking only for
  // `target.grade` here is what used to hide those books from the teacher.
  const studyGrades = useMemo(
    () => getStudyScope(target.grade).join(","),
    [target.grade],
  );

  useEffect(() => {
    let cancelled = false;
    setLoadingBooks(true);
    fetch(
      `/api/textbooks?subject=${encodeURIComponent(target.subject)}&grade=${studyGrades}`,
    )
      .then((r) => (r.ok ? r.json() : { textbooks: [] }))
      .then((d) => {
        if (cancelled) return;
        const books: Textbook[] = d.textbooks ?? [];
        setTextbooks(books);
        // Default to the class's own grade rather than the lowest one the
        // cycle allows; revision is a deliberate choice, not the starting point.
        setTextbookId((cur) => {
          if (cur) return cur;
          const own = books.find((b) => b.grade === target.grade);
          return own?.id ?? books[0]?.id ?? "";
        });
      })
      .catch(() => !cancelled && setTextbooks([]))
      .finally(() => !cancelled && setLoadingBooks(false));
    return () => {
      cancelled = true;
    };
  }, [target.subject, target.grade, studyGrades]);

  // Chapters for the chosen textbook.
  useEffect(() => {
    if (!textbookId) {
      setChapters([]);
      return;
    }
    let cancelled = false;
    setLoadingChapters(true);
    fetch(`/api/textbooks/${textbookId}/chapters`)
      .then((r) => (r.ok ? r.json() : { chapters: [] }))
      .then((d) => {
        if (cancelled) return;
        const list: Chapter[] = d.chapters ?? [];
        setChapters(list);
        // Keep whatever is still in this book; fall back to the first one so
        // the form is never in an unsubmittable state.
        setChapterIds((cur) => {
          const kept = cur.filter((id) => list.some((c) => c.id === id));
          return kept.length > 0 ? kept : list[0] ? [list[0].id] : [];
        });
      })
      .catch(() => !cancelled && setChapters([]))
      .finally(() => !cancelled && setLoadingChapters(false));
    return () => {
      cancelled = true;
    };
  }, [textbookId]);

  const submit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      if (submitting) return;
      if (chapterIds.length === 0) {
        toast.error("Choose at least one chapter first.");
        return;
      }

      const isWorkout = paperType === "WORKOUT";
      const payload = {
        teachingAssignmentId: target.classId,
        kind,
        // Ordered as the teacher sees them; the server treats the first as
        // primary and validates every one.
        chapterIds,
        questionCount,
        questionTypes,
        ...(isWorkout
          ? { workout: true, maxMarks: maxMarks === "" ? null : Number(maxMarks) }
          : {}),
        difficulty: difficulty || undefined,
        dueAt: dueAt || null,
        source: source ?? "BANK",
        title: title.trim() || undefined,
        instructions: instructions.trim() || undefined,
        // Omitted for the whole class — the server then targets the full
        // roster rather than a client-supplied list.
        ...(audience === "struggling" && target.strugglingIds?.length
          ? { studentIds: target.strugglingIds }
          : {}),
      };

      function finish(data: {
        activity?: { id?: string; _count?: { targets?: number } };
        notice?: string;
        draft?: boolean;
      }) {
        const n = data.activity?._count?.targets ?? 0;
        // Nothing has reached a student yet — saying "Set for 30 students"
        // here would be a lie, and the whole point of the draft is that the
        // teacher reads it first.
        toast.success(
          `Draft ready for ${n} student${n === 1 ? "" : "s"}. Check it, then send.`,
        );
        // The server tells us when it could not honour the request exactly —
        // AI unavailable, a thin bank, or an answer key it could not separate.
        if (data.notice) toast.warning(data.notice, { duration: 10000 });
        onCreated?.();
        onClose();
        if (data.activity?.id) {
          router.push(`/secondary-teacher/activities/${data.activity.id}`);
        }
      }

      // Workout problems are always written by the model, so they stream
      // whether or not the teacher asked for AI questions.
      const streams = useAi || isWorkout;

      setSubmitting(true);
      setProgress(streams ? { message: "Starting...", percent: 5 } : null);
      try {
        // Drawing from the bank is quick, so it stays a plain request. Only
        // generation — which can take a minute — streams its progress.
        if (!streams) {
          const res = await fetch("/api/secondary-teacher/activities", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
          });
          const data = await res.json().catch(() => ({}));
          if (!res.ok) throw new Error(data.error ?? "Could not set that activity");
          finish(data);
          return;
        }

        const res = await fetch("/api/secondary-teacher/activities?stream=1", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        if (!res.ok || !res.body) {
          const data = await res.json().catch(() => ({}));
          throw new Error(data.error ?? "Could not set that activity");
        }

        const done = await consumeSse<{
          activity?: { _count?: { targets?: number } };
          notice?: string;
        }>(res, setProgress, "The connection ended before the activity was set.");
        finish(done);
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Something went wrong");
      } finally {
        setSubmitting(false);
        setProgress(null);
      }
    },
    [
      router,
      submitting,
      chapterIds,
      paperType,
      maxMarks,
      audience,
      target.classId,
      target.strugglingIds,
      kind,
      questionCount,
      difficulty,
      questionTypes,
      useAi,
      source,
      dueAt,
      title,
      instructions,
      onCreated,
      onClose,
    ],
  );

  const strugglingCount = target.strugglingIds?.length ?? 0;
  const recipientCount =
    audience === "struggling" ? strugglingCount : target.studentCount;

  const fieldClass =
    "w-full rounded-xl border border-border bg-background px-3 py-2.5 text-sm text-text-primary outline-none focus:border-primary";

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-0 sm:items-center sm:p-4">
      <div className="max-h-[92vh] w-full max-w-2xl overflow-y-auto rounded-t-3xl bg-surface p-5 shadow-xl sm:rounded-3xl sm:p-6">
        <div className="mb-4 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="text-lg font-bold text-text-primary">Set an activity</h2>
            <p className="text-xs text-text-secondary">
              {displaySubject(target.subject)} · Grade {target.grade}
              {target.section ? ` ${target.section}` : ""}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="shrink-0 rounded-lg p-1 text-text-muted transition hover:bg-border/50 hover:text-text-primary"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <form onSubmit={submit} className="space-y-4">
          {/* Who it goes to. Whole class is the default — homework,
              assignments and practice are for everyone; narrowing to the
              students who are behind is the exception, not the rule. */}
          <div className="space-y-1.5">
            <span className="text-xs font-semibold uppercase text-text-muted">
              Assign to
            </span>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => setAudience("class")}
                disabled={submitting}
                className={cn(
                  "rounded-xl border px-3 py-2 text-sm font-semibold transition",
                  audience === "class"
                    ? "border-primary bg-primary/10 text-primary"
                    : "border-border bg-background text-text-secondary hover:border-primary/40",
                )}
              >
                Whole class ({target.studentCount})
              </button>
              {strugglingCount > 0 && strugglingCount < target.studentCount && (
                <button
                  type="button"
                  onClick={() => setAudience("struggling")}
                  disabled={submitting}
                  className={cn(
                    "rounded-xl border px-3 py-2 text-sm font-semibold transition",
                    audience === "struggling"
                      ? "border-amber-500 bg-amber-50 text-amber-700"
                      : "border-border bg-background text-text-secondary hover:border-amber-400",
                  )}
                >
                  Needs help ({strugglingCount})
                </button>
              )}
            </div>
          </div>

          {/* Kind */}
          <div className="space-y-1.5">
            <span className="text-xs font-semibold uppercase text-text-muted">Type</span>
            <div className="flex flex-wrap gap-1.5">
              {KINDS.map((k) => (
                <button
                  key={k.value}
                  type="button"
                  onClick={() => setKind(k.value)}
                  disabled={submitting}
                  className={cn(
                    "rounded-full border px-3 py-1.5 text-xs font-semibold transition",
                    kind === k.value
                      ? "border-primary bg-primary/10 text-primary"
                      : "border-border bg-background text-text-secondary hover:border-primary/40",
                  )}
                >
                  {k.label}
                </button>
              ))}
            </div>
          </div>

          {/* Textbook + chapter */}
          <div className="space-y-1.5">
            <label
              htmlFor="act-textbook"
              className="text-xs font-semibold uppercase text-text-muted"
            >
              Textbook
            </label>
            {loadingBooks ? (
              <div className="py-2">
                <Spinner size="sm" className="text-primary" />
              </div>
            ) : textbooks.length === 0 ? (
              <p className="text-xs text-amber-600">
                No {displaySubject(target.subject)} textbook is available for grade {target.grade} yet.
                Ask your administrator to upload one.
              </p>
            ) : (
              <select
                id="act-textbook"
                value={textbookId}
                onChange={(e) => setTextbookId(e.target.value)}
                disabled={submitting}
                className={fieldClass}
              >
                {textbooks.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.title} (Grade {b.grade})
                  </option>
                ))}
              </select>
            )}
          </div>

          <div className="space-y-1.5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-xs font-semibold uppercase text-text-muted">
                Chapters
                {chapterIds.length > 1 ? ` · ${chapterIds.length} selected` : ""}
              </span>
              {chapters.length > 0 && (
                <button
                  type="button"
                  disabled={submitting}
                  onClick={() =>
                    setChapterIds((cur) =>
                      cur.length === chapters.length
                        ? chapters[0]
                          ? [chapters[0].id]
                          : []
                        : chapters.map((c) => c.id),
                    )
                  }
                  className="text-xs font-semibold text-primary hover:underline disabled:opacity-50"
                >
                  {chapterIds.length === chapters.length
                    ? "Clear"
                    : `All ${chapters.length} chapters`}
                </button>
              )}
            </div>

            {loadingChapters ? (
              <div className="py-2">
                <Spinner size="sm" className="text-primary" />
              </div>
            ) : chapters.length === 0 ? (
              <p className="rounded-xl border border-border px-3 py-2 text-sm text-text-muted">
                This textbook has no chapters yet.
              </p>
            ) : (
              <div className="max-h-44 space-y-0.5 overflow-y-auto rounded-xl border border-border p-1.5">
                {chapters.map((c) => {
                  const checked = chapterIds.includes(c.id);
                  return (
                    <label
                      key={c.id}
                      className={cn(
                        "flex cursor-pointer items-start gap-2 rounded-lg px-2 py-1.5 text-sm transition-colors",
                        checked ? "bg-primary/10 text-text-primary" : "hover:bg-border/40",
                      )}
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        disabled={submitting}
                        onChange={() =>
                          setChapterIds((cur) =>
                            cur.includes(c.id)
                              ? cur.filter((id) => id !== c.id)
                              : // Kept in the textbook's own order, so the
                                // paper reads front-to-back rather than in
                                // the order the teacher happened to tick.
                                chapters
                                  .filter((ch) => ch.id === c.id || cur.includes(ch.id))
                                  .map((ch) => ch.id),
                          )
                        }
                        className="mt-0.5 h-4 w-4 shrink-0 accent-[var(--color-primary)]"
                      />
                      <span className="min-w-0">
                        {c.chapterNumber}. {displayChapterTitle(c.title)}
                      </span>
                    </label>
                  );
                })}
              </div>
            )}
            {chapterIds.length > 1 && (
              <p className="text-[11px] text-text-muted">
                Questions are spread evenly across the chapters you picked.
              </p>
            )}
          </div>

          {/* Count + difficulty */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <label
                htmlFor="act-count"
                className="text-xs font-semibold uppercase text-text-muted"
              >
                {paperType === "WORKOUT" ? "Problems" : "Questions"}
              </label>
              <select
                id="act-count"
                value={questionCount}
                onChange={(e) => setQuestionCount(Number(e.target.value))}
                disabled={submitting}
                className={fieldClass}
              >
                {COUNTS.map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1.5">
              <label
                htmlFor="act-difficulty"
                className="text-xs font-semibold uppercase text-text-muted"
              >
                Difficulty
              </label>
              <select
                id="act-difficulty"
                value={difficulty}
                onChange={(e) => setDifficulty(e.target.value)}
                disabled={submitting}
                className={fieldClass}
              >
                {DIFFICULTIES.map((d) => (
                  <option key={d.value} value={d.value}>
                    {d.label}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* ── Paper type ──────────────────────────────────────────── */}
          <div className="space-y-1.5">
            <span className="text-xs font-semibold uppercase text-text-muted">
              Paper type
            </span>
            <div className="grid gap-2 sm:grid-cols-2">
              {(
                [
                  {
                    value: "QUESTIONS" as const,
                    label: "Question paper",
                    hint: "Marked automatically as they answer",
                  },
                  {
                    value: "WORKOUT" as const,
                    label: "Workout problems",
                    hint: "Calculations worked on paper — you mark them",
                  },
                ]
              ).map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  disabled={submitting}
                  onClick={() => setPaperType(opt.value)}
                  className={cn(
                    "rounded-xl border p-2.5 text-left transition",
                    paperType === opt.value
                      ? "border-primary bg-primary/10"
                      : "border-border hover:border-primary/40",
                  )}
                >
                  <span
                    className={cn(
                      "block text-sm font-semibold",
                      paperType === opt.value ? "text-primary" : "text-text-primary",
                    )}
                  >
                    {opt.label}
                  </span>
                  <span className="block text-[11px] text-text-muted">{opt.hint}</span>
                </button>
              ))}
            </div>
          </div>

          {/* Marks — workout problems are always handed in and marked. */}
          {paperType === "WORKOUT" && (
            <div className="space-y-1.5">
              <label
                htmlFor="act-marks"
                className="text-xs font-semibold uppercase text-text-muted"
              >
                Marked out of (optional)
              </label>
              <input
                id="act-marks"
                type="number"
                min={1}
                max={1000}
                value={maxMarks}
                disabled={submitting}
                onChange={(e) =>
                  setMaxMarks(e.target.value === "" ? "" : Number(e.target.value))
                }
                placeholder="e.g. 20"
                className={fieldClass}
              />
              <p className="text-xs text-text-muted">
                Students hand in their working — typed or photographed — and you
                mark it. Leave blank to give written feedback without a score.
              </p>
            </div>
          )}

          {/* Question types — only a question paper has them. */}
          {paperType === "QUESTIONS" && (
          <div className="space-y-1.5">
            <span className="text-xs font-semibold uppercase text-text-muted">
              Question types
            </span>
            <div className="flex flex-wrap gap-1.5">
              {QUESTION_TYPES.map((t) => {
                const on = questionTypes.includes(t.value);
                return (
                  <button
                    key={t.value}
                    type="button"
                    disabled={submitting}
                    onClick={() =>
                      setQuestionTypes((prev) => {
                        const next = on
                          ? prev.filter((v) => v !== t.value)
                          : [...prev, t.value];
                        // Never leave the paper with no type at all.
                        return next.length > 0 ? next : prev;
                      })
                    }
                    className={cn(
                      "rounded-full border px-3 py-1.5 text-xs font-semibold transition",
                      on
                        ? "border-primary bg-primary/10 text-primary"
                        : "border-border bg-background text-text-secondary hover:border-primary/40",
                    )}
                  >
                    {t.label}
                  </button>
                );
              })}
            </div>
            <p className="text-xs text-text-muted">
              Pick one or more. The paper is drawn from these types only.
            </p>
          </div>
          )}

          {/* Where the questions come from. Workout problems are always
              written fresh, so there is no choice to offer. */}
          {paperType === "QUESTIONS" ? (
            <div className="space-y-1.5">
              <span className="text-xs font-semibold uppercase text-text-muted">
                Questions from
              </span>
              <div className="grid gap-2 sm:grid-cols-2">
                {(
                  [
                    {
                      value: "BANK" as const,
                      label: "Question bank",
                      hint: "Questions already stored for these chapters. Instant; a thin bank gives a shorter paper.",
                    },
                    {
                      value: "AI" as const,
                      label: "Brand-new questions (AI)",
                      hint: "A fresh set written from the chapters, with every quality check. About a minute.",
                    },
                  ]
                ).map((opt) => (
                  <button
                    key={opt.value}
                    type="button"
                    disabled={submitting}
                    onClick={() => setSource(opt.value)}
                    aria-pressed={source === opt.value}
                    className={cn(
                      "rounded-xl border p-2.5 text-left transition",
                      source === opt.value
                        ? "border-primary bg-primary/10"
                        : "border-border hover:border-primary/40",
                    )}
                  >
                    <span
                      className={cn(
                        "block text-sm font-semibold",
                        source === opt.value ? "text-primary" : "text-text-primary",
                      )}
                    >
                      {opt.label}
                    </span>
                    <span className="block text-[11px] text-text-muted">{opt.hint}</span>
                  </button>
                ))}
              </div>
              {source === null && (
                <p className="text-xs text-text-muted">Choose one to continue.</p>
              )}
            </div>
          ) : (
            <p className="rounded-xl border border-border bg-border/20 p-3 text-xs text-text-muted">
              Workout problems are written fresh by AI from the chapters you picked,
              with a full worked answer key for you.
            </p>
          )}

          {/* Due date */}
          <div className="space-y-1.5">
            <label
              htmlFor="act-due"
              className="text-xs font-semibold uppercase text-text-muted"
            >
              Due date (optional)
            </label>
            <Input
              id="act-due"
              type="date"
              value={dueAt}
              onChange={(e) => setDueAt(e.target.value)}
              disabled={submitting}
            />
            <p className="text-xs text-text-muted">
              A reminder, not a lock — students can still submit afterwards.
            </p>
          </div>

          {/* Optional title + instructions */}
          <details className="rounded-xl border border-border p-3">
            <summary className="cursor-pointer text-xs font-semibold uppercase text-text-muted">
              Title and instructions
            </summary>
            <div className="mt-3 space-y-3">
              <Input
                placeholder="Title (defaults to the chapter name)"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                disabled={submitting}
                maxLength={120}
              />
              <textarea
                placeholder="Instructions for your students (optional)"
                value={instructions}
                onChange={(e) => setInstructions(e.target.value)}
                disabled={submitting}
                maxLength={2000}
                rows={3}
                className={fieldClass}
              />
            </div>
          </details>

          {progress && <GenerationProgressCard progress={progress} />}

          <div className="sticky -bottom-5 -mx-5 flex gap-2 border-t border-border bg-surface px-5 py-3 sm:-bottom-6 sm:-mx-6 sm:px-6">
            <Button
              type="submit"
              className="flex-1"
              disabled={
                submitting ||
                chapterIds.length === 0 ||
                textbooks.length === 0 ||
                (paperType === "QUESTIONS" && source === null)
              }
            >
              {submitting ? (
                <Spinner size="sm" />
              ) : (
                `Set for ${recipientCount} student${recipientCount === 1 ? "" : "s"}`
              )}
            </Button>
            <Button type="button" variant="outline" onClick={onClose} disabled={submitting}>
              Cancel
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
