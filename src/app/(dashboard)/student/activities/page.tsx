"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { CalendarDays, Check, CheckCircle2, ClipboardList, FileText, Play, Upload } from "lucide-react";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { toast } from "@/components/ui/sonner";
import { useQuizStore } from "@/stores/quiz-store";
import { cn } from "@/lib/utils";
import { MarkdownView } from "@/components/ui/markdown-view";
import {
  SubmissionFiles,
  type SubmissionFileItem,
} from "@/components/ui/submission-files";
import { ACCEPT_ATTRIBUTE, ACCEPTED_LABEL, MAX_FILE_BYTES } from "@/lib/upload-limits";

/**
 * Work set by the student's teachers.
 *
 * Nothing is ever marked overdue. A due date is a reminder — the same work may
 * already have been handed in on paper — so past-due items stay open and
 * unflagged.
 */

interface StudentActivity {
  id: string;
  kind: string;
  /** QUESTIONS is sat as a quiz; DOCUMENT is read and marked done. */
  format: "QUESTIONS" | "DOCUMENT";
  body: string | null;
  requiresSubmission: boolean;
  maxMarks: number | null;
  submissionText: string | null;
  /** Files they attached and have not withdrawn. */
  files: { id: string; originalName: string; sizeBytes: number }[];
  submittedAt: string | null;
  marks: number | null;
  feedback: string | null;
  markedAt: string | null;
  title: string;
  instructions: string | null;
  dueAt: string | null;
  subject: string;
  questionCount: number;
  chapter: { title: string; chapterNumber: number } | null;
  teacherName: string | null;
  state: "not_started" | "in_progress" | "done" | "submitted" | "marked";
  correctAnswers: number | null;
  totalQuestions: number | null;
}

const KIND_LABEL: Record<string, string> = {
  HOMEWORK: "Homework",
  CLASSWORK: "Classwork",
  ASSIGNMENT: "Assignment",
  TEST: "Test",
  PRACTICE: "Practice",
};

