"use client";

import { useCallback, useEffect, useState } from "react";
import { RotateCcw, Sparkles, Wand2 } from "lucide-react";
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
import { displayChapterTitle, displaySubject } from "@/lib/display-text";

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
  task: AssistantTask;
  subject: string | null;
  grade: number | null;
  chapterTitle: string | null;
}

/**
 * The last result survives leaving the page (per browser tab). It used to
 * vanish on navigation unless the teacher had pressed Save first.
 */
const LAST_RESULT_KEY = "ta:last-result";

function loadLastResult(): AssistantResult | null {
  try {
    const raw = sessionStorage.getItem(LAST_RESULT_KEY);
    return raw ? (JSON.parse(raw) as AssistantResult) : null;
  } catch {
    return null;
  }
}

function storeLastResult(r: AssistantResult | null) {
  try {
    if (r) sessionStorage.setItem(LAST_RESULT_KEY, JSON.stringify(r));
    else sessionStorage.removeItem(LAST_RESULT_KEY);
  } catch {
    /* private mode or storage full — the result still shows, it just won't persist */
  }
}

export default function TeachingAssistantPage() {
  const [classes, setClasses] = useState<ClassOption[]>([]);
  const [classId, setClassId] = useState("");
  const [textbooks, setTextbooks] = useState<Textbook[]>([]);
  const [textbookId, setTextbookId] = useState("");
  const [chapters, setChapters] = useState<Chapter[]>([]);
  const [chapterId, setChapterId] = useState("");

  const [task, setTask] = useState<AssistantTask>("LESSON_PLAN");
  const [prompt, setPrompt] = useState("");
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<GenerationProgressState | null>(null);
  const [result, setResult] = useState<AssistantResult | null>(null);
  const [revision, setRevision] = useState("");

  const selectedClass = classes.find((c) => c.id === classId) ?? null;

  useEffect(() => {
    setResult(loadLastResult());
  }, []);

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
      setChapterId("");
      return;
    }
    let cancelled = false;
    fetch(`/api/textbooks/${textbookId}/chapters`)
      .then((r) => (r.ok ? r.json() : { chapters: [] }))
      .then((d) => {
        if (cancelled) return;
        const list: Chapter[] = d.chapters ?? [];
        setChapters(list);
        setChapterId(list[0]?.id ?? "");
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
      if (!revise && !chapterId && prompt.trim().length < 3) {
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
            chapterId: revise ? null : chapterId || null,
            revise,
          }),
        });
        // A rejection (rate limit, validation, AI switched off) still comes
        // back as plain JSON, before the stream ever starts.
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          throw new Error(data.error ?? "The AI could not respond");
        }

        const data = await consumeSse<{ title: string; markdown: string }>(
          res,
          setProgress,
          "The connection ended before the document was finished.",
        );
        const next: AssistantResult = revise && result
          ? { ...result, title: data.title, markdown: data.markdown }
          : {
              title: data.title,
              markdown: data.markdown,
              task,
              subject: selectedClass?.subject ?? null,
              grade: selectedClass?.grade ?? null,
              chapterTitle: chapters.find((c) => c.id === chapterId)?.title ?? null,
            };
        setResult(next);
        storeLastResult(next);
        if (revise) setRevision("");
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Something went wrong");
      } finally {
        setBusy(false);
        setProgress(null);
      }
    },
    [busy, task, prompt, chapterId, chapters, selectedClass, result],
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
                <label
                  htmlFor="ta-chapter"
                  className="text-xs font-semibold uppercase text-text-muted"
                >
                  Chapter
                </label>
                <select
                  id="ta-chapter"
                  value={chapterId}
                  onChange={(e) => setChapterId(e.target.value)}
                  disabled={busy || chapters.length === 0}
                  className={fieldClass}
                >
                  {/* Always clearable: grounding is optional, and the first
                      chapter used to be forced on once a class was picked. */}
                  <option value="">{chapters.length === 0 ? "—" : "No chapter (general)"}</option>
                  {chapters.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.chapterNumber}. {displayChapterTitle(c.title)}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <p className="text-xs text-text-muted">
              Picking a chapter grounds the answer in that textbook — the passages
              closest to your instructions are used. Without one, describe the
              topic below.
            </p>

            {/* Prompt */}
            <div className="space-y-1.5">
              <label
                htmlFor="ta-prompt"
                className="text-xs font-semibold uppercase text-text-muted"
              >
                Your instructions{task === "FREEFORM" || !chapterId ? "" : " (optional)"}
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

            <Button type="submit" disabled={busy}>
              <Wand2 className="mr-1.5 h-4 w-4" />
              {busy ? "Generating..." : "Generate"}
            </Button>
          </form>
        </CardContent>
      </Card>

      {busy && (
        <GenerationProgressCard
          progress={progress}
          stages={chapterId ? STAGES_WITH_CHAPTER : STAGES_NO_CHAPTER}
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
                onSaved={() => undefined}
              />
            </div>
          </CardHeader>
          <CardContent>
            <TeacherDocument markdown={result.markdown} />
            <p className="print-hide mt-4 rounded-xl bg-amber-50 px-3 py-2 text-xs text-amber-800">
              AI-generated. Read it before you use it in class.
            </p>

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
    </div>
  );
}
