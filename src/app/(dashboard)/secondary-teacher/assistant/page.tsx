"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ChevronDown, Info, Merge, RotateCcw, Sparkles, Wand2 } from "lucide-react";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  GenerationProgressCard,
  type GenerationProgressState,
  type ProgressStage,
} from "@/components/ui/generation-progress";
import { consumeSse } from "@/lib/sse-client";
import { getStudyScope } from "@/lib/grade-scope";
import { toast } from "@/components/ui/sonner";
import { cn } from "@/lib/utils";
import { ASSISTANT_TASKS, type AssistantTask } from "@/lib/assistant-tasks";
import { ResourceActions } from "@/components/secondary-teacher/resource-actions";
import { TeacherDocument } from "@/components/secondary-teacher/teacher-document";
import { MergeMaterialsDialog } from "@/components/secondary-teacher/merge-materials-dialog";
import { displayChapterTitle, displaySubject } from "@/lib/display-text";

/** Same cap as the server. More thins each chapter's share of the grounding. */
const MAX_CHAPTERS = 6;

/**
 * The stages the assistant route really reports, at the percentages it sends.
 * "Read chapter" only exists when a chapter was picked — showing it for a
 * request with no chapter described a step that never happened.
 */
const STAGES_WITH_CHAPTER: ProgressStage[] = [
  { at: 8, label: "1. Read chapter" },
  { at: 25, label: "2. Write" },
  { at: 88, label: "3. Format" },
];
const STAGES_NO_CHAPTER: ProgressStage[] = [
  { at: 25, label: "1. Write" },
  { at: 88, label: "2. Format" },
];

/**
 * AI teaching assistant.
 *
 * A teacher picks what they want, optionally grounds it in a chapter of a
 * textbook their class studies, and gets something they can take into a
 * classroom — then refines it with plain requests ("shorter", "add three
 * harder items") instead of starting over.
 */

interface ClassOption {
  id: string;
  subject: string;
  grade: number;
  section: string | null;
}

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

/**
 * The last result, with the context it was written for. `task` travels with
 * it: saving used to read the CURRENT task chip, so switching chips after
 * generating filed a worksheet as a lesson plan.
 */
interface AssistantResult {
  title: string;
  markdown: string;
  /** The stored copy — every result is saved to the library automatically. */
  resourceId: string | null;
  task: AssistantTask;
  subject: string | null;
  grade: number | null;
  chapterTitle: string | null;
}

/**
 * The page opens empty: every result is already kept in Materials, and
 * restoring the last one made an old document greet the teacher on every
 * visit. Clear what earlier versions of the page left behind.
 */
function clearRememberedResult() {
  try {
    sessionStorage.removeItem("ta:last-result");
  } catch {
    /* private mode — nothing was stored */
  }
}

