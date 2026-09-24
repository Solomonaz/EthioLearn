"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  BookOpen,
  Check,
  ChevronLeft,
  ChevronRight,
  ClipboardList,
  Library,
  LifeBuoy,
  ListChecks,
  PenLine,
  Send,
  Sparkles,
  Users,
  X,
} from "lucide-react";
import { OptionCard, ReviewRow, Segmented } from "./form-pieces";
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
    "w-full rounded-xl border border-border bg-background px-3 py-2.5 text-sm text-text-primary outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/15";

  // ── Steps ──────────────────────────────────────────────────────────────
  // One question at a time instead of every field at once: the single
  // scrolling form (and then two side-by-side scrolling panels) buried the
  // chapter list and made twelve decisions look like one wall.
  const STEPS = [
    { title: "Cover", heading: "What should it cover?", icon: BookOpen },
    { title: "Paper", heading: "What kind of paper?", icon: ListChecks },
    { title: "Send", heading: "Who gets it, and when?", icon: Send },
  ] as const;
  const [step, setStep] = useState(0);

  /** Why a step can't be left yet — null when it can. */
  function blockerFor(i: number): string | null {
    if (i === 0) {
      if (loadingBooks || loadingChapters) return "Loading the textbook…";
      if (textbooks.length === 0) return "No textbook is available for this class yet.";
      if (chapterIds.length === 0) return "Pick at least one chapter.";
    }
    if (i === 1 && paperType === "QUESTIONS" && source === null) {
      return "Choose where the questions come from.";
    }
    return null;
  }
  const blocker = blockerFor(step);
  const canReach = (i: number) =>
    Array.from({ length: i }, (_, k) => blockerFor(k)).every((b) => b === null);

  const selectedChapters = chapters.filter((c) => chapterIds.includes(c.id));
  const difficultyLabel = DIFFICULTIES.find((d) => d.value === difficulty)?.label ?? "Mixed";
  const kindLabel = KINDS.find((k) => k.value === kind)?.label ?? "Homework";

  const onFormSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    // Enter in a field moves forward; only the last step creates anything.
    if (step < STEPS.length - 1) {
      if (!blocker) setStep(step + 1);
      return;
    }
    void submit(e);
  };

  const label = "text-xs font-semibold uppercase tracking-wide text-text-muted";

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 backdrop-blur-[2px] sm:items-center sm:p-6">
      <form
        onSubmit={onFormSubmit}
        className="flex h-[94vh] w-full max-w-3xl flex-col overflow-hidden rounded-t-[28px] bg-surface shadow-2xl sm:h-[min(46rem,92vh)] sm:rounded-[28px]"
      >
        {/* ── Header ─────────────────────────────────────────────────────── */}
        <div className="relative shrink-0 bg-gradient-to-br from-primary/15 via-primary/5 to-transparent px-5 pb-4 pt-5 sm:px-8 sm:pt-6">
          <div className="flex items-start justify-between gap-3">
            <div className="flex min-w-0 items-center gap-3">
              <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-primary text-white shadow-sm">
                <ClipboardList className="h-5 w-5" />
              </span>
              <div className="min-w-0">
                <h2 className="text-lg font-bold text-text-primary sm:text-xl">Set an activity</h2>
                <p className="truncate text-sm text-text-secondary">
                  {displaySubject(target.subject)} · Grade {target.grade}
                  {target.section ? ` ${target.section}` : ""} · {target.studentCount} student
                  {target.studentCount === 1 ? "" : "s"}
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close"
              className="shrink-0 rounded-xl p-2 text-text-muted transition hover:bg-surface/80 hover:text-text-primary"
            >
              <X className="h-5 w-5" />
            </button>
          </div>

          {/* Stepper — completed steps can be revisited; a later step opens
              only once everything before it is complete. */}
          <ol className="mt-5 flex items-center">
            {STEPS.map((s, i) => {
              const done = i < step;
              const current = i === step;
              const reachable = !submitting && canReach(i);
              return (
                <li key={s.title} className={cn("flex items-center", i < STEPS.length - 1 && "flex-1")}>
                  <button
                    type="button"
                    disabled={!reachable}
                    onClick={() => setStep(i)}
                    aria-current={current ? "step" : undefined}
                    className="group flex items-center gap-2 disabled:cursor-not-allowed"
                  >
                    <span
                      className={cn(
                        "flex h-8 w-8 items-center justify-center rounded-full text-sm font-bold transition",
                        current && "bg-primary text-white shadow-md ring-4 ring-primary/15",
                        done && "bg-primary/15 text-primary",
                        !current && !done && "border border-border bg-surface text-text-muted",
                      )}
                    >
                      {done ? <Check className="h-4 w-4" /> : i + 1}
                    </span>
                    <span
                      className={cn(
                        "hidden text-sm font-semibold sm:inline",
                        current ? "text-text-primary" : "text-text-muted group-enabled:group-hover:text-text-primary",
                      )}
                    >
                      {s.title}
                    </span>
                  </button>
                  {i < STEPS.length - 1 && (
                    <span
                      className={cn(
                        "mx-3 h-0.5 flex-1 rounded-full transition-colors",
                        i < step ? "bg-primary/40" : "bg-border",
                      )}
                    />
                  )}
                </li>
              );
            })}
          </ol>
        </div>

        {/* ── Body ───────────────────────────────────────────────────────── */}
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5 sm:px-8 sm:py-6">
          {submitting ? (
            <div className="flex h-full flex-col items-center justify-center gap-5 text-center">
              <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-primary/10 text-primary">
                {useAi || paperType === "WORKOUT" ? (
                  <Sparkles className="h-7 w-7" />
                ) : (
                  <ClipboardList className="h-7 w-7" />
                )}
              </span>
              <div>
                <p className="text-lg font-bold text-text-primary">Building your {kindLabel.toLowerCase()}…</p>
                <p className="text-sm text-text-secondary">
                  {useAi || paperType === "WORKOUT"
                    ? "Writing and checking every item. This takes about a minute."
                    : "Drawing questions from the bank."}
                </p>
              </div>
              {progress ? (
                <div className="w-full max-w-md text-left">
                  <GenerationProgressCard progress={progress} />
                </div>
              ) : (
                // Drawing from the bank reports no stages — one spinner here
                // is the only activity indicator on screen.
                <Spinner size="lg" className="text-primary" />
              )}
            </div>
          ) : (
            <>
              <h3 className="mb-5 text-lg font-bold text-text-primary">{STEPS[step].heading}</h3>

              {/* ── Step 1: chapters ─────────────────────────────────── */}
              {step === 0 && (
                <div className="space-y-5">
                  <div className="flex flex-wrap items-end justify-between gap-3">
                    <div className="min-w-[14rem] flex-1 space-y-1.5">
                      <label htmlFor="act-textbook" className={label}>
                        Textbook
                      </label>
                      {loadingBooks ? (
                        <div className="py-2">
                          <Spinner size="sm" className="text-primary" />
                        </div>
                      ) : textbooks.length === 0 ? (
                        <p className="rounded-xl bg-amber-50 px-3 py-2 text-sm text-amber-700">
                          No {displaySubject(target.subject)} textbook is available for grade{" "}
                          {target.grade} yet. Ask your administrator to upload one.
                        </p>
                      ) : (
                        <select
                          id="act-textbook"
                          value={textbookId}
                          onChange={(e) => setTextbookId(e.target.value)}
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
                    {chapters.length > 1 && (
                      <button
                        type="button"
                        onClick={() =>
                          setChapterIds((cur) =>
                            cur.length === chapters.length
                              ? [chapters[0].id]
                              : chapters.map((c) => c.id),
                          )
                        }
                        className="rounded-xl px-3 py-2.5 text-sm font-semibold text-primary transition hover:bg-primary/10"
                      >
                        {chapterIds.length === chapters.length ? "Clear selection" : `Select all ${chapters.length}`}
                      </button>
                    )}
                  </div>

                  {loadingChapters ? (
                    <div className="flex justify-center py-10">
                      <Spinner size="lg" className="text-primary" />
                    </div>
                  ) : chapters.length === 0 ? (
                    textbooks.length > 0 && (
                      <p className="rounded-2xl border border-dashed border-border px-4 py-8 text-center text-sm text-text-muted">
                        This textbook has no chapters yet.
                      </p>
                    )
                  ) : (
                    // A plain checkbox list, as it was — the step has the room,
                    // so every chapter shows without an inner scroll box.
                    <div className="space-y-0.5 rounded-xl border border-border p-1.5">
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
                    <p className="text-xs text-text-muted">
                      {chapterIds.length} chapters · questions are spread evenly across them.
                    </p>
                  )}
                </div>
              )}

              {/* ── Step 2: the paper ────────────────────────────────── */}
              {step === 1 && (
                <div className="space-y-6">
                  <div className="grid gap-3 sm:grid-cols-2">
                    {(
                      [
                        {
                          value: "QUESTIONS" as const,
                          icon: ListChecks,
                          label: "Question paper",
                          hint: "Students answer on screen and it marks itself.",
                        },
                        {
                          value: "WORKOUT" as const,
                          icon: PenLine,
                          label: "Workout problems",
                          hint: "Calculations worked on paper — you mark them.",
                        },
                      ]
                    ).map((opt) => (
                      <OptionCard
                        key={opt.value}
                        selected={paperType === opt.value}
                        onSelect={() => setPaperType(opt.value)}
                        icon={opt.icon}
                        label={opt.label}
                        hint={opt.hint}
                      />
                    ))}
                  </div>

                  <div className="grid gap-5 sm:grid-cols-2">
                    <div className="space-y-2">
                      <span className={label}>
                        How many {paperType === "WORKOUT" ? "problems" : "questions"}
                      </span>
                      <Segmented
                        options={COUNTS.map((n) => ({ value: String(n), label: String(n) }))}
                        value={String(questionCount)}
                        onChange={(v) => setQuestionCount(Number(v))}
                      />
                    </div>
                    <div className="space-y-2">
                      <span className={label}>Difficulty</span>
                      <Segmented
                        options={DIFFICULTIES.map((d) => ({ value: d.value, label: d.label, dot: DIFFICULTY_DOT[d.value] }))}
                        value={difficulty}
                        onChange={setDifficulty}
                      />
                    </div>
                  </div>

                  {paperType === "QUESTIONS" ? (
                    <>
                      <div className="space-y-2">
                        <span className={label}>Question types</span>
                        <div className="flex flex-wrap gap-2">
                          {QUESTION_TYPES.map((t) => {
                            const on = questionTypes.includes(t.value);
                            return (
                              <button
                                key={t.value}
                                type="button"
                                aria-pressed={on}
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
                                  "inline-flex items-center gap-1.5 rounded-full border px-3.5 py-1.5 text-sm font-semibold transition",
                                  on
                                    ? "border-primary bg-primary text-white"
                                    : "border-border bg-background text-text-secondary hover:border-primary/40",
                                )}
                              >
                                {on && <Check className="h-3.5 w-3.5" />}
                                {t.label}
                              </button>
                            );
                          })}
                        </div>
                      </div>

                      {/* No default: the two differ in cost and freshness, so
                          the teacher always makes this call. */}
                      <div className="space-y-2">
                        <span className={label}>Questions from</span>
                        <div className="grid gap-3 sm:grid-cols-2">
                          <OptionCard
                            selected={source === "BANK"}
                            prompting={source === null}
                            onSelect={() => setSource("BANK")}
                            icon={Library}
                            label="Question bank"
                            hint="Questions already stored for these chapters. Instant — a thin bank gives a shorter paper."
                            tag="Instant"
                          />
                          <OptionCard
                            selected={source === "AI"}
                            prompting={source === null}
                            onSelect={() => setSource("AI")}
                            icon={Sparkles}
                            label="Brand-new questions"
                            hint="A fresh set written from the chapters, with every quality check."
                            tag="AI · ~1 min"
                          />
                        </div>
                      </div>
                    </>
                  ) : (
                    <div className="space-y-2">
                      <label htmlFor="act-marks" className={label}>
                        Marked out of (optional)
                      </label>
                      <input
                        id="act-marks"
                        type="number"
                        min={1}
                        max={1000}
                        value={maxMarks}
                        onChange={(e) => setMaxMarks(e.target.value === "" ? "" : Number(e.target.value))}
                        placeholder="e.g. 20"
                        className={cn(fieldClass, "max-w-[12rem]")}
                      />
                      <p className="flex items-start gap-2 rounded-2xl bg-primary/[0.06] p-3 text-sm text-text-secondary">
                        <Sparkles className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                        Written fresh by AI from your chapters, with a full worked answer key
                        that only you see. Students hand in their working and you mark it.
                      </p>
                    </div>
                  )}
                </div>
              )}

              {/* ── Step 3: who, when, review ─────────────────────────── */}
              {step === 2 && (
                <div className="space-y-6">
                  {/* Whole class is the default — narrowing to the students who
                      are behind is the exception, not the rule. */}
                  {strugglingCount > 0 && strugglingCount < target.studentCount && (
                    <div className="grid gap-3 sm:grid-cols-2">
                      <OptionCard
                        selected={audience === "class"}
                        onSelect={() => setAudience("class")}
                        icon={Users}
                        label={`Whole class · ${target.studentCount}`}
                        hint="Everyone in this class."
                      />
                      <OptionCard
                        selected={audience === "struggling"}
                        onSelect={() => setAudience("struggling")}
                        icon={LifeBuoy}
                        label={`Needs help · ${strugglingCount}`}
                        hint="Only the students who are behind."
                        tone="amber"
                      />
                    </div>
                  )}

                  <div className="space-y-2">
                    <span className={label}>It's a</span>
                    <Segmented
                      options={KINDS.map((k) => ({ value: k.value, label: k.label }))}
                      value={kind}
                      onChange={setKind}
                    />
                  </div>

                  <div className="grid gap-4 sm:grid-cols-2">
                    <div className="space-y-1.5">
                      <label htmlFor="act-due" className={label}>
                        Due date <span className="normal-case tracking-normal">(optional)</span>
                      </label>
                      <Input id="act-due" type="date" value={dueAt} onChange={(e) => setDueAt(e.target.value)} />
                      <p className="text-xs text-text-muted">A reminder, not a lock.</p>
                    </div>
                    <div className="space-y-1.5">
                      <label htmlFor="act-title" className={label}>
                        Title <span className="normal-case tracking-normal">(optional)</span>
                      </label>
                      <Input
                        id="act-title"
                        placeholder={
                          selectedChapters.length === 1
                            ? displayChapterTitle(selectedChapters[0].title)
                            : "Named after the chapters"
                        }
                        value={title}
                        onChange={(e) => setTitle(e.target.value)}
                        maxLength={120}
                      />
                    </div>
                  </div>

                  <div className="space-y-1.5">
                    <label htmlFor="act-instructions" className={label}>
                      Instructions for students <span className="normal-case tracking-normal">(optional)</span>
                    </label>
                    <textarea
                      id="act-instructions"
                      placeholder="e.g. Show all working. Bring your answers to Thursday's lesson."
                      value={instructions}
                      onChange={(e) => setInstructions(e.target.value)}
                      maxLength={2000}
                      rows={2}
                      className={fieldClass}
                    />
                  </div>

                  {/* Review — what the teacher is about to create, read back. */}
                  <div className="rounded-2xl border border-border bg-border/15 p-4">
                    <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-text-muted">Review</p>
                    <dl className="grid gap-x-6 gap-y-3 text-sm sm:grid-cols-2">
                      <ReviewRow icon={BookOpen} label="Covers" onEdit={() => setStep(0)}>
                        {selectedChapters.length === 1
                          ? displayChapterTitle(selectedChapters[0].title)
                          : `${selectedChapters.length} chapters`}
                      </ReviewRow>
                      <ReviewRow icon={ListChecks} label="Paper" onEdit={() => setStep(1)}>
                        {questionCount} {paperType === "WORKOUT" ? "workout problems" : "questions"} · {difficultyLabel}
                      </ReviewRow>
                      <ReviewRow icon={paperType === "WORKOUT" || useAi ? Sparkles : Library} label="Source" onEdit={() => setStep(1)}>
                        {paperType === "WORKOUT" ? "Written by AI" : useAi ? "Brand-new (AI)" : "Question bank"}
                      </ReviewRow>
                      <ReviewRow icon={Users} label="Goes to">
                        {audience === "struggling"
                          ? `${recipientCount} who need help`
                          : `Whole class · ${recipientCount}`}
                      </ReviewRow>
                    </dl>
                  </div>
                </div>
              )}
            </>
          )}
        </div>

        {/* ── Footer ─────────────────────────────────────────────────────── */}
        <div className="flex shrink-0 items-center justify-between gap-3 border-t border-border px-5 py-4 sm:px-8">
          <p className={cn("min-w-0 text-sm", blocker ? "text-amber-700" : "text-text-muted")}>
            {submitting
              ? "Please keep this window open."
              : blocker ??
                (step === STEPS.length - 1
                  ? "Saved as a draft — you check it before students see it."
                  : `Step ${step + 1} of ${STEPS.length}`)}
          </p>
          <div className="flex shrink-0 gap-2">
            {step > 0 && !submitting && (
              <Button type="button" variant="outline" onClick={() => setStep(step - 1)}>
                <ChevronLeft className="mr-1 h-4 w-4" /> Back
              </Button>
            )}
            {/* No button while it is being built: the body already shows the
                progress, and a second spinner in the footer said the same
                thing again. */}
            {submitting ? null : step < STEPS.length - 1 ? (
              <Button type="submit" disabled={blocker !== null}>
                Next <ChevronRight className="ml-1 h-4 w-4" />
              </Button>
            ) : (
              <Button type="submit" disabled={blocker !== null} className="min-w-[11rem]">
                <Check className="mr-1.5 h-4 w-4" />
                Create draft for {recipientCount}
              </Button>
            )}
          </div>
        </div>
      </form>
    </div>
  );
}

// ── Small pieces ─────────────────────────────────────────────────────────

const DIFFICULTY_DOT: Record<string, string> = {
  "": "bg-gradient-to-r from-green-500 via-amber-500 to-red-500",
  EASY: "bg-green-500",
  MEDIUM: "bg-amber-500",
  HARD: "bg-red-500",
};
