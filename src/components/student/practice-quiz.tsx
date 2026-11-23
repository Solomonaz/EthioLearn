"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { ArrowLeft, CheckCircle, PenLine, RotateCcw, XCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import { MathText } from "@/components/ui/math-text";
import { GuideSays } from "@/components/student/guide-mascot";
import type { PracticeQuestion } from "@/lib/whiteboard-lesson";

const LETTERS = ["A", "B", "C", "D"];

/**
 * Practice questions the guide made from an upload, one at a time. The guide
 * reacts to each answer; a wrong one can be explained on the whiteboard.
 * Nothing is saved as a graded quiz — it's practice.
 */
export function PracticeQuiz({
  questions,
  onBack,
  onExplain,
}: {
  questions: PracticeQuestion[];
  onBack: () => void;
  /** Explain this question on the whiteboard. */
  onExplain: (question: string) => void;
}) {
  const t = useTranslations("whiteboard");
  const [i, setI] = useState(0);
  const [picked, setPicked] = useState<number | null>(null);
  const [score, setScore] = useState(0);
  const [done, setDone] = useState(false);
  const q = questions[i];

  const choose = (k: number) => {
    if (picked !== null) return;
    setPicked(k);
    if (k === q.answer) setScore((s) => s + 1);
  };
  const next = () => {
    if (i < questions.length - 1) {
      setI(i + 1);
      setPicked(null);
    } else setDone(true);
  };
  const restart = () => {
    setI(0);
    setPicked(null);
    setScore(0);
    setDone(false);
  };

  const header = (
    <div className="flex items-center gap-2 border-b border-border px-4 py-3">
      <button
        type="button"
        onClick={onBack}
        className="flex h-9 items-center gap-1 rounded-full px-2 text-sm font-semibold text-text-secondary hover:bg-border/50"
        data-testid="practice-back"
      >
        <ArrowLeft className="h-4 w-4" /> {t("backToOptions")}
      </button>
      <p className="ml-auto text-sm font-semibold text-text-secondary">
        {done ? t("practiceDone") : t("questionOf", { n: i + 1, total: questions.length })}
      </p>
    </div>
  );

  if (done) {
    const great = score >= Math.ceil(questions.length * 0.8);
    const ok = score >= Math.ceil(questions.length * 0.5);
    return (
      <div className="flex h-full min-h-0 flex-col overflow-hidden rounded-2xl border border-border bg-surface" data-testid="practice-quiz">
        {header}
        <div className="flex flex-1 flex-col items-center justify-center gap-4 p-6 text-center">
          <GuideSays expression={great ? "proud" : ok ? "happy" : "concerned"} size={110}>
            {great ? t("practiceGreat") : ok ? t("practiceOk") : t("practiceLow")}
          </GuideSays>
          <p className="text-4xl font-black text-primary" data-testid="practice-score">
            {score}/{questions.length}
          </p>
          <div className="flex flex-wrap justify-center gap-2">
            <button type="button" onClick={restart} className="inline-flex items-center gap-1.5 rounded-full border border-border px-4 py-2 text-sm font-semibold text-text-secondary hover:bg-border/40">
              <RotateCcw className="h-4 w-4" /> {t("tryAgain")}
            </button>
            <button type="button" onClick={onBack} className="rounded-full bg-primary px-5 py-2 text-sm font-bold text-white hover:bg-primary-dark">
              {t("somethingElse")}
            </button>
          </div>
        </div>
      </div>
    );
  }

  const answered = picked !== null;
  const right = answered && picked === q.answer;
  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden rounded-2xl border border-border bg-surface" data-testid="practice-quiz">
      {header}
      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4">
        <div className="h-1.5 w-full overflow-hidden rounded-full bg-border">
          <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${((i + (answered ? 1 : 0)) / questions.length) * 100}%` }} />
        </div>
        <p className="text-base font-semibold leading-relaxed text-text-primary" data-testid="practice-question">
          <MathText text={q.question} />
        </p>
        <div className="space-y-2">
          {q.options.map((o, k) => {
            const isRight = answered && k === q.answer;
            const isWrongPick = answered && k === picked && k !== q.answer;
            return (
              <button
                key={k}
                type="button"
                onClick={() => choose(k)}
                disabled={answered}
                className={cn(
                  "flex w-full items-center gap-3 rounded-xl border px-3 py-3 text-left text-sm transition-colors",
                  !answered && "border-border hover:border-primary/50 hover:bg-primary/5",
                  isRight && "border-success bg-success/10 font-semibold text-success",
                  isWrongPick && "border-error bg-error/10 text-error",
                  answered && !isRight && !isWrongPick && "border-border opacity-60",
                )}
                data-testid="practice-option"
              >
                <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-current text-xs font-bold">{LETTERS[k]}</span>
                <span className="min-w-0 flex-1"><MathText text={o} /></span>
                {isRight && <CheckCircle className="h-5 w-5 shrink-0" />}
                {isWrongPick && <XCircle className="h-5 w-5 shrink-0" />}
              </button>
            );
          })}
        </div>
        {answered && (
          <div className="space-y-3" data-testid="practice-feedback">
            <GuideSays expression={right ? "proud" : "shocked"} size={64}>
              {right ? t("practiceRight") : t("practiceWrong")}
            </GuideSays>
            {q.explanation && (
              <p className="rounded-xl bg-primary/5 px-3 py-2 text-sm text-text-primary">
                <MathText text={q.explanation} />
              </p>
            )}
            <div className="flex flex-wrap gap-2">
              {!right && (
                <button
                  type="button"
                  onClick={() => onExplain(q.question)}
                  className="inline-flex items-center gap-1.5 rounded-full border border-primary/40 px-4 py-2 text-sm font-semibold text-primary hover:bg-primary/5"
                >
                  <PenLine className="h-4 w-4" /> {t("explainThis")}
                </button>
              )}
              <button type="button" onClick={next} className="ml-auto rounded-full bg-primary px-5 py-2 text-sm font-bold text-white hover:bg-primary-dark" data-testid="practice-next">
                {i < questions.length - 1 ? t("next") : t("seeScore")}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
