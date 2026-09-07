"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useRouter, useParams } from "next/navigation";
import Link from "next/link";
import { ChevronLeft, ChevronRight, Send, AlertTriangle, Timer } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ProgressBar } from "@/components/ui/progress-bar";
import { Spinner } from "@/components/ui/spinner";
import { useQuizStore } from "@/stores/quiz-store";
import { getQuestionSeconds } from "@/lib/quiz-timing";
import { cn } from "@/lib/utils";
import { useAntiCheat } from "@/lib/useAntiCheat";
import { useTranslations } from "next-intl";

const OPTION_LABELS = ["A", "B", "C", "D", "E", "F"];

/**
 * Renders text with underscores replaced by inline input fields.
 */
function FillInBlankRenderer({ text, value, onChange }: { text: string; value: string; onChange: (val: string) => void }) {
  // Find underscores (e.g., "The ____ is...")
  const parts = text.split(/_{3,}/g);
  if (parts.length < 2) return <span>{text}</span>;

  return (
    <div className="flex flex-wrap items-center gap-1">
      {parts.map((part, i) => (
        <span key={i} className="flex items-center gap-2">
          {part}
          {i < parts.length - 1 && (
            <input
              type="text"
              autoFocus={i === 0}
              className="inline-block min-w-[120px] border-b-2 border-primary bg-transparent px-2 py-1 text-center font-bold text-primary focus:outline-none"
              value={value}
              onChange={(e) => onChange(e.target.value)}
              placeholder="type here..."
            />
          )}
        </span>
      ))}
    </div>
  );
}

/**
 * Interface for matching two columns (e.g., A:1|B:2).
 */
