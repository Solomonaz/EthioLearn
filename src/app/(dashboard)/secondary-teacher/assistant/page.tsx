"use client";

import { useCallback, useEffect, useState } from "react";
import { Sparkles, Wand2 } from "lucide-react";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  GenerationProgressCard,
  type GenerationProgressState,
  type ProgressStage,
} from "@/components/ui/generation-progress";
import { consumeSse } from "@/lib/sse-client";
import { getStudyScope } from "@/lib/grade-scope";

/**
 * The stages the assistant route really reports, at the percentages it sends.
 * Kept beside the page rather than in the component so the two pipelines can
 * diverge without one breaking the other.
 */
const ASSISTANT_STAGES: ProgressStage[] = [
  { at: 8, label: "1. Read chapter" },
  { at: 25, label: "2. Write" },
  { at: 88, label: "3. Format" },
];
import { toast } from "@/components/ui/sonner";
import { cn } from "@/lib/utils";
import { ASSISTANT_TASKS, type AssistantTask } from "@/lib/assistant-tasks";
import { MarkdownView } from "@/components/ui/markdown-view";
import { ResourceActions } from "@/components/secondary-teacher/resource-actions";

/**
 * AI teaching assistant.
 *
 * A teacher picks what they want, optionally grounds it in a chapter of a
 * textbook their class studies, and gets something they can take into a
 * classroom. Grounding is optional — "anything else" with a free-form prompt
 * is a first-class path, not a fallback.
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
  const [result, setResult] = useState<{ title: string; markdown: string } | null>(null);

  const selectedClass = classes.find((c) => c.id === classId) ?? null;

  // The teacher's own classes, reused from the cohort endpoint.
  useEffect(() => {
    fetch("/api/secondary-teacher/classes")
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

  const submit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      if (busy) return;
      if (task === "FREEFORM" && prompt.trim().length < 3) {
        toast.error("Describe what you need.");
        return;
      }

      setBusy(true);
      setResult(null);
      setProgress({ message: "Starting...", percent: 5 });
      try {
        const res = await fetch("/api/secondary-teacher/assistant?stream=1", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            task,
            prompt: prompt.trim(),
            chapterId: chapterId || null,
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
        setResult({ title: data.title, markdown: data.markdown });
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Something went wrong");
      } finally {
        setBusy(false);
        setProgress(null);
      }
    },
    [busy, task, prompt, chapterId],
  );

  const fieldClass =
    "w-full rounded-xl border border-border bg-background px-3 py-2.5 text-sm text-text-primary outline-none focus:border-primary";

  const activeTask = ASSISTANT_TASKS.find((t) => t.value === task);

  return (
    <div className="mx-auto max-w-4xl space-y-5">
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-bold text-text-primary">
          <Sparkles className="h-6 w-6 text-primary" /> Teaching assistant
        </h1>
        <p className="text-sm text-text-secondary">
          Lesson plans, worksheets, board notes, exam blueprints — or just describe
          what you need.
        </p>
      </div>

      <Card>
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
                      {c.subject} · G{c.grade}
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
                  {chapters.length === 0 && <option value="">—</option>}
                  {chapters.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.chapterNumber}. {c.title}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <p className="text-xs text-text-muted">
              Picking a chapter grounds the answer in that textbook. Leave it empty
              to ask about anything.
            </p>

            {/* Prompt */}
            <div className="space-y-1.5">
              <label
                htmlFor="ta-prompt"
                className="text-xs font-semibold uppercase text-text-muted"
              >
                Your instructions{task === "FREEFORM" ? "" : " (optional)"}
              </label>
              <textarea
                id="ta-prompt"
                rows={4}
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                disabled={busy}
                maxLength={2000}
                placeholder="e.g. 45-minute period, no lab equipment, focus on unit conversion mistakes"
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
          stages={ASSISTANT_STAGES}
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
                task={task}
                subject={selectedClass?.subject ?? null}
                grade={selectedClass?.grade ?? null}
                chapterTitle={
                  chapters.find((c) => c.id === chapterId)?.title ?? null
                }
                onSaved={() => undefined}
              />
            </div>
          </CardHeader>
          <CardContent>
            <MarkdownView markdown={result.markdown} />
            <p className="print-hide mt-4 rounded-xl bg-amber-50 px-3 py-2 text-xs text-amber-800">
              AI-generated. Read it before you use it in class.
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
