"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { ArrowLeft, CalendarDays, CheckCircle2, Circle, Clock,
  AlertTriangle,
  Send,
  Lock,
  Pencil,
  Trash2,
} from "lucide-react";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { SubmissionFiles } from "@/components/ui/submission-files";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { toast } from "@/components/ui/sonner";
import { cn } from "@/lib/utils";
import { formatAccuracy, accuracyTone, WEAK_THRESHOLD } from "@/lib/class-insights";
import { MarkdownView } from "@/components/ui/markdown-view";
import { ResourceActions } from "@/components/secondary-teacher/resource-actions";
import { MathText } from "@/components/ui/math-text";

/**
 * One activity: who has done it, and which questions the class actually got
 * wrong. The per-question view is the reason to pin the paper — it only means
 * anything when everyone answered the same questions.
 */

interface ActivityDetail {
  id: string;
  /** The class it was set for. */
  teachingAssignmentId: string | null;
  kind: string;
  format: "QUESTIONS" | "DOCUMENT";
  body: string | null;
  requiresSubmission: boolean;
  maxMarks: number | null;
  status: "DRAFT" | "PUBLISHED" | "CLOSED";
  /** Teacher-only worked solutions. Never sent to a student. */
  answerKey: string | null;
  publishedAt: string | null;
  title: string;
  instructions: string | null;
  dueAt: string | null;
  subject: string;
  grade: number;
  section: string;
  questionCount: number;
  createdAt: string;
  chapter: { id: string; title: string; chapterNumber: number } | null;
  assignedCount: number;
  completedCount: number;
  awaitingMarking: number;
  averageAccuracy: number | null;
}

interface StudentRow {
  id: string;
  name: string;
  section: string | null;
  state: "not_started" | "in_progress" | "done" | "submitted" | "marked";
  correctAnswers: number | null;
  totalQuestions: number | null;
  accuracy: number | null;
  submissionText?: string | null;
  /** Files the student attached, excluding any they withdrew. */
  files?: { id: string; originalName: string; sizeBytes: number; mimeType?: string }[];
  submittedAt?: string | null;
  marks?: number | null;
  feedback?: string | null;
  markedAt?: string | null;
}

interface QuestionRow {
  order: number;
  id: string;
  questionText: string;
  difficulty: string;
  answered: number;
  accuracy: number | null;
}

const STATE_META: Record<
  string,
  { label: string; icon: typeof Circle; tone: string }
> = {
  not_started: { label: "Not started", icon: Circle, tone: "text-text-muted" },
  in_progress: { label: "In progress", icon: Clock, tone: "text-amber-600" },
  submitted: { label: "Waiting to be marked", icon: Clock, tone: "text-blue-600" },
  done: { label: "Done", icon: CheckCircle2, tone: "text-green-600" },
  marked: { label: "Marked", icon: CheckCircle2, tone: "text-green-600" },
};