export default function StudentActivitiesPage() {
  const router = useRouter();
  const startQuiz = useQuizStore((s) => s.startQuiz);

  const [activities, setActivities] = useState<StudentActivity[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [startingId, setStartingId] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [markingId, setMarkingId] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [submittingId, setSubmittingId] = useState<string | null>(null);
  const [uploadingId, setUploadingId] = useState<string | null>(null);
  const [removingFileId, setRemovingFileId] = useState<string | null>(null);

  // The activity a homework notification pointed at, so arriving from the bell
  // lands on the right card instead of the top of a long list. Read from the
  // URL after mount rather than with `useSearchParams`, which would put this
  // page behind a Suspense boundary for no other reason.
  const [highlightId, setHighlightId] = useState<string | null>(null);
  useEffect(() => {
    const id = new URLSearchParams(window.location.search).get("activity");
    if (id) setHighlightId(id);
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/students/me/activities");
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? "Failed to load your work");
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

  /**
   * Attach files to a piece of work.
   *
   * Size is checked here as a courtesy — the server checks it again, and the
   * server is the one that decides. Doing it here only saves a student on a
   * slow connection from uploading ten megabytes to be told no.
   */
  const uploadFiles = useCallback(
    async (activityId: string, fileList: FileList | null) => {
      if (!fileList || fileList.length === 0) return;
      const chosen = Array.from(fileList);

      const tooBig = chosen.find((f) => f.size > MAX_FILE_BYTES);
      if (tooBig) {
        toast.error(
          `"${tooBig.name}" is larger than ${Math.floor(MAX_FILE_BYTES / (1024 * 1024))} MB.`,
        );
        return;
      }

      const form = new FormData();
      for (const f of chosen) form.append("files", f);

      setUploadingId(activityId);
      try {
        const res = await fetch(`/api/students/me/activities/${activityId}/files`, {
          method: "POST",
          body: form,
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error ?? "Upload failed");
        toast.success(
          chosen.length === 1 ? "File attached." : `${chosen.length} files attached.`,
        );
        await load();
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Upload failed");
      } finally {
        setUploadingId(null);
      }
    },
    [load],
  );

  const removeFile = useCallback(
    async (activityId: string, fileId: string) => {
      setRemovingFileId(fileId);
      try {
        const res = await fetch(
          `/api/students/me/activities/${activityId}/files/${fileId}`,
          { method: "DELETE" },
        );
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error ?? "Could not remove that file");
        await load();
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Could not remove that file");
      } finally {
        setRemovingFileId(null);
      }
    },
    [load],
  );

  // Scroll to it once the list has actually rendered.
  useEffect(() => {
    if (!highlightId || loading) return;
    document
      .getElementById(`activity-${highlightId}`)
      ?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [highlightId, loading]);

  async function open(activity: StudentActivity) {
    setStartingId(activity.id);
    try {
      const res = await fetch(`/api/students/me/activities/${activity.id}/start`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? "Could not open this");

      // Hand off to the normal quiz player — same store, same submit route.
      startQuiz(data.quizId, data.questions, "SOLO", null);
      router.push(`/student/quiz/${data.quizId}`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Something went wrong");
      setStartingId(null);
    }
  }

  async function markDone(activity: StudentActivity, done: boolean) {
    setMarkingId(activity.id);
    try {
      const res = await fetch(`/api/students/me/activities/${activity.id}/complete`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ done }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? "Could not update that");
      await load();
      toast.success(done ? "Marked as done." : "Moved back to your list.");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setMarkingId(null);
    }
  }

  async function submitAnswer(activity: StudentActivity) {
    const text = (drafts[activity.id] ?? activity.submissionText ?? "").trim();
    if (!text) {
      toast.error("Write your answer first.");
      return;
    }
    setSubmittingId(activity.id);
    try {
      const res = await fetch(`/api/students/me/activities/${activity.id}/submit`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? "Could not hand that in");
      await load();
      toast.success("Handed in.");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setSubmittingId(null);
    }
  }

  const pending = activities.filter((a) => a.state !== "done" && a.state !== "marked");
  const done = activities.filter((a) => a.state === "done" || a.state === "marked");

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <div>
        <h1 className="text-2xl font-bold text-text-primary">My work</h1>
        <p className="text-sm text-text-secondary">
          Homework and activities set by your teachers.
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
              <h2 className="font-semibold text-text-primary">Nothing set right now</h2>
              <p className="mx-auto mt-1 max-w-sm text-sm text-text-secondary">
                When a teacher sets homework, it will appear here.
              </p>
            </div>
          </CardContent>
        </Card>
      ) : (
        <>
          {pending.map((a) => (
            <Card
              key={a.id}
              id={`activity-${a.id}`}
              className={cn(
                highlightId === a.id &&
                  "ring-2 ring-primary ring-offset-2 ring-offset-background",
              )}
            >
              <CardHeader>
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <h2 className="font-semibold text-text-primary">{a.title}</h2>
                      <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[11px] font-semibold text-primary">
                        {KIND_LABEL[a.kind] ?? a.kind}
                      </span>
                      {a.state === "in_progress" && (
                        <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-semibold text-amber-700">
                          Started
                        </span>
                      )}
                      {a.state === "submitted" && (
                        <span className="rounded-full bg-blue-100 px-2 py-0.5 text-[11px] font-semibold text-blue-700">
                          Handed in — waiting to be marked
                        </span>
                      )}
                    </div>
                    <p className="mt-0.5 text-xs text-text-muted">
                      {a.subject}
                      {a.format === "DOCUMENT"
                        ? " · written work"
                        : ` · ${a.questionCount} questions`}
                      {a.teacherName ? ` · ${a.teacherName}` : ""}
                    </p>
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                {a.instructions && (
                  <p className="mb-3 rounded-xl bg-border/30 px-3 py-2 text-sm text-text-secondary">
                    {a.instructions}
                  </p>
                )}
                {/* Written work is read right here; there is nothing to sit. */}
                {a.format === "DOCUMENT" && a.body && openId === a.id && (
                  <div className="print-area mb-3 rounded-xl border border-border p-3">
                    <MarkdownView markdown={a.body} />
                  </div>
                )}

                {a.format === "DOCUMENT" && a.requiresSubmission && (
                  <div className="print-hide mb-3 space-y-2">
                    <label
                      htmlFor={`answer-${a.id}`}
                      className="block text-xs font-semibold uppercase text-text-muted"
                    >
                      Your answer
                      {a.maxMarks ? ` (out of ${a.maxMarks} marks)` : ""}
                    </label>
                    <textarea
                      id={`answer-${a.id}`}
                      rows={6}
                      value={drafts[a.id] ?? a.submissionText ?? ""}
                      onChange={(e) =>
                        setDrafts((prev) => ({ ...prev, [a.id]: e.target.value }))
                      }
                      disabled={submittingId === a.id}
                      maxLength={20000}
                      placeholder="Type your answer here."
                      className="w-full rounded-xl border border-border bg-background px-3 py-2.5 text-sm text-text-primary outline-none focus:border-primary"
                    />
                    {/* ── Attachments ──────────────────────────────── */}
                    <div className="space-y-2 rounded-xl border border-dashed border-border p-3">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <span className="text-xs font-semibold uppercase text-text-muted">
                          Attach your work
                        </span>
                        <label
                          className={cn(
                            "inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-border px-2.5 py-1.5 text-xs font-semibold text-text-secondary transition-colors hover:bg-border/40",
                            uploadingId === a.id && "pointer-events-none opacity-60",
                          )}
                        >
                          {uploadingId === a.id ? (
                            <>
                              <Spinner size="sm" /> Uploading...
                            </>
                          ) : (
                            <>
                              <Upload className="h-3.5 w-3.5" /> Choose files
                            </>
                          )}
                          <input
                            type="file"
                            multiple
                            accept={ACCEPT_ATTRIBUTE}
                            className="hidden"
                            disabled={uploadingId === a.id}
                            onChange={(e) => {
                              uploadFiles(a.id, e.target.files);
                              // Let the same file be chosen again after a
                              // failed upload.
                              e.target.value = "";
                            }}
                          />
                        </label>
                      </div>

                      <SubmissionFiles
                        files={a.files as SubmissionFileItem[]}
                        onRemove={(fileId) => removeFile(a.id, fileId)}
                        removingId={removingFileId}
                        emptyLabel={`Photograph your working or attach a document. ${ACCEPTED_LABEL}, up to ${Math.floor(
                          MAX_FILE_BYTES / (1024 * 1024),
                        )} MB each.`}
                      />
                    </div>

                    {a.submittedAt && (
                      <p className="text-xs text-text-muted">
                        Handed in {new Date(a.submittedAt).toLocaleString()}. You can
                        still change it until your teacher marks it.
                      </p>
                    )}
                  </div>
                )}

                <div className="flex flex-wrap items-center justify-between gap-3">
                  <span className="inline-flex items-center gap-1.5 text-xs text-text-muted">
                    <CalendarDays className="h-3.5 w-3.5" />
                    {a.dueAt
                      ? `Due ${new Date(a.dueAt).toLocaleDateString()}`
                      : "No due date"}
                  </span>

                  {a.format === "DOCUMENT" ? (
                    <div className="print-hide flex flex-wrap items-center gap-2">
                      <Button
                        type="button"
                        variant="outline"
                        onClick={() => setOpenId(openId === a.id ? null : a.id)}
                      >
                        <FileText className="mr-1.5 h-4 w-4" />
                        {openId === a.id ? "Hide" : "Read"}
                      </Button>
                      {a.requiresSubmission ? (
                        <Button
                          type="button"
                          onClick={() => submitAnswer(a)}
                          disabled={submittingId === a.id}
                        >
                          {submittingId === a.id ? (
                            <Spinner size="sm" />
                          ) : (
                            <>
                              <Check className="mr-1.5 h-4 w-4" />
                              {a.submittedAt ? "Update answer" : "Hand in"}
                            </>
                          )}
                        </Button>
                      ) : (
                        <Button
                          type="button"
                          onClick={() => markDone(a, true)}
                          disabled={markingId === a.id}
                        >
                          {markingId === a.id ? (
                            <Spinner size="sm" />
                          ) : (
                            <>
                              <Check className="mr-1.5 h-4 w-4" /> Mark as done
                            </>
                          )}
                        </Button>
                      )}
                    </div>
                  ) : (
                  <Button
                    type="button"
                    onClick={() => open(a)}
                    disabled={startingId === a.id}
                  >
                    {startingId === a.id ? (
                      <Spinner size="sm" />
                    ) : (
                      <>
                        <Play className="mr-1.5 h-4 w-4" />
                        {a.state === "in_progress" ? "Continue" : "Start"}
                      </>
                    )}
                  </Button>
                  )}
                </div>
              </CardContent>
            </Card>
          ))}

          {done.length > 0 && (
            <div className="pt-2">
              <h2 className="mb-2 text-xs font-semibold uppercase text-text-muted">
                Completed
              </h2>
              <Card>
                <CardContent>
                  <ul className="divide-y divide-border">
                    {done.map((a) => (
                      <li
                        key={a.id}
                        id={`activity-${a.id}`}
                        className={cn(
                          "flex items-center justify-between gap-3 py-2.5",
                          highlightId === a.id && "rounded-lg bg-primary/10 px-2",
                        )}
                      >
                        <div className="flex min-w-0 items-center gap-2">
                          <CheckCircle2 className="h-4 w-4 shrink-0 text-green-600" />
                          <div className="min-w-0">
                            <p className="truncate text-sm font-medium text-text-primary">
                              {a.title}
                            </p>
                            <p className="text-[11px] text-text-muted">{a.subject}</p>
                            {a.feedback && (
                              <p className="mt-1 rounded-lg bg-border/30 px-2 py-1 text-xs text-text-secondary">
                                <span className="font-semibold">Feedback:</span>{" "}
                                {a.feedback}
                              </p>
                            )}
                          </div>
                        </div>
                        <span
                          className={cn(
                            "shrink-0 rounded-full bg-border/50 px-2 py-0.5 text-xs font-bold text-text-secondary",
                          )}
                        >
                          {a.format !== "DOCUMENT"
                            ? `${a.correctAnswers}/${a.totalQuestions}`
                            : a.markedAt
                              ? a.marks !== null && a.maxMarks
                                ? `${a.marks}/${a.maxMarks}`
                                : "Marked"
                              : "Done"}
                        </span>
                      </li>
                    ))}
                  </ul>
                </CardContent>
              </Card>
            </div>
          )}
        </>
      )}
    </div>
  );
}
