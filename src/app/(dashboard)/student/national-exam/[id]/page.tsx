"use client";

import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { ChevronLeft, ChevronRight, Flag, Send, Timer, CheckCircle2, XCircle } from "lucide-react";
import { useTranslations } from "next-intl";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
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
  hasImage: boolean;
}

interface Feedback {
  isCorrect: boolean;
  correctAnswer: string | null;
  explanation: string | null;
}

interface AttemptData {
  attemptId: string;
  startedAt: string;
  mode: "EXAM" | "PRACTICE";
  exam: { id: string; subject: string; yearLabel: string; stream: string | null; durationMinutes: number };
  questions: Question[];
}

function formatClock(seconds: number): string {
  const s = Math.max(0, seconds);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return `${h > 0 ? `${h}:` : ""}${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
}

/**
 * Taking a past paper. EXAM mode: timed like the real exam, answers checked
 * only on submit (auto-submitted when time runs out). PRACTICE mode: untimed,
 * each answer is checked straight away with its explanation.
 */
export default function TakeNationalExamPageWrapper() {
  return (
    <Suspense fallback={null}>
      <TakeNationalExamPage />
    </Suspense>
  );
}

function TakeNationalExamPage() {
  const t = useTranslations("nationalExam");
  const router = useRouter();
  const { id } = useParams<{ id: string }>();
  const mode = useSearchParams().get("mode") === "PRACTICE" ? "PRACTICE" : "EXAM";

  const [data, setData] = useState<AttemptData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [index, setIndex] = useState(0);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [flags, setFlags] = useState<Set<string>>(new Set());
  const [feedback, setFeedback] = useState<Record<string, Feedback>>({});
  const [checking, setChecking] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [remaining, setRemaining] = useState<number | null>(null);
  const started = useRef(false);
  const submitted = useRef(false);

  // Start the attempt once.
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    fetch(`/api/national-exams/${id}/attempts`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mode }),
    })
      .then(async (r) => {
        const d = await r.json();
        if (!r.ok) throw new Error(d.error || "Could not start");
        setData(d);
      })
      .catch((e) => setError(e instanceof Error ? e.message : "Could not start"));
  }, [id, mode]);

  const submit = useCallback(
    async (auto = false) => {
      if (!data || submitted.current) return;
      submitted.current = true;
      setSubmitting(true);
      try {
        const r = await fetch(`/api/national-exams/attempts/${data.attemptId}/submit`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ answers }),
        });
        if (!r.ok) throw new Error((await r.json()).error || "Submit failed");
        if (auto) toast.info(t("timeUp"));
        router.replace(`/student/national-exam/result/${data.attemptId}`);
      } catch (e) {
        submitted.current = false;
        setSubmitting(false);
        toast.error(e instanceof Error ? e.message : "Submit failed");
      }
    },
    [data, answers, router, t],
  );

  // Exam timer, measured from the server's start time so a reload cannot reset it.
  useEffect(() => {
    if (!data || data.mode !== "EXAM") return;
    const end = new Date(data.startedAt).getTime() + data.exam.durationMinutes * 60_000;
    const tick = () => {
      const left = Math.round((end - Date.now()) / 1000);
      setRemaining(left);
      if (left <= 0) submit(true);
    };
    tick();
    const timer = setInterval(tick, 1000);
    return () => clearInterval(timer);
  }, [data, submit]);

  // Warn before leaving an unfinished exam.
  useEffect(() => {
    if (!data || data.mode !== "EXAM") return;
    const handler = (e: BeforeUnloadEvent) => {
      if (!submitted.current) {
        e.preventDefault();
        e.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [data]);

  const choose = async (q: Question, option: string) => {
    if (!data) return;
    if (data.mode === "EXAM") {
      setAnswers((a) => ({ ...a, [q.id]: option }));
      return;
    }
    if (feedback[q.id] || checking) return;
    setChecking(true);
    setAnswers((a) => ({ ...a, [q.id]: option }));
    try {
      const r = await fetch(`/api/national-exams/attempts/${data.attemptId}/answer`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ questionId: q.id, answer: option }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || "Could not check");
      setFeedback((f) => ({ ...f, [q.id]: d }));
    } catch (e) {
      setAnswers((a) => {
        const next = { ...a };
        delete next[q.id];
        return next;
      });
      toast.error(e instanceof Error ? e.message : "Could not check");
    } finally {
      setChecking(false);
    }
  };

  if (error) {
    return (
      <div className="flex min-h-[60vh] flex-col items-center justify-center gap-4 p-4 text-center">
        <p className="text-text-secondary">{error}</p>
        <Button variant="outline" onClick={() => router.push("/student/national-exam")}>{t("backToPapers")}</Button>
      </div>
    );
  }
  if (!data) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <Spinner size="lg" className="text-primary" />
      </div>
    );
  }

  const questions = data.questions;
  const q = questions[index];
  const fb = feedback[q.id];
  const answeredCount = Object.keys(answers).length;
  const lowTime = remaining !== null && remaining <= 300;

  const confirmSubmit = () => {
    const unanswered = questions.length - answeredCount;
    const msg = unanswered > 0 ? t("confirmSubmitUnanswered", { count: unanswered }) : t("confirmSubmit");
    if (window.confirm(msg)) submit();
  };

  return (
    <div className="mx-auto max-w-5xl space-y-4 p-4 sm:p-6">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-lg font-bold text-text-primary">
            {data.exam.subject} · {data.exam.yearLabel}
          </h1>
          <p className="text-sm text-text-secondary">
            {data.mode === "EXAM" ? t("examMode") : t("practiceMode")} · {t("answeredOf", { answered: answeredCount, total: questions.length })}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {remaining !== null && (
            <span
              className={cn(
                "flex items-center gap-1 rounded-lg px-3 py-1.5 font-mono text-sm font-semibold",
                lowTime ? "bg-red-100 text-error" : "bg-gray-100 text-text-primary",
              )}
            >
              <Timer className="h-4 w-4" /> {formatClock(remaining)}
            </span>
          )}
          <Button size="sm" onClick={confirmSubmit} isLoading={submitting}>
            <Send className="mr-1 h-4 w-4" /> {data.mode === "EXAM" ? t("submit") : t("finish")}
          </Button>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-[1fr_240px]">
        {/* Question */}
        <Card>
          <CardContent className="space-y-4 py-5">
            <div className="flex items-start justify-between gap-3">
              <p className="text-sm font-semibold text-primary">{t("questionN", { n: q.number })}</p>
              {data.mode === "EXAM" && (
                <button
                  onClick={() =>
                    setFlags((f) => {
                      const next = new Set(f);
                      if (next.has(q.id)) next.delete(q.id);
                      else next.add(q.id);
                      return next;
                    })
                  }
                  className={cn("flex items-center gap-1 text-xs", flags.has(q.id) ? "text-warning" : "text-text-secondary")}
                >
                  <Flag className="h-3.5 w-3.5" /> {flags.has(q.id) ? t("flagged") : t("flag")}
                </button>
              )}
            </div>
            <div className="whitespace-pre-line text-base text-text-primary">
              <MathText text={q.questionText} />
            </div>
            {q.hasImage && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={`/api/national-exams/images/${q.id}`} alt={t("figureAlt", { n: q.number })} className="max-h-80 rounded border border-border" />
            )}
            <div className="space-y-2">
              {q.options.map((opt, i) => {
                const chosen = answers[q.id] === opt;
                const isRight = fb && fb.correctAnswer === opt;
                const isWrongChoice = fb && chosen && !fb.isCorrect;
                return (
                  <button
                    key={i}
                    disabled={!!fb || checking}
                    onClick={() => choose(q, opt)}
                    className={cn(
                      "flex w-full items-start gap-3 rounded-lg border-2 p-3 text-left text-sm transition-colors sm:text-base",
                      isRight
                        ? "border-success bg-green-50"
                        : isWrongChoice
                          ? "border-error bg-red-50"
                          : chosen
                            ? "border-primary bg-primary/10"
                            : "border-border hover:border-primary/40",
                    )}
                  >
                    <span className="font-bold text-text-secondary">{LETTERS[i]}.</span>
                    <span className="flex-1">
                      <MathText text={opt} />
                    </span>
                    {isRight && <CheckCircle2 className="h-5 w-5 shrink-0 text-success" />}
                    {isWrongChoice && <XCircle className="h-5 w-5 shrink-0 text-error" />}
                  </button>
                );
              })}
            </div>
            {fb && (
              <div className={cn("rounded-lg p-3 text-sm", fb.isCorrect ? "bg-green-50 text-text-primary" : "bg-red-50 text-text-primary")}>
                <p className="mb-1 font-semibold">{fb.isCorrect ? t("correct") : t("incorrect")}</p>
                {fb.explanation && <MathText text={fb.explanation} />}
              </div>
            )}
            <div className="flex justify-between pt-2">
              <Button variant="outline" size="sm" disabled={index === 0} onClick={() => setIndex((i) => i - 1)}>
                <ChevronLeft className="mr-1 h-4 w-4" /> {t("previous")}
              </Button>
              <Button variant="outline" size="sm" disabled={index === questions.length - 1} onClick={() => setIndex((i) => i + 1)}>
                {t("next")} <ChevronRight className="ml-1 h-4 w-4" />
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* Navigator */}
        <Card className="h-fit">
          <CardContent className="py-4">
            <p className="mb-2 text-xs font-semibold uppercase text-text-secondary">{t("questions")}</p>
            <div className="grid grid-cols-6 gap-1.5 sm:grid-cols-10 lg:grid-cols-5">
              {questions.map((x, i) => {
                const f = feedback[x.id];
                return (
                  <button
                    key={x.id}
                    onClick={() => setIndex(i)}
                    className={cn(
                      "relative rounded-md border py-1.5 text-xs font-medium",
                      i === index && "ring-2 ring-primary",
                      f ? (f.isCorrect ? "border-success bg-green-100 text-success" : "border-error bg-red-100 text-error")
                        : answers[x.id] ? "border-primary bg-primary/15 text-primary" : "border-border text-text-secondary",
                    )}
                  >
                    {x.number}
                    {flags.has(x.id) && <span className="absolute -right-0.5 -top-0.5 h-2 w-2 rounded-full bg-warning" />}
                  </button>
                );
              })}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
