"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { ChevronLeft, AlertTriangle, Check, Pencil, Trash2, ImagePlus, Plus, RefreshCw, Download } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Spinner } from "@/components/ui/spinner";
import { MathText } from "@/components/ui/math-text";
import { toast } from "@/components/ui/sonner";
import { cn } from "@/lib/utils";

const LETTERS = ["A", "B", "C", "D", "E", "F"];

interface Question {
  id: string;
  number: number;
  questionText: string;
  options: string[];
  correctAnswer: string | null;
  explanation: string | null;
  needsReview: boolean;
  reviewNote: string | null;
  hasImage: boolean;
  updatedAt: string;
}

interface Exam {
  id: string;
  subject: string;
  yearLabel: string;
  stream: string | null;
  durationMinutes: number;
  status: "EXTRACTING" | "REVIEW" | "PUBLISHED" | "FAILED";
  extractionError: string | null;
  hasSourceFile: boolean;
  attemptCount: number;
  questions: Question[];
}

const selectClass =
  "w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-text-primary outline-none focus:border-primary focus:ring-1 focus:ring-primary";
const textareaClass =
  "w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-text-primary outline-none focus:border-primary focus:ring-1 focus:ring-primary";

async function api(url: string, init?: RequestInit) {
  const r = await fetch(url, init);
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(d.error || "Request failed");
  return d;
}