function MatchPairsInterface({ options, value, onChange }: { options: any[]; value: string; onChange: (val: string) => void }) {
  const [selectedLeft, setSelectedLeft] = useState<string | null>(null);
  const [shuffledRight, setShuffledRight] = useState<string[]>([]);

  const pairs = value.split("|").filter(Boolean).reduce((acc, p) => {
    const [l, r] = p.split(":");
    acc[l] = r;
    return acc;
  }, {} as Record<string, string>);

  const allItems = options.map(o => o.text);
  let leftItems: string[] = [];
  let rightItems: string[] = [];

  // Try to parse pairs from options first (Correct format)
  const parsedPairs = options.map(o => o.text).filter(t => t.includes(":"));
  if (parsedPairs.length > 0) {
    leftItems = parsedPairs.map(p => p.split(":")[0]);
    rightItems = parsedPairs.map(p => p.split(":")[1]);
  } else {
    // Balanced split: first half is Column A, second half is Column B.
    // The AI is now instructed to provide them in this order.
    const mid = Math.floor(allItems.length / 2);
    leftItems = allItems.slice(0, mid);
    rightItems = allItems.slice(mid);
  }

  // Shuffle right items once
  useEffect(() => {
    if (rightItems.length > 0 && shuffledRight.length === 0) {
      setShuffledRight([...rightItems].sort(() => Math.random() - 0.5));
    }
  }, [rightItems, shuffledRight.length]);

  const handlePair = (right: string) => {
    if (!selectedLeft) return;
    const newPairs = { ...pairs, [selectedLeft]: right };
    const serialized = Object.entries(newPairs).map(([l, r]) => `${l}:${r}`).join("|");
    onChange(serialized);
    setSelectedLeft(null);
  };

  return (
    <div className="grid grid-cols-2 gap-4 sm:gap-8">
      <div className="space-y-3">
        <p className="text-xs font-bold uppercase tracking-wider text-text-secondary text-center">Column A</p>
        {leftItems.map((item) => (
          <button
            key={item}
            className={cn(
              "w-full rounded-lg border-2 p-3 text-left text-sm transition-all sm:text-base",
              selectedLeft === item ? "border-primary bg-primary/10 shadow-sm" : pairs[item] ? "border-success bg-success/5 opacity-60" : "border-border hover:border-primary/40"
            )}
            onClick={() => setSelectedLeft(item)}
          >
            {item}
          </button>
        ))}
      </div>
      <div className="space-y-3">
        <p className="text-xs font-bold uppercase tracking-wider text-text-secondary text-center">Column B</p>
        {(shuffledRight.length > 0 ? shuffledRight : rightItems).map((item) => {
          const isPaired = Object.values(pairs).includes(item);
          return (
            <button
              key={item}
              className={cn(
                "w-full rounded-lg border-2 p-3 text-left text-sm transition-all sm:text-base",
                isPaired ? "border-success bg-success/5 opacity-60" : "border-border hover:border-primary/40"
              )}
              onClick={() => handlePair(item)}
              disabled={isPaired}
            >
              {item}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/**
 * Interface for ordering a list of items.
 */
function OrderingInterface({ options, value, onChange }: { options: any[]; value: string; onChange: (val: string) => void }) {
  const items = value ? value.split("|") : options.map(o => o.text);

  // The list on screen is already a complete ordering, so it is already an
  // answer — record it as soon as the question is shown.
  //
  // Without this, a student who reads an ordering question and leaves it as
  // presented submits an EMPTY answer: the question is counted unanswered
  // ("17/19 answered" on a 19-question quiz), and because the grader compares
  // the submitted string to the correct sequence, it is marked wrong no matter
  // what — including when the presented order happens to be right and not
  // touching it was the correct decision.
  useEffect(() => {
    if (!value && options.length > 0) {
      onChange(options.map((o) => o.text).join("|"));
    }
    // `onChange` is recreated each render; the `!value` guard is what stops
    // this after the first write, not the dependency list.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, options]);

  const move = (index: number, direction: -1 | 1) => {
    const newItems = [...items];
    const targetIndex = index + direction;
    if (targetIndex < 0 || targetIndex >= items.length) return;
    [newItems[index], newItems[targetIndex]] = [newItems[targetIndex], newItems[index]];
    onChange(newItems.join("|"));
  };

  return (
    <div className="space-y-3">
      <p className="text-sm font-medium text-text-secondary">Arrange the items in correct order:</p>
      {items.map((item, index) => (
        <div key={item} className="flex items-center gap-3 rounded-xl border-2 border-border bg-surface p-4">
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-gray-100 text-sm font-bold text-text-secondary">
            {index + 1}
          </span>
          <span className="flex-1 text-sm font-medium text-text-primary">{item}</span>
          <div className="flex gap-1">
            <Button variant="outline" size="sm" onClick={() => move(index, -1)} disabled={index === 0}>
              <ChevronLeft className="h-4 w-4 rotate-90" />
            </Button>
            <Button variant="outline" size="sm" onClick={() => move(index, 1)} disabled={index === items.length - 1}>
              <ChevronLeft className="h-4 w-4 -rotate-90" />
            </Button>
          </div>
        </div>
      ))}
    </div>
  );
}

export default function QuizTakingPage() {
  const t = useTranslations("quiz");
  const tc = useTranslations("common");
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const quizId = params.id;

  const questions = useQuizStore((s) => s.questions);
  const currentIndex = useQuizStore((s) => s.currentIndex);
  const answers = useQuizStore((s) => s.answers);
  const isSubmitting = useQuizStore((s) => s.isSubmitting);
  const selectAnswer = useQuizStore((s) => s.selectAnswer);
  const nextQuestion = useQuizStore((s) => s.nextQuestion);
  const previousQuestion = useQuizStore((s) => s.previousQuestion);
  const getSubmitPayload = useQuizStore((s) => s.getSubmitPayload);
  const setSubmitting = useQuizStore((s) => s.setSubmitting);
  const reset = useQuizStore((s) => s.reset);
  const mode = useQuizStore((s) => s.mode);
  const timeLeft = useQuizStore((s) => s.timeLeft);
  const timerActive = useQuizStore((s) => s.timerActive);
  const setTimeLeft = useQuizStore((s) => s.setTimeLeft);
  const setTimerActive = useQuizStore((s) => s.setTimerActive);
  const notice = useQuizStore((s) => s.notice);
  const dismissNotice = useQuizStore((s) => s.dismissNotice);

  const [showConfirm, setShowConfirm] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  // Derived values (safe even when questions is empty)
  const hasQuestions = questions && questions.length > 0;
  const currentQuestion = hasQuestions ? questions[currentIndex] : null;
  // Per-question time budget (heavier questions get more time in TIMED mode).
  const questionSeconds = currentQuestion ? getQuestionSeconds(currentQuestion) : 30;

  // ── Anti-cheat ───────────────────────────────────────────────────────────
  // Use a mutable ref so the hook always calls the latest handleSubmit
  // without creating a circular dependency.
  const handleSubmitRef = useRef<() => void>(() => {});
  const { resetViolations } = useAntiCheat({
    onAutoSubmit: useCallback(() => handleSubmitRef.current(), []),
    enabled: hasQuestions && !isSubmitting,
  });
  const totalQuestions = questions.length;
  const isLastQuestion = currentIndex === totalQuestions - 1;
  const isFirstQuestion = currentIndex === 0;
  const progress = totalQuestions > 0 ? ((currentIndex + 1) / totalQuestions) * 100 : 0;
  const currentAnswer = currentQuestion ? answers.get(currentQuestion.id) : undefined;
  const answeredCount = answers.size;

  function handleSelectAnswer(answerText: string) {
    if (currentQuestion) selectAnswer(currentQuestion.id, answerText);
  }

  function handleNext() {
    if (isLastQuestion) {
      setShowConfirm(true);
    } else {
      nextQuestion();
    }
  }

  const handleSubmit = useCallback(async () => {
    resetViolations(); // clear anti-cheat state before submit
    setTimerActive(false);
    setSubmitting(true);
    setSubmitError(null);

    try {
      const payload = getSubmitPayload();
      const res = await fetch(`/api/quizzes/${quizId}/submit`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ answers: payload }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Failed to submit quiz");
      }

      const results = await res.json();

      // Store results in sessionStorage for the results page
      sessionStorage.setItem(
        `quiz-results-${quizId}`,
        JSON.stringify(results)
      );

      reset();
      router.push(`/student/quiz/${quizId}/results`);
    } catch (err) {
      setSubmitError(
        err instanceof Error ? err.message : "Failed to submit quiz"
      );
      setSubmitting(false);
    }
  }, [quizId, getSubmitPayload, setSubmitting, setTimerActive, reset, router, resetViolations]);

  // Keep the anti-cheat ref always up-to-date
  handleSubmitRef.current = handleSubmit;

  // Timer countdown effect
  useEffect(() => {
    if (mode !== "TIMED" || !timerActive) return;

    if (timeLeft <= 0) {
      // Auto-advance: if on last question, submit; otherwise next.
      // The question-change effect below resets the countdown to the new
      // question's budget, so no explicit reset is needed here.
      if (currentIndex >= questions.length - 1) {
        handleSubmit();
      } else {
        nextQuestion();
      }
      return;
    }

    const interval = setInterval(() => {
      setTimeLeft(timeLeft - 1);
    }, 1000);

    return () => clearInterval(interval);
  }, [timeLeft, timerActive, mode, currentIndex, questions.length, nextQuestion, setTimeLeft, handleSubmit]);

  // Reset timer to the current question's budget when the question changes.
  useEffect(() => {
    if (mode === "TIMED") {
      setTimeLeft(questionSeconds);
      setTimerActive(true);
    }
  }, [currentIndex, mode, questionSeconds, setTimeLeft, setTimerActive]);

  // If no quiz loaded — render AFTER all hooks
  if (!hasQuestions || !currentQuestion) {
    return (
      <div className="flex min-h-[60vh] flex-col items-center justify-center gap-4 p-4">
        <AlertTriangle className="h-12 w-12 text-warning" />
        <h2 className="text-lg font-semibold text-text-primary">
          Quiz not found
        </h2>
        <p className="text-sm text-text-secondary">
          This quiz may have expired or was not loaded properly.
        </p>
        <Link href="/student/quiz">
          <Button variant="primary">Start a New Quiz</Button>
        </Link>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-2xl p-4 sm:p-6">
      {/* Confirmation Overlay */}
      {showConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <Card className="w-full max-w-sm">
            <CardContent className="py-6 text-center">
              <AlertTriangle className="mx-auto mb-3 h-10 w-10 text-warning" />
              <h3 className="text-lg font-semibold text-text-primary">
                {t("submit")}
              </h3>
              <p className="mt-2 text-sm text-text-secondary">
                You answered {answeredCount} of {totalQuestions} questions.
                {answeredCount < totalQuestions && (
                  <span className="mt-1 block text-warning">
                    {totalQuestions - answeredCount} question
                    {totalQuestions - answeredCount > 1 ? "s" : ""} unanswered.
                  </span>
                )}
              </p>

              {submitError && (
                <p className="mt-3 text-sm text-error">{submitError}</p>
              )}

              <div className="mt-5 flex gap-3">
                <Button
                  variant="outline"
                  className="flex-1"
                  onClick={() => setShowConfirm(false)}
                  disabled={isSubmitting}
                >
                  {tc("back")}
                </Button>
                <Button
                  className="flex-1"
                  onClick={handleSubmit}
                  isLoading={isSubmitting}
                >
                  <Send className="h-4 w-4" />
                  {tc("submit")}
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Top Bar */}
      <div className="mb-4">
        <div className="flex items-center justify-between">
          <p className="text-sm font-medium text-text-secondary">
            {t("question")} {currentIndex + 1} {t("of")} {totalQuestions}
          </p>
          <div className="flex items-center gap-3">
            {mode === "TIMED" && (
              <div
                className={cn(
                  "flex items-center gap-2 rounded-full px-4 py-1.5 text-sm font-bold",
                  timeLeft <= 10
                    ? "bg-error/10 text-error"
                    : timeLeft <= 20
                    ? "bg-warning/10 text-warning"
                    : "bg-success/10 text-success"
                )}
              >
                <Timer className="h-4 w-4" />
                {timeLeft}s
              </div>
            )}
            <p className="text-sm text-text-secondary">
              {answeredCount}/{totalQuestions} answered
            </p>
          </div>
        </div>
        <ProgressBar value={progress} color="primary" size="sm" className="mt-2" />
      </div>

      {/* Why this quiz is shorter than requested — dismissible, shown once. */}
      {notice && (
        <div className="mb-4 flex items-start gap-3 rounded-xl border-2 border-warning/40 bg-warning/10 p-4">
          <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-warning" />
          <p className="flex-1 text-sm text-text-secondary">{notice}</p>
          <button
            onClick={dismissNotice}
            className="shrink-0 text-sm font-medium text-text-secondary hover:text-text-primary"
          >
            {tc("close")}
          </button>
        </div>
      )}

      {/* Question Card & Answer Interfaces */}
      <Card className="mb-4">
        <CardContent className="py-5">
          <div className="text-base font-semibold leading-relaxed text-text-primary sm:text-lg">
            {currentQuestion.type === "FILL_IN_BLANK" ? (
              <FillInBlankRenderer
                text={currentQuestion.questionText}
                value={currentAnswer?.studentAnswer || ""}
                onChange={handleSelectAnswer}
              />
            ) : (
              currentQuestion.questionText
            )}
          </div>

          {/* Countdown progress bar (TIMED mode) */}
          {mode === "TIMED" && (
            <div className="mt-4 h-1 w-full overflow-hidden rounded-full bg-border">
              <div
                className={cn(
                  "h-full transition-all duration-1000",
                  timeLeft <= 10 ? "bg-error" : timeLeft <= 20 ? "bg-warning" : "bg-success"
                )}
                style={{ width: `${Math.max(0, Math.min(100, (timeLeft / questionSeconds) * 100))}%` }}
              />
            </div>
          )}
        </CardContent>
      </Card>

      {/* Dynamic Answer Interface Selection */}
      <div className="mb-6">
        {currentQuestion.type === "MCQ" && (
          <div className="space-y-3">
            {currentQuestion.options.map((option, index) => {
              const label = OPTION_LABELS[index] || option.label;
              const isSelected = currentAnswer?.studentAnswer === option.text;
              return (
                <button
                  key={`${index}-${option.label}`}
                  onClick={() => handleSelectAnswer(option.text)}
                  className={cn(
                    "flex w-full items-start gap-3 rounded-xl border-2 p-4 text-left transition-all",
                    isSelected ? "border-primary bg-primary/10" : "border-border bg-surface hover:border-primary/40"
                  )}
                >
                  <span className={cn("flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-sm font-bold", isSelected ? "bg-primary text-white" : "bg-gray-100 text-text-secondary")}>
                    {label}
                  </span>
                  <span className={cn("pt-1 text-sm sm:text-base", isSelected ? "font-medium text-text-primary" : "text-text-secondary")}>
                    {option.text}
                  </span>
                </button>
              );
            })}
          </div>
        )}

        {currentQuestion.type === "TRUE_FALSE" && (
          <div className="grid grid-cols-2 gap-4">
            {["True", "False"].map((option) => {
              const isSelected = currentAnswer?.studentAnswer === option;
              return (
                <Button
                  key={option}
                  variant={isSelected ? "primary" : "outline"}
                  size="lg"
                  className="h-16 text-lg"
                  onClick={() => handleSelectAnswer(option)}
                >
                  {option}
                </Button>
              );
            })}
          </div>
        )}

        {currentQuestion.type === "FILL_IN_BLANK" && !currentQuestion.questionText.includes("_") && (
          <div className="space-y-2">
            <p className="text-sm font-medium text-text-secondary">Type your answer below:</p>
            <input
              type="text"
              value={currentAnswer?.studentAnswer || ""}
              onChange={(e) => handleSelectAnswer(e.target.value)}
              className="w-full rounded-xl border-2 border-border p-4 focus:border-primary focus:outline-none"
              placeholder="Your answer..."
            />
          </div>
        )}

        {currentQuestion.type === "MATCH_PAIRS" && (
          <MatchPairsInterface
            options={currentQuestion.options}
            value={currentAnswer?.studentAnswer || ""}
            onChange={handleSelectAnswer}
          />
        )}

        {currentQuestion.type === "ORDERING" && (
          <OrderingInterface
            options={currentQuestion.options}
            value={currentAnswer?.studentAnswer || ""}
            onChange={handleSelectAnswer}
          />
        )}
      </div>

      {/* Navigation */}
      <div className="flex gap-3">
        <Button
          variant="outline"
          className="flex-1"
          onClick={previousQuestion}
          disabled={isFirstQuestion}
        >
          <ChevronLeft className="h-4 w-4" />
          {t("previous")}
        </Button>
        <Button className="flex-1" onClick={handleNext}>
          {isLastQuestion ? (
            <>
              {t("submit")}
              <Send className="h-4 w-4" />
            </>
          ) : (
            <>
              {t("next")}
              <ChevronRight className="h-4 w-4" />
            </>
          )}
        </Button>
      </div>
    </div>
  );
}