export default function TeachingAssistantPage() {
  const [classes, setClasses] = useState<ClassOption[]>([]);
  const [classId, setClassId] = useState("");
  const [textbooks, setTextbooks] = useState<Textbook[]>([]);
  const [textbookId, setTextbookId] = useState("");
  const [chapters, setChapters] = useState<Chapter[]>([]);
  /** In textbook order. Empty means "No chapter (general)". */
  const [chapterIds, setChapterIds] = useState<string[]>([]);
  const [merging, setMerging] = useState(false);

  const [task, setTask] = useState<AssistantTask>("LESSON_PLAN");
  const [prompt, setPrompt] = useState("");
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<GenerationProgressState | null>(null);
  const [result, setResult] = useState<AssistantResult | null>(null);
  const [revision, setRevision] = useState("");

  const [allowance, setAllowance] = useState<AiAllowance | null>(null);

  const selectedClass = classes.find((c) => c.id === classId) ?? null;

  useEffect(() => {
    clearRememberedResult();
  }, []);

  // What the school's plan leaves this month. Re-read after each generation.
  const refreshAllowance = useCallback(() => {
    fetch("/api/secondary-teacher/me")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => setAllowance(d?.ai ?? null))
      .catch(() => setAllowance(null));
  }, []);
  useEffect(refreshAllowance, [refreshAllowance]);

  // The teacher's own classes — names only, so the lite form of the route.
  useEffect(() => {
    fetch("/api/secondary-teacher/classes?lite=1")
      .then((r) => (r.ok ? r.json() : { classes: [] }))
      .then((d) => {
        const list: ClassOption[] = (d.classes ?? []).map(
          (c: { id: string; subject: string; grade: number; section: string | null }) => ({
            id: c.id,
            subject: c.subject,
            grade: c.grade,
            section: c.section,
          }),
        );
        setClasses(list);
      })
      .catch(() => setClasses([]));
  }, []);

  // Textbooks for the chosen class.
  useEffect(() => {
    if (!selectedClass) {
      setTextbooks([]);
      setTextbookId("");
      return;
    }
    let cancelled = false;
    fetch(
      `/api/textbooks?subject=${encodeURIComponent(selectedClass.subject)}` +
        // The whole cycle, not just this grade: a grade 12 class may
        // legitimately be grounded in grade 11 revision.
        `&grade=${getStudyScope(selectedClass.grade).join(",")}`,
    )
      .then((r) => (r.ok ? r.json() : { textbooks: [] }))
      .then((d) => {
        if (cancelled) return;
        const books: Textbook[] = d.textbooks ?? [];
        setTextbooks(books);
        setTextbookId(books[0]?.id ?? "");
      })
      .catch(() => !cancelled && setTextbooks([]));
    return () => {
      cancelled = true;
    };
  }, [selectedClass]);

  // Chapters for the chosen textbook.
  useEffect(() => {
    if (!textbookId) {
      setChapters([]);
      setChapterIds([]);
      return;
    }
    let cancelled = false;
    fetch(`/api/textbooks/${textbookId}/chapters`)
      .then((r) => (r.ok ? r.json() : { chapters: [] }))
      .then((d) => {
        if (cancelled) return;
        const list: Chapter[] = d.chapters ?? [];
        setChapters(list);
        setChapterIds(list[0] ? [list[0].id] : []);
      })
      .catch(() => !cancelled && setChapters([]));
    return () => {
      cancelled = true;
    };
  }, [textbookId]);

  const run = useCallback(
    async (revise: { previous: string; instruction: string } | null) => {
      if (busy) return;
      // Something to write about: a chapter or a described topic. A lesson
      // plan with neither has no subject matter at all.
      if (!revise && chapterIds.length === 0 && prompt.trim().length < 3) {
        toast.error(
          task === "FREEFORM"
            ? "Describe what you need."
            : "Pick a chapter, or describe the topic in your instructions.",
        );
        return;
      }

      setBusy(true);
      setProgress({ message: "Starting...", percent: 5 });
      try {
        const res = await fetch("/api/secondary-teacher/assistant?stream=1", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            task: revise ? result?.task ?? task : task,
            prompt: prompt.trim(),
            chapterIds: revise ? [] : chapterIds,
            // Files the result under this class's subject and grade when no
            // chapter says so — what the bank matches requests on.
            teachingAssignmentId: classId || null,
            revise,
            resourceId: revise ? result?.resourceId ?? null : null,
          }),
        });
        // A rejection (rate limit, validation, AI switched off) still comes
        // back as plain JSON, before the stream ever starts.
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          throw new Error(data.error ?? "The AI could not respond");
        }

        const data = await consumeSse<{ title: string; markdown: string; resourceId?: string | null }>(
          res,
          setProgress,
          "The connection ended before the document was finished.",
        );
        const next: AssistantResult = revise && result
          ? { ...result, title: data.title, markdown: data.markdown, resourceId: data.resourceId ?? result.resourceId }
          : {
              title: data.title,
              markdown: data.markdown,
              resourceId: data.resourceId ?? null,
              task,
              subject: selectedClass?.subject ?? null,
              grade: selectedClass?.grade ?? null,
              chapterTitle:
                chapters
                  .filter((c) => chapterIds.includes(c.id))
                  .map((c) => c.title)
                  .join("; ") || null,
            };
        setResult(next);
        if (revise) setRevision("");
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Something went wrong");
      } finally {
        setBusy(false);
        setProgress(null);
        refreshAllowance();
      }
    },
    [busy, task, prompt, chapterIds, classId, chapters, selectedClass, result, refreshAllowance],
  );

  /** A merge lands where a fresh result would, so it can be revised the same way. */
  const onMerged = useCallback(
    (m: {
      title: string;
      markdown: string;
      resourceId: string | null;
      task: string;
      subject: string | null;
      grade: number | null;
      chapterTitle: string | null;
    }) => {
      const next: AssistantResult = {
        ...m,
        task: ASSISTANT_TASKS.some((t) => t.value === m.task) ? (m.task as AssistantTask) : "FREEFORM",
      };
      setResult(next);
      refreshAllowance();
    },
    [refreshAllowance],
  );

  const submit = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();
      void run(null);
    },
    [run],
  );

  const revise = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();
      if (!result || revision.trim().length < 3) {
        toast.error("Describe the change you want.");
        return;
      }
      void run({ previous: result.markdown, instruction: revision.trim() });
    },
    [result, revision, run],
  );

  const fieldClass =
    "w-full rounded-xl border border-border bg-background px-3 py-2.5 text-sm text-text-primary outline-none focus:border-primary";

  const activeTask = ASSISTANT_TASKS.find((t) => t.value === task);

  // The same rule the server enforces: "Anything else" needs a description;
  // every other task needs a chapter or a described topic.
  const hasTopic =
    task === "FREEFORM" ? prompt.trim().length >= 3 : chapterIds.length > 0 || prompt.trim().length >= 3;

  return (
    <div className="mx-auto max-w-4xl space-y-5">
      <div className="print-hide">
        <h1 className="flex items-center gap-2 text-2xl font-bold text-text-primary">
          <Sparkles className="h-6 w-6 text-primary" /> Teaching assistant
        </h1>
        <p className="text-sm text-text-secondary">
          Lesson plans, worksheets, board notes, exam blueprints — or just describe
          what you need.
        </p>
        <AllowanceNote allowance={allowance} />
      </div>

      <Card className="print-hide">
        <CardContent>
          <form onSubmit={submit} className="space-y-4">
            {/* What */}
            <div className="space-y-1.5">
              <span className="text-xs font-semibold uppercase text-text-muted">
                What do you need?
              </span>
              <div className="flex flex-wrap gap-2">
                {ASSISTANT_TASKS.map((t) => (
                  <button
                    key={t.value}
                    type="button"
                    onClick={() => setTask(t.value)}
                    disabled={busy}
                    aria-pressed={task === t.value}
                    className={cn(
                      "rounded-full border px-3 py-1.5 text-sm font-semibold transition",
                      task === t.value
                        ? "border-primary bg-primary/10 text-primary"
                        : "border-border bg-background text-text-secondary hover:border-primary/40",
                    )}
                  >
                    {t.label}
                  </button>
                ))}
              </div>
              {activeTask && (
                <p className="text-xs text-text-muted">{activeTask.hint}</p>
              )}
            </div>

            {/* Optional grounding */}
            <div className="grid gap-3 sm:grid-cols-3">
              <div className="space-y-1.5">
                <label
                  htmlFor="ta-class"
                  className="text-xs font-semibold uppercase text-text-muted"
                >
                  Class
                </label>
                <select
                  id="ta-class"
                  value={classId}
                  onChange={(e) => setClassId(e.target.value)}
                  disabled={busy}
                  className={fieldClass}
                >
                  <option value="">No class</option>
                  {classes.map((c) => (
                    <option key={c.id} value={c.id}>
                      {displaySubject(c.subject)} · G{c.grade}
                      {c.section ? ` ${c.section}` : ""}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-1.5">
                <label
                  htmlFor="ta-book"
                  className="text-xs font-semibold uppercase text-text-muted"
                >
                  Textbook
                </label>
                <select
                  id="ta-book"
                  value={textbookId}
                  onChange={(e) => setTextbookId(e.target.value)}
                  disabled={busy || textbooks.length === 0}
                  className={fieldClass}
                >
                  {textbooks.length === 0 && <option value="">—</option>}
                  {textbooks.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.title}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-1.5">
                <span
                  id="ta-chapter-label"
                  className="text-xs font-semibold uppercase text-text-muted"
                >
                  Chapter
                </span>
                <ChapterPicker
                  chapters={chapters}
                  value={chapterIds}
                  onChange={setChapterIds}
                  disabled={busy || chapters.length === 0}
                  className={fieldClass}
                />
              </div>
            </div>
            <p className="text-xs text-text-muted">
              Picking a chapter grounds the answer in that textbook — the passages
              closest to your instructions are used. Without one, describe the
              topic below.
            </p>
            {chapterIds.length > 1 && (
              <p className="flex items-start gap-2 rounded-xl bg-amber-50 px-3 py-2 text-xs text-amber-800">
                <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                <span>
                  For the best quality, generate one chapter at a time, then use{" "}
                  <strong>Merge materials</strong> to combine them. With {chapterIds.length} chapters
                  in one request, each gets only a share of the textbook passages.
                </span>
              </p>
            )}

            {/* Prompt */}
            <div className="space-y-1.5">
              <label
                htmlFor="ta-prompt"
                className="text-xs font-semibold uppercase text-text-muted"
              >
                Your instructions{task === "FREEFORM" || chapterIds.length === 0 ? "" : " (optional)"}
              </label>
              <textarea
                id="ta-prompt"
                rows={4}
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                disabled={busy}
                maxLength={2000}
                placeholder="e.g. electron configuration, 45-minute period, no lab equipment, focus on common mistakes"
                className={fieldClass}
              />
            </div>

            <div className="flex flex-wrap items-center gap-3">
              {/* Disabled until there is something to write about: a chapter,
                  or a described topic. Clicking it with neither used to fire
                  a request the server would only refuse. */}
              {/* Just disabled while busy — the progress card below reports
                  the work, so the button doesn't announce it a second time. */}
              <Button type="submit" disabled={busy || !hasTopic}>
                <Wand2 className="mr-1.5 h-4 w-4" />
                Generate
              </Button>
              <Button type="button" variant="outline" onClick={() => setMerging(true)} disabled={busy}>
                <Merge className="mr-1.5 h-4 w-4" />
                Merge materials
              </Button>
              {!hasTopic && !busy && (
                <p className="text-xs text-text-muted">
                  {task === "FREEFORM"
                    ? "Describe what you need to continue."
                    : "Pick a chapter or describe the topic to continue."}
                </p>
              )}
            </div>
          </form>
        </CardContent>
      </Card>

      {busy && (
        <GenerationProgressCard
          progress={progress}
          stages={chapterIds.length > 0 ? STAGES_WITH_CHAPTER : STAGES_NO_CHAPTER}
          idleMessage="Writing with AI..."
          footnote="This can take up to a minute. Longer documents take the most time to write."
        />
      )}

      {result && !busy && (
        <Card className="print-area">
          <CardHeader>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <h2 className="font-semibold text-text-primary">{result.title}</h2>
              <ResourceActions
                title={result.title}
                markdown={result.markdown}
                task={result.task}
                subject={result.subject}
                grade={result.grade}
                chapterTitle={result.chapterTitle}
                resourceId={result.resourceId}
                onSaved={() => undefined}
              />
            </div>
          </CardHeader>
          <CardContent>
            <TeacherDocument markdown={result.markdown} />
            <p className="print-hide mt-4 rounded-xl bg-amber-50 px-3 py-2 text-xs text-amber-800">
              AI-generated. Read it before you use it in class.
            </p>
            {result.resourceId && (
              <p className="print-hide mt-2 text-xs text-text-muted">
                Kept in Materials automatically. Press Save to move it to the top of your list.
              </p>
            )}

            {/* Refine instead of starting over. */}
            <form onSubmit={revise} className="print-hide mt-4 space-y-2 border-t border-border pt-4">
              <label
                htmlFor="ta-revise"
                className="text-xs font-semibold uppercase text-text-muted"
              >
                Change something
              </label>
              <div className="flex flex-col gap-2 sm:flex-row">
                <input
                  id="ta-revise"
                  value={revision}
                  onChange={(e) => setRevision(e.target.value)}
                  maxLength={500}
                  placeholder="e.g. make it shorter · add three harder items · simpler language"
                  className={fieldClass}
                />
                <Button type="submit" variant="outline" className="shrink-0">
                  <RotateCcw className="mr-1.5 h-4 w-4" /> Revise
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      )}

      {merging && <MergeMaterialsDialog onClose={() => setMerging(false)} onMerged={onMerged} />}
    </div>
  );
}

/**
 * Chapter picker: several chapters may be ticked, "No chapter" clears them.
 * A dropdown rather than a checkbox list, so the three pickers keep one row.
 */
function ChapterPicker({
  chapters,
  value,
  onChange,
  disabled,
  className,
}: {
  chapters: Chapter[];
  value: string[];
  onChange: (ids: string[]) => void;
  disabled: boolean;
  className: string;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const selected = chapters.filter((c) => value.includes(c.id));
  const summary =
    chapters.length === 0
      ? "—"
      : selected.length === 0
        ? "No chapter (general)"
        : selected.length === 1
          ? `${selected[0].chapterNumber}. ${displayChapterTitle(selected[0].title)}`
          : `${selected.length} chapters (${selected.map((c) => c.chapterNumber).join(", ")})`;

  function toggle(id: string) {
    if (value.includes(id)) {
      onChange(value.filter((x) => x !== id));
      return;
    }
    if (value.length >= MAX_CHAPTERS) {
      toast.error(`Up to ${MAX_CHAPTERS} chapters — or one at a time, then merge.`);
      return;
    }
    // Kept in the textbook's own order, whatever order they were ticked in.
    onChange(chapters.filter((c) => c.id === id || value.includes(c.id)).map((c) => c.id));
  }

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-labelledby="ta-chapter-label"
        disabled={disabled}
        onClick={() => setOpen((o) => !o)}
        className={cn(className, "flex items-center justify-between gap-2 text-left disabled:opacity-60")}
      >
        <span className="truncate">{summary}</span>
        <ChevronDown className="h-4 w-4 shrink-0 text-text-muted" />
      </button>
      {open && (
        <div
          role="listbox"
          aria-multiselectable="true"
          className="absolute right-0 z-20 mt-1 max-h-80 w-full min-w-[16rem] overflow-y-auto rounded-xl border border-border bg-surface p-1.5 shadow-lg"
        >
          <button
            type="button"
            onClick={() => {
              onChange([]);
              setOpen(false);
            }}
            className={cn(
              "w-full rounded-lg px-2 py-1.5 text-left text-sm transition-colors",
              value.length === 0 ? "bg-primary/10 text-text-primary" : "hover:bg-border/40",
            )}
          >
            No chapter (general)
          </button>
          {chapters.map((c) => {
            const checked = value.includes(c.id);
            return (
              <label
                key={c.id}
                role="option"
                aria-selected={checked}
                className={cn(
                  "flex cursor-pointer items-start gap-2 rounded-lg px-2 py-1.5 text-sm transition-colors",
                  checked ? "bg-primary/10 text-text-primary" : "hover:bg-border/40",
                )}
              >
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={() => toggle(c.id)}
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
    </div>
  );
}

interface AiAllowance {
  schoolActive: boolean;
  used: number;
  limit: number | null;
  resetsAt: string;
}

/** The teacher's monthly AI credits — silent when there is no cap to report. */
function AllowanceNote({ allowance }: { allowance: AiAllowance | null }) {
  if (!allowance) return null;
  if (!allowance.schoolActive) {
    return (
      <p className="mt-2 rounded-lg bg-warning/10 px-3 py-2 text-sm text-warning">
        Your school&apos;s subscription is not active, so AI writing is paused. Ask your
        school admin to renew.
      </p>
    );
  }
  if (allowance.limit === null) return null;

  const left = Math.max(0, allowance.limit - allowance.used);
  const resets = new Date(allowance.resetsAt).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "long",
    timeZone: "UTC",
  });
  return (
    <p className={cn("mt-1 text-xs", left === 0 ? "text-warning" : "text-text-muted")}>
      {left} of {allowance.limit} AI credits left this month (resets {resets}). Each request uses
      1; materials reused from the library are free.
    </p>
  );
}