/** Super admin review of one uploaded paper: fix questions and answers, attach figures, publish. */
export default function AdminNationalExamReviewPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [exam, setExam] = useState<Exam | null>(null);
  const [onlyFlagged, setOnlyFlagged] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [meta, setMeta] = useState({ subject: "", yearLabel: "", stream: "", durationMinutes: "120" });
  const [adding, setAdding] = useState(false);

  const load = useCallback(async () => {
    try {
      const d = await api(`/api/admin/national-exams/${id}`);
      setExam(d.exam);
      setMeta({
        subject: d.exam.subject,
        yearLabel: d.exam.yearLabel,
        stream: d.exam.stream ?? "",
        durationMinutes: String(d.exam.durationMinutes),
      });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not load");
    }
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (exam?.status !== "EXTRACTING") return;
    const timer = setInterval(load, 5000);
    return () => clearInterval(timer);
  }, [exam?.status, load]);

  const run = async (key: string, fn: () => Promise<unknown>, success?: string) => {
    setBusy(key);
    try {
      await fn();
      if (success) toast.success(success);
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setBusy(null);
    }
  };

  const json = (method: string, body?: unknown): RequestInit => ({
    method,
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  if (!exam) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <Spinner size="lg" className="text-primary" />
      </div>
    );
  }

  const flagged = exam.questions.filter((q) => q.needsReview).length;
  const unanswered = exam.questions.filter((q) => !q.correctAnswer).length;
  const shown = onlyFlagged ? exam.questions.filter((q) => q.needsReview) : exam.questions;
  const published = exam.status === "PUBLISHED";

  return (
    <div className="mx-auto max-w-5xl space-y-6 p-4 sm:p-6">
      <Link href="/admin/national-exams" className="flex items-center gap-1 text-sm text-text-secondary hover:text-primary">
        <ChevronLeft className="h-4 w-4" /> All papers
      </Link>

      {/* Paper details and actions */}
      <Card>
        <CardContent className="space-y-4 py-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-xl font-bold text-text-primary">
                {exam.subject} · {exam.yearLabel}
              </h1>
              <Badge variant={published ? "success" : exam.status === "FAILED" ? "error" : exam.status === "EXTRACTING" ? "info" : "warning"}>
                {published ? "Published" : exam.status === "EXTRACTING" ? "Reading PDF…" : exam.status === "FAILED" ? "Failed" : "In review"}
              </Badge>
            </div>
            <div className="flex flex-wrap gap-2">
              {exam.hasSourceFile && (
                <a href={`/api/admin/national-exams/${id}/source`}>
                  <Button size="sm" variant="outline">
                    <Download className="mr-1 h-4 w-4" /> Original PDF
                  </Button>
                </a>
              )}
              {!published && exam.status !== "EXTRACTING" && exam.hasSourceFile && (
                <Button
                  size="sm"
                  variant="outline"
                  isLoading={busy === "reextract"}
                  onClick={() =>
                    window.confirm("Read the PDF again? This replaces every question, including your edits.") &&
                    run("reextract", () => api(`/api/admin/national-exams/${id}/reextract`, json("POST")), "Reading the PDF again…")
                  }
                >
                  <RefreshCw className="mr-1 h-4 w-4" /> Re-read PDF
                </Button>
              )}
              {exam.status === "REVIEW" && (
                <Button
                  size="sm"
                  isLoading={busy === "publish"}
                  onClick={() => run("publish", () => api(`/api/admin/national-exams/${id}`, json("PATCH", { action: "publish" })), "Published to students.")}
                >
                  Publish
                </Button>
              )}
              {published && (
                <Button
                  size="sm"
                  variant="outline"
                  isLoading={busy === "unpublish"}
                  onClick={() => run("unpublish", () => api(`/api/admin/national-exams/${id}`, json("PATCH", { action: "unpublish" })), "Hidden from students.")}
                >
                  Unpublish
                </Button>
              )}
              <Button
                size="sm"
                variant="ghost"
                isLoading={busy === "delete"}
                onClick={() =>
                  window.confirm(`Delete this paper${exam.attemptCount ? ` and ${exam.attemptCount} student attempts` : ""}? This cannot be undone.`) &&
                  run("delete", async () => {
                    await api(`/api/admin/national-exams/${id}`, json("DELETE"));
                    router.push("/admin/national-exams");
                  })
                }
              >
                <Trash2 className="h-4 w-4 text-error" />
              </Button>
            </div>
          </div>

          {exam.status === "FAILED" && <p className="text-sm text-error">{exam.extractionError}</p>}
          {exam.status === "EXTRACTING" && (
            <p className="flex items-center gap-2 text-sm text-text-secondary">
              <Spinner size="sm" className="text-primary" /> Reading the paper and its answers. This page refreshes on its own.
            </p>
          )}

          <div className="grid gap-3 sm:grid-cols-5">
            <div className="sm:col-span-2">
              <label className="text-xs font-semibold uppercase text-text-muted">Subject</label>
              <Input value={meta.subject} onChange={(e) => setMeta({ ...meta, subject: e.target.value })} />
            </div>
            <div>
              <label className="text-xs font-semibold uppercase text-text-muted">Year</label>
              <Input value={meta.yearLabel} onChange={(e) => setMeta({ ...meta, yearLabel: e.target.value })} />
            </div>
            <div>
              <label className="text-xs font-semibold uppercase text-text-muted">Stream</label>
              <select value={meta.stream} onChange={(e) => setMeta({ ...meta, stream: e.target.value })} className={selectClass}>
                <option value="">Both / common</option>
                <option value="NATURAL">Natural</option>
                <option value="SOCIAL">Social</option>
              </select>
            </div>
            <div>
              <label className="text-xs font-semibold uppercase text-text-muted">Minutes</label>
              <Input type="number" value={meta.durationMinutes} onChange={(e) => setMeta({ ...meta, durationMinutes: e.target.value })} />
            </div>
          </div>
          <Button
            size="sm"
            variant="outline"
            isLoading={busy === "meta"}
            onClick={() =>
              run(
                "meta",
                () => api(`/api/admin/national-exams/${id}`, json("PATCH", { ...meta, durationMinutes: Number(meta.durationMinutes) })),
                "Saved.",
              )
            }
          >
            Save details
          </Button>
        </CardContent>
      </Card>

      {exam.status !== "EXTRACTING" && (
        <>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm text-text-secondary">
              {exam.questions.length} questions
              {flagged > 0 && <span className="text-warning"> · {flagged} to check</span>}
              {unanswered > 0 && <span className="text-error"> · {unanswered} without an answer</span>}
            </p>
            <div className="flex gap-2">
              <Button size="sm" variant={onlyFlagged ? "primary" : "outline"} onClick={() => setOnlyFlagged((v) => !v)}>
                <AlertTriangle className="mr-1 h-4 w-4" /> Only to check
              </Button>
              {!published && (
                <Button size="sm" variant="outline" onClick={() => setAdding(true)}>
                  <Plus className="mr-1 h-4 w-4" /> Add question
                </Button>
              )}
            </div>
          </div>

          {adding && (
            <QuestionEditor
              examId={id}
              published={published}
              onDone={() => {
                setAdding(false);
                load();
              }}
              onCancel={() => setAdding(false)}
            />
          )}

          <div className="space-y-3">
            {shown.map((q) => (
              <QuestionCard key={q.id} examId={id} q={q} published={published} reload={load} />
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function QuestionCard({ examId, q, published, reload }: { examId: string; q: Question; published: boolean; reload: () => void }) {
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const base = `/api/admin/national-exams/${examId}/questions/${q.id}`;

  const act = async (fn: () => Promise<Response>) => {
    setBusy(true);
    try {
      const r = await fn();
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || "Request failed");
      reload();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setBusy(false);
    }
  };

  if (editing) {
    return <QuestionEditor examId={examId} q={q} published={published} onDone={() => { setEditing(false); reload(); }} onCancel={() => setEditing(false)} />;
  }

  return (
    <Card className={cn(q.needsReview && "border-warning")}>
      <CardContent className="space-y-3 py-4">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <p className="text-sm font-semibold text-primary">Question {q.number}</p>
          <div className="flex flex-wrap gap-1">
            {q.needsReview && (
              <Button size="sm" variant="outline" disabled={busy} onClick={() => act(() => fetch(base, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ needsReview: false }) }))}>
                <Check className="mr-1 h-4 w-4" /> Checked
              </Button>
            )}
            <Button size="sm" variant="ghost" onClick={() => setEditing(true)} aria-label="Edit">
              <Pencil className="h-4 w-4" />
            </Button>
            <Button size="sm" variant="ghost" disabled={busy} onClick={() => fileRef.current?.click()} aria-label="Attach figure">
              <ImagePlus className="h-4 w-4" />
            </Button>
            {!published && (
              <Button size="sm" variant="ghost" disabled={busy} aria-label="Delete" onClick={() => window.confirm(`Delete question ${q.number}?`) && act(() => fetch(base, { method: "DELETE" }))}>
                <Trash2 className="h-4 w-4 text-error" />
              </Button>
            )}
            <input
              ref={fileRef}
              type="file"
              accept="image/png,image/jpeg,image/webp"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (!file) return;
                const form = new FormData();
                form.append("file", file);
                act(() => fetch(`${base}/image`, { method: "POST", body: form }));
                e.target.value = "";
              }}
            />
          </div>
        </div>
        {q.needsReview && q.reviewNote && (
          <p className="flex items-start gap-1 rounded-md bg-yellow-50 px-2 py-1 text-xs text-warning">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" /> {q.reviewNote}
          </p>
        )}
        <div className="whitespace-pre-line text-sm text-text-primary">
          <MathText text={q.questionText} />
        </div>
        {q.hasImage && (
          <div className="flex items-start gap-2">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={`/api/national-exams/images/${q.id}?v=${encodeURIComponent(q.updatedAt)}`} alt={`Figure for question ${q.number}`} className="max-h-60 rounded border border-border" />
            <Button size="sm" variant="ghost" disabled={busy} onClick={() => act(() => fetch(`${base}/image`, { method: "DELETE" }))}>
              Remove
            </Button>
          </div>
        )}
        <div className="space-y-1">
          {q.options.map((opt, i) => (
            <div key={i} className={cn("flex gap-2 rounded-md border px-3 py-1.5 text-sm", opt === q.correctAnswer ? "border-success bg-green-50" : "border-border")}>
              <span className="font-bold text-text-secondary">{LETTERS[i]}.</span>
              <MathText text={opt} />
            </div>
          ))}
        </div>
        {!q.correctAnswer && <p className="text-xs font-medium text-error">No answer set.</p>}
        {q.explanation && (
          <div className="rounded-md bg-gray-50 p-2 text-xs text-text-secondary dark:bg-gray-800">
            <MathText text={q.explanation} />
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function QuestionEditor({
  examId,
  q,
  published,
  onDone,
  onCancel,
}: {
  examId: string;
  q?: Question;
  published: boolean;
  onDone: () => void;
  onCancel: () => void;
}) {
  const [number, setNumber] = useState(q ? String(q.number) : "");
  const [text, setText] = useState(q?.questionText ?? "");
  const [options, setOptions] = useState<string[]>(q?.options ?? ["", "", "", ""]);
  const [answerIdx, setAnswerIdx] = useState<number>(q?.correctAnswer ? q.options.indexOf(q.correctAnswer) : -1);
  const [explanation, setExplanation] = useState(q?.explanation ?? "");
  const [saving, setSaving] = useState(false);

  const save = async () => {
    const trimmed = options.map((o) => o.trim());
    const body = {
      ...(number ? { number: Number(number) } : {}),
      questionText: text,
      options: trimmed,
      correctAnswer: answerIdx >= 0 ? trimmed[answerIdx] : null,
      explanation,
      ...(q ? { needsReview: false } : {}),
    };
    setSaving(true);
    try {
      const url = q ? `/api/admin/national-exams/${examId}/questions/${q.id}` : `/api/admin/national-exams/${examId}/questions`;
      const r = await fetch(url, { method: q ? "PATCH" : "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || "Save failed");
      toast.success("Saved.");
      onDone();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card className="border-primary">
      <CardContent className="space-y-3 py-4">
        <div className="flex items-center gap-2">
          <label className="text-xs font-semibold uppercase text-text-muted">No.</label>
          <Input className="w-20" type="number" value={number} onChange={(e) => setNumber(e.target.value)} placeholder="auto" />
          <span className="text-xs text-text-secondary">Maths: write LaTeX between \( and \)</span>
        </div>
        <textarea className={textareaClass} rows={5} value={text} onChange={(e) => setText(e.target.value)} placeholder="Question text" />
        <div className="space-y-2">
          {options.map((opt, i) => (
            <div key={i} className="flex items-center gap-2">
              <input
                type="radio"
                name={`answer-${q?.id ?? "new"}`}
                checked={answerIdx === i}
                onChange={() => setAnswerIdx(i)}
                aria-label={`Option ${LETTERS[i]} is correct`}
              />
              <span className="w-5 text-sm font-bold text-text-secondary">{LETTERS[i]}.</span>
              <Input value={opt} onChange={(e) => setOptions(options.map((o, j) => (j === i ? e.target.value : o)))} />
              {options.length > 2 && !published && (
                <Button
                  size="sm"
                  variant="ghost"
                  aria-label="Remove option"
                  onClick={() => {
                    setOptions(options.filter((_, j) => j !== i));
                    setAnswerIdx(answerIdx === i ? -1 : answerIdx > i ? answerIdx - 1 : answerIdx);
                  }}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              )}
            </div>
          ))}
          {options.length < LETTERS.length && (
            <Button size="sm" variant="ghost" onClick={() => setOptions([...options, ""])}>
              <Plus className="mr-1 h-4 w-4" /> Option
            </Button>
          )}
          <p className="text-xs text-text-secondary">Select the circle next to the correct option.</p>
        </div>
        <textarea className={textareaClass} rows={3} value={explanation} onChange={(e) => setExplanation(e.target.value)} placeholder="Explanation shown to students" />
        {text && (
          <div className="rounded-md border border-dashed border-border p-2 text-sm">
            <p className="mb-1 text-xs text-text-secondary">Preview</p>
            <div className="whitespace-pre-line">
              <MathText text={text} />
            </div>
          </div>
        )}
        <div className="flex gap-2">
          <Button size="sm" onClick={save} isLoading={saving}>
            Save
          </Button>
          <Button size="sm" variant="outline" onClick={onCancel}>
            Cancel
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
