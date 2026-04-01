"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter, useParams } from "next/navigation";
import Link from "next/link";
import { ChevronLeft, ChevronRight, Send, AlertTriangle, Timer } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ProgressBar } from "@/components/ui/progress-bar";
import { Spinner } from "@/components/ui/spinner";
import { useQuizStore } from "@/stores/quiz-store";
import { cn } from "@/lib/utils";

const OPTION_LABELS = ["A", "B", "C", "D"];

export default function QuizTakingPage() {
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

  const [showConfirm, setShowConfirm] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  // Derived values (safe even when questions is empty)
  const hasQuestions = questions && questions.length > 0;
  const currentQuestion = hasQuestions ? questions[currentIndex] : null;
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
  }, [quizId, getSubmitPayload, setSubmitting, setTimerActive, reset, router]);

  // Timer countdown effect
  useEffect(() => {
    if (mode !== "TIMED" || !timerActive) return;

    if (timeLeft <= 0) {
      // Auto-advance: if on last question, submit; otherwise next
      if (currentIndex >= questions.length - 1) {
        handleSubmit();
      } else {
        nextQuestion();
        setTimeLeft(30);
      }
      return;
    }

    const interval = setInterval(() => {
      setTimeLeft(timeLeft - 1);
    }, 1000);

    return () => clearInterval(interval);
  }, [timeLeft, timerActive, mode, currentIndex, questions.length, nextQuestion, setTimeLeft, handleSubmit]);

  // Reset timer when question changes
  useEffect(() => {
    if (mode === "TIMED") {
      setTimeLeft(30);
      setTimerActive(true);
    }
  }, [currentIndex, mode, setTimeLeft, setTimerActive]);

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
                Submit Quiz?
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
                  Go Back
                </Button>
                <Button
                  className="flex-1"
                  onClick={handleSubmit}
                  isLoading={isSubmitting}
                >
                  <Send className="h-4 w-4" />
                  Submit
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
            Question {currentIndex + 1} of {totalQuestions}
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

      {/* Question Card */}
      <Card className="mb-4">
        <CardContent className="py-5">
          <p className="text-base font-semibold leading-relaxed text-text-primary sm:text-lg">
            {currentQuestion.questionText}
          </p>

          {/* Countdown progress bar (TIMED mode) */}
          {mode === "TIMED" && (
            <div className="mt-4 h-1 w-full overflow-hidden rounded-full bg-border">
              <div
                className={cn(
                  "h-full transition-all duration-1000",
                  timeLeft <= 10
                    ? "bg-error"
                    : timeLeft <= 20
                    ? "bg-warning"
                    : "bg-success"
                )}
                style={{ width: `${(timeLeft / 30) * 100}%` }}
              />
            </div>
          )}
        </CardContent>
      </Card>

      {/* Answer Options */}
      <div className="mb-6 space-y-3">
        {currentQuestion.options.map((option, index) => {
          const label = OPTION_LABELS[index] || option.label;
          const isSelected = currentAnswer?.studentAnswer === option.text;

          return (
            <button
              key={`${index}-${option.label}`}
              onClick={() => handleSelectAnswer(option.text)}
              className={cn(
                "flex w-full items-start gap-3 rounded-xl border-2 p-4 text-left transition-all",
                "min-h-[48px] active:scale-[0.98]",
                isSelected
                  ? "border-primary bg-primary/10"
                  : "border-border bg-surface hover:border-primary/40 hover:shadow-sm"
              )}
            >
              <span
                className={cn(
                  "flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-sm font-bold",
                  isSelected
                    ? "bg-primary text-white"
                    : "bg-gray-100 text-text-secondary"
                )}
              >
                {label}
              </span>
              <span
                className={cn(
                  "pt-1 text-sm sm:text-base",
                  isSelected
                    ? "font-medium text-text-primary"
                    : "text-text-secondary"
                )}
              >
                {option.text}
              </span>
            </button>
          );
        })}
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
          Previous
        </Button>
        <Button className="flex-1" onClick={handleNext}>
          {isLastQuestion ? (
            <>
              Submit Quiz
              <Send className="h-4 w-4" />
            </>
          ) : (
            <>
              Next
              <ChevronRight className="h-4 w-4" />
            </>
          )}
        </Button>
      </div>
    </div>
  );
}