export default function ActivityDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const activityId = params?.id;

  const [activity, setActivity] = useState<ActivityDetail | null>(null);
  const [students, setStudents] = useState<StudentRow[]>([]);
  const [questions, setQuestions] = useState<QuestionRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [markingId, setMarkingId] = useState<string | null>(null);
  const [savingMark, setSavingMark] = useState(false);
  const [markValue, setMarkValue] = useState("");
  const [feedbackValue, setFeedbackValue] = useState("");
  /**
   * What the work is out of, when the activity was set without a total.
   * Collected at marking time rather than blocking the teacher — they often
   * only decide it once they have seen what the work demanded.
   */
  const [maxMarksValue, setMaxMarksValue] = useState("");

  const load = useCallback(async () => {
    if (!activityId) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/secondary-teacher/activities/${activityId}`);
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? "Failed to load this activity");
      setActivity(data.activity);
      setStudents(data.students ?? []);
      setQuestions(data.questions ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setLoading(false);
    }
  }, [activityId]);

  const [editingBody, setEditingBody] = useState(false);
  const [bodyDraft, setBodyDraft] = useState("");

  useEffect(() => {
    load();
  }, [load]);

  async function toggleStatus() {
    if (!activity) return;
    const next = activity.status === "PUBLISHED" ? "CLOSED" : "PUBLISHED";
    setBusy(true);
    try {
      const res = await fetch(`/api/secondary-teacher/activities/${activity.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: next }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? "Could not update this activity");
      setActivity({ ...activity, status: next });
      toast.success(next === "CLOSED" ? "Activity closed." : "Activity reopened.");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setBusy(false);
    }
  }

  /** Send a reviewed draft to the class. */
  async function publishDraft() {
    if (!activity) return;
    setBusy(true);
    try {
      const res = await fetch(
        `/api/secondary-teacher/activities/${activity.id}/publish`,
        { method: "POST" },
      );
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? "Could not send this activity");
      // Undo puts it back to a draft — they reviewed it, so it is kept to fix.
      toast.success(`Sent to ${data.notified} student${data.notified === 1 ? "" : "s"}.`, {
        duration: 12000,
        action: { label: "Undo", onClick: () => void takeBack(true) },
      });
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setBusy(false);
    }
  }

  async function discardDraft() {
    if (!activity) return;
    if (
      !window.confirm(
        "Discard this draft? Nothing has been sent, so no student will notice — but this cannot be undone.",
      )
    ) {
      return;
    }
    setBusy(true);
    try {
      const res = await fetch(`/api/secondary-teacher/activities/${activity.id}`, {
        method: "DELETE",
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? "Could not discard this draft");
      toast.success("Draft discarded.");
      router.push("/secondary-teacher/activities");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Something went wrong");
      setBusy(false);
    }
  }

  /**
   * Take sent work back from the class — back to a draft (the Undo after
   * sending), or deleted. Only while no student has started it; the server
   * says so if someone has.
   */
  async function takeBack(toDraft: boolean) {
    if (!activity) return;
    if (
      !toDraft &&
      !window.confirm(
        "Take this back? It disappears from your students' lists and is deleted. Nobody has started it yet.",
      )
    ) {
      return;
    }
    setBusy(true);
    try {
      const res = await fetch(
        `/api/secondary-teacher/activities/${activity.id}${toDraft ? "?toDraft=1" : ""}`,
        { method: "DELETE" },
      );
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? "Could not take that back");
      if (toDraft) {
        toast.success("Taken back — it is a draft again. Students no longer see it.");
        await load();
        setBusy(false);
      } else {
        toast.success("Taken back and deleted.");
        router.push("/secondary-teacher/activities");
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Something went wrong");
      setBusy(false);
    }
  }

  /** Correct the student-facing content before it goes out. */
  async function saveBody() {
    if (!activity) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/secondary-teacher/activities/${activity.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ documentBody: bodyDraft }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? "Could not save that");
      setEditingBody(false);
      toast.success("Saved.");
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setBusy(false);
    }
  }

  /** Drop a bad generated question before the class ever sees it. */
  async function removeQuestion(questionId: string) {
    if (!activity) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/secondary-teacher/activities/${activity.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ removeQuestionIds: [questionId] }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? "Could not remove that question");
      toast.success("Question removed.");
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setBusy(false);
    }
  }

  function openMarking(s: StudentRow) {
    setMarkingId(s.id);
    setMarkValue(s.marks !== null && s.marks !== undefined ? String(s.marks) : "");
    setFeedbackValue(s.feedback ?? "");
    // Blank whenever the activity has no total yet — the teacher types it
    // once and it applies to everyone.
    setMaxMarksValue(activity?.maxMarks != null ? String(activity.maxMarks) : "");
  }

  async function saveMark(studentId: string, clear = false) {
    if (!activity) return;
    setSavingMark(true);
    try {
      const res = await fetch(
        `/api/secondary-teacher/activities/${activity.id}/submissions/${studentId}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(
            clear
              ? { clear: true }
              : {
                  marks: markValue === "" ? null : Number(markValue),
                  feedback: feedbackValue,
                  // Only meaningful the first time; the server refuses to
                  // change a total that is already set.
                  ...(activity.maxMarks === null && maxMarksValue !== ""
                    ? { maxMarks: Number(maxMarksValue) }
                    : {}),
                },
          ),
        },
      );
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? "Could not save that");
      setMarkingId(null);
      await load();
      toast.success(clear ? "Handed back to the student." : "Marked.");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setSavingMark(false);
    }
  }

  if (loading) {
    return (
      <div className="flex justify-center py-16">
        <Spinner size="lg" className="text-primary" />
      </div>
    );
  }

  if (error || !activity) {
    return (
      <Card>
        <CardContent>
          <p className="py-8 text-center text-sm text-red-600">
            {error ?? "Activity unavailable"}
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="mx-auto max-w-5xl space-y-5">
      <Link
        href="/secondary-teacher/activities"
        className="inline-flex items-center gap-1.5 text-sm font-semibold text-primary hover:underline"
      >
        <ArrowLeft className="h-4 w-4" /> All activities
      </Link>

      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-2xl font-bold text-text-primary">{activity.title}</h1>
          <p className="text-sm text-text-secondary">
            {activity.subject} · Grade {activity.grade} {activity.section} ·{" "}
            {activity.format === "DOCUMENT"
              ? "written work"
              : `${activity.questionCount} questions`}
            {activity.chapter
              ? ` · Ch ${activity.chapter.chapterNumber}: ${activity.chapter.title}`
              : ""}
          </p>
          {activity.instructions && (
            <p className="mt-2 max-w-2xl rounded-xl bg-border/30 px-3 py-2 text-sm text-text-secondary">
              {activity.instructions}
            </p>
          )}
        </div>
        {activity.status === "DRAFT" ? (
          <div className="flex gap-2">
            <Button type="button" variant="outline" onClick={discardDraft} disabled={busy}>
              Discard
            </Button>
            <Button type="button" onClick={publishDraft} disabled={busy}>
              {busy ? <Spinner size="sm" /> : <><Send className="mr-1.5 h-4 w-4" /> Send to class</>}
            </Button>
          </div>
        ) : (
          <div className="flex gap-2">
            {/* Sent to the wrong class, or too early: while nobody has
                started it, it can simply be taken back. After that it is
                the students' work, and closing is the way to stop it. */}
            {students.every((s) => s.state === "not_started") && (
              <Button type="button" variant="outline" onClick={() => void takeBack(false)} disabled={busy}>
                <Trash2 className="mr-1.5 h-4 w-4" /> Take back
              </Button>
            )}
            <Button type="button" variant="outline" onClick={toggleStatus} disabled={busy}>
              {busy ? (
                <Spinner size="sm" />
              ) : activity.status === "PUBLISHED" ? (
                "Close activity"
              ) : (
                "Reopen"
              )}
            </Button>
          </div>
        )}
      </div>

      {activity.status === "DRAFT" && (
        <Card className="border-amber-300 bg-amber-50">
          <CardContent>
            <div className="flex items-start gap-3 py-1">
              <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-600" />
              <div className="min-w-0 space-y-1">
                <p className="text-sm font-semibold text-amber-900">
                  Not sent yet — read this before your class does.
                </p>
                <p className="text-xs text-amber-800">
                  AI writes wrong answers as confidently as right ones. Check the
                  content below, fix anything that is off, then send it. Your{" "}
                  {activity.assignedCount} student
                  {activity.assignedCount === 1 ? "" : "s"} cannot see any of this
                  until you do.
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      <div className="grid gap-4 sm:grid-cols-3">
        <Tile label="Assigned" value={String(activity.assignedCount)} />
        <Tile
          label="Completed"
          value={`${activity.completedCount} of ${activity.assignedCount}`}
        />
        <Tile
          label={
            activity.format === "DOCUMENT"
              ? activity.requiresSubmission
                ? "To mark"
                : "Marking"
              : "Class average"
          }
          value={
            activity.format === "DOCUMENT"
              ? activity.requiresSubmission
                ? String(activity.awaitingMarking)
                : "Not auto-marked"
              : formatAccuracy(activity.averageAccuracy)
          }
          tone={
            activity.format === "DOCUMENT"
              ? undefined
              : accuracyTone(activity.averageAccuracy)
          }
        />
      </div>

      <p className="flex items-center gap-1.5 text-xs text-text-muted">
        <CalendarDays className="h-3.5 w-3.5" />
        {activity.dueAt
          ? `Due ${new Date(activity.dueAt).toLocaleDateString()} — late work is still accepted.`
          : "No due date."}
      </p>

      {activity.format === "DOCUMENT" && activity.body && (
        <Card className="print-area">
          <CardHeader>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <h2 className="font-semibold text-text-primary">
                  {activity.status === "DRAFT"
                    ? "What your students will see"
                    : "What you gave them"}
                </h2>
                {activity.status === "DRAFT" && (
                  <p className="text-xs text-text-muted">
                    This is the whole of it — the answer key is not included.
                  </p>
                )}
              </div>
              <div className="flex items-center gap-2">
                {activity.status === "DRAFT" &&
                  (editingBody ? (
                    <>
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        onClick={() => setEditingBody(false)}
                        disabled={busy}
                      >
                        Cancel
                      </Button>
                      <Button type="button" size="sm" onClick={saveBody} disabled={busy}>
                        {busy ? <Spinner size="sm" /> : "Save"}
                      </Button>
                    </>
                  ) : (
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={() => {
                        setBodyDraft(activity.body ?? "");
                        setEditingBody(true);
                      }}
                    >
                      <Pencil className="mr-1.5 h-3.5 w-3.5" /> Edit
                    </Button>
                  ))}
                {/* Only actions on the document itself. Setting work for
                    another class belongs to that class, not to this page. */}
                <ResourceActions title={activity.title} markdown={activity.body} give={false} />
              </div>
            </div>
          </CardHeader>
          <CardContent>
            {editingBody ? (
              <textarea
                rows={20}
                value={bodyDraft}
                onChange={(e) => setBodyDraft(e.target.value)}
                disabled={busy}
                className="w-full rounded-xl border border-border bg-background px-3 py-2.5 font-mono text-xs text-text-primary outline-none focus:border-primary"
              />
            ) : (
              <MarkdownView markdown={activity.body} />
            )}
          </CardContent>
        </Card>
      )}

      {/* ── The answer key. Teacher-only, and never sent anywhere. ───── */}
      {activity.format === "DOCUMENT" && activity.answerKey && (
        <Card className="border-primary/30">
          <CardHeader>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <h2 className="flex items-center gap-1.5 font-semibold text-text-primary">
                  <Lock className="h-4 w-4 text-primary" /> Answer key — only you
                </h2>
                <p className="text-xs text-text-muted">
                  Worked solutions and the marking guide. Students never receive
                  this, whether the work is sent or not.
                </p>
              </div>
              {/* Download, print, copy — but never "give to class": this is
                  the answers, and that button would have assigned them to
                  students as their work. */}
              <ResourceActions
                title={`${activity.title} — answer key`}
                markdown={activity.answerKey}
                give={false}
              />
            </div>
          </CardHeader>
          <CardContent>
            <details>
              <summary className="cursor-pointer text-sm font-semibold text-primary">
                Show the answers
              </summary>
              <div className="mt-3">
                <MarkdownView markdown={activity.answerKey} />
              </div>
            </details>
          </CardContent>
        </Card>
      )}

      {/* The paper takes the room; the student list is a narrow column. A
          name and a state need ~20rem — splitting 50/50 squeezed the
          questions into half the page while the names sat in empty space. */}
      <div
        className={cn(
          "grid items-start gap-5",
          activity.format === "DOCUMENT" ? "" : "lg:grid-cols-[minmax(0,1fr)_20rem]",
        )}
      >
        {/* ── Per question ───────────────────────────────────────────── */}
        {activity.format !== "DOCUMENT" && (
        <Card>
          <CardHeader>
            <h2 className="font-semibold text-text-primary">
              {activity.status === "DRAFT" ? "The paper" : "By question"}
            </h2>
            <p className="text-xs text-text-muted">
              {activity.status === "DRAFT"
                ? "Read these before sending. Remove any that are wrong or badly worded — the rest stay in the same order."
                : "Everyone sat the same paper, so this shows what the class actually struggled with."}
            </p>
          </CardHeader>
          <CardContent>
            <ul className="space-y-2">
              {questions.map((q) => (
                <li
                  key={q.id}
                  className="flex items-start justify-between gap-3 rounded-xl bg-border/30 px-3 py-2"
                >
                  <div className="min-w-0">
                    <p className="text-sm text-text-primary">
                      <span className="font-bold">Q{q.order + 1}.</span>{" "}
                      <MathText text={q.questionText} />
                    </p>
                    <p className="text-[11px] text-text-muted">
                      {activity.status === "DRAFT"
                        ? q.difficulty.toLowerCase()
                        : `${q.answered} answered · ${q.difficulty.toLowerCase()}`}
                    </p>
                  </div>
                  {activity.status === "DRAFT" && (
                    <button
                      type="button"
                      onClick={() => removeQuestion(q.id)}
                      disabled={busy}
                      aria-label={`Remove question ${q.order + 1}`}
                      title="Remove this question"
                      className="shrink-0 rounded p-1.5 text-text-muted transition-colors hover:bg-red-50 hover:text-red-600 disabled:opacity-50"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  )}
                  <span
                    className={cn(
                      "shrink-0 rounded-full px-2 py-0.5 text-xs font-bold",
                      accuracyTone(q.accuracy),
                    )}
                  >
                    {formatAccuracy(q.accuracy)}
                  </span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>

        )}

        {/* ── Per student ────────────────────────────────────────────── */}
        {/* Stays in view while the teacher scrolls a long paper. */}
        <Card className={cn(activity.format !== "DOCUMENT" && "lg:sticky lg:top-4")}>
          <CardHeader>
            <h2 className="font-semibold text-text-primary">By student</h2>
            <p className="text-xs text-text-muted">
              Work waiting to be marked comes first — that is the queue to act on.
            </p>
          </CardHeader>
          <CardContent>
            <ul className="divide-y divide-border">
              {students.map((s) => {
                const meta = STATE_META[s.state];
                const Icon = meta.icon;
                const isDoc = activity.format === "DOCUMENT";
                const canMark = isDoc && Boolean(s.submittedAt);
                return (
                  <li key={s.id} className="py-2">
                    <div className="flex items-center justify-between gap-3">
                      <div className="flex min-w-0 items-center gap-2">
                        <Icon className={cn("h-4 w-4 shrink-0", meta.tone)} />
                        <div className="min-w-0">
                          <p className="truncate text-sm font-medium text-text-primary">
                            <Link
                              href={`/secondary-teacher/students/${s.id}`}
                              className="hover:text-primary hover:underline"
                            >
                              {s.name}
                            </Link>
                            {s.accuracy !== null && s.accuracy < WEAK_THRESHOLD && (
                              <span className="ml-2 rounded-full bg-red-100 px-1.5 py-0.5 text-[10px] font-bold text-red-700">
                                needs help
                              </span>
                            )}
                          </p>
                          <p className="text-[11px] text-text-muted">{meta.label}</p>
                        </div>
                      </div>

                      <div className="flex shrink-0 items-center gap-2">
                        {isDoc ? (
                          <>
                            {s.markedAt && (
                              <span className="rounded-full bg-green-100 px-2 py-0.5 text-xs font-bold text-green-700">
                                {s.marks !== null && s.marks !== undefined && activity.maxMarks
                                  ? `${s.marks}/${activity.maxMarks}`
                                  : "Marked"}
                              </span>
                            )}
                            {canMark && (
                              <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                onClick={() =>
                                  markingId === s.id ? setMarkingId(null) : openMarking(s)
                                }
                              >
                                {markingId === s.id
                                  ? "Close"
                                  : s.markedAt
                                    ? "Re-mark"
                                    : "Mark"}
                              </Button>
                            )}
                          </>
                        ) : (
                          <span
                            className={cn(
                              "rounded-full px-2 py-0.5 text-xs font-bold",
                              accuracyTone(s.accuracy),
                            )}
                          >
                            {s.state === "done"
                              ? `${s.correctAnswers}/${s.totalQuestions}`
                              : formatAccuracy(s.accuracy)}
                          </span>
                        )}
                      </div>
                    </div>

                    {/* Marking panel: their answer, then a mark and feedback. */}
                    {markingId === s.id && (
                      <div className="mt-3 space-y-3 rounded-xl border border-border bg-border/20 p-3">
                        <div>
                          <p className="mb-1 text-xs font-semibold uppercase text-text-muted">
                            Their answer
                          </p>
                          {s.submissionText ? (
                            <p className="max-h-64 overflow-y-auto whitespace-pre-wrap rounded-lg bg-surface p-3 text-sm text-text-primary">
                              {s.submissionText}
                            </p>
                          ) : (
                            <p className="rounded-lg bg-surface p-3 text-sm italic text-text-muted">
                              Nothing typed — see the attached work below.
                            </p>
                          )}

                          {/* Attached work. Downloads go through the
                              authorising route; there is no public URL. */}
                          {(s.files?.length ?? 0) > 0 && (
                            <div className="mt-2">
                              <p className="mb-1 text-xs font-semibold uppercase text-text-muted">
                                Attached work
                              </p>
                              <SubmissionFiles files={s.files ?? []} />
                            </div>
                          )}

                          {s.submittedAt && (
                            <p className="mt-1 text-[11px] text-text-muted">
                              Handed in {new Date(s.submittedAt).toLocaleString()}
                            </p>
                          )}
                        </div>

                        {/* ── The mark ──────────────────────────────── */}
                        <div className="rounded-xl border border-border bg-surface p-3">
                          <label
                            htmlFor={`marks-${s.id}`}
                            className="mb-1.5 block text-xs font-semibold uppercase text-text-muted"
                          >
                            Mark
                          </label>
                          <div className="flex flex-wrap items-center gap-2">
                            <Input
                              id={`marks-${s.id}`}
                              type="number"
                              min={0}
                              max={activity.maxMarks ?? undefined}
                              value={markValue}
                              onChange={(e) => setMarkValue(e.target.value)}
                              disabled={savingMark}
                              placeholder="—"
                              className="w-24 text-lg font-bold"
                            />
                            <span className="text-lg font-semibold text-text-muted">/</span>
                            {activity.maxMarks !== null ? (
                              <span className="text-lg font-bold text-text-primary">
                                {activity.maxMarks}
                              </span>
                            ) : (
                              /* Set once, then fixed for the whole class —
                                 changing it later would rescale marks already
                                 given. */
                              <Input
                                type="number"
                                min={1}
                                max={1000}
                                value={maxMarksValue}
                                onChange={(e) => setMaxMarksValue(e.target.value)}
                                disabled={savingMark}
                                placeholder="out of"
                                aria-label="Total marks for this activity"
                                className="w-24 text-lg font-bold"
                              />
                            )}
                            {markValue !== "" &&
                              (activity.maxMarks ?? Number(maxMarksValue)) > 0 && (
                                <span className="text-sm font-semibold text-text-secondary">
                                  {Math.round(
                                    (Number(markValue) /
                                      (activity.maxMarks ?? Number(maxMarksValue))) *
                                      100,
                                  )}
                                  %
                                </span>
                              )}
                          </div>
                          <p className="mt-1.5 text-[11px] text-text-muted">
                            {activity.maxMarks !== null
                              ? "Leave blank to give feedback without a score."
                              : "This activity was set without a total. Enter one and it applies to the whole class."}
                          </p>
                        </div>

                        <div className="flex flex-wrap items-end gap-3">
                          <div className="min-w-0 flex-1">
                            <label
                              htmlFor={`fb-${s.id}`}
                              className="mb-1 block text-xs font-semibold uppercase text-text-muted"
                            >
                              Feedback
                            </label>
                            <textarea
                              id={`fb-${s.id}`}
                              rows={2}
                              value={feedbackValue}
                              onChange={(e) => setFeedbackValue(e.target.value)}
                              disabled={savingMark}
                              maxLength={4000}
                              placeholder="What they did well, and what to fix."
                              className="w-full rounded-xl border border-border bg-background px-3 py-2 text-sm text-text-primary outline-none focus:border-primary"
                            />
                          </div>
                        </div>

                        <div className="flex flex-wrap gap-2">
                          <Button
                            type="button"
                            size="sm"
                            onClick={() => saveMark(s.id)}
                            disabled={savingMark}
                          >
                            {savingMark ? <Spinner size="sm" /> : "Save mark"}
                          </Button>
                          {s.markedAt && (
                            <Button
                              type="button"
                              size="sm"
                              variant="outline"
                              onClick={() => saveMark(s.id, true)}
                              disabled={savingMark}
                            >
                              Hand back to redo
                            </Button>
                          )}
                        </div>
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function Tile({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: string;
}) {
  return (
    <Card>
      <CardContent>
        <div className="py-1">
          <p className={cn("text-xl font-bold text-text-primary", tone && "inline-block rounded-full px-2 py-0.5", tone)}>
            {value}
          </p>
          <p className="mt-1 text-xs text-text-secondary">{label}</p>
        </div>
      </CardContent>
    </Card>
  );
}
