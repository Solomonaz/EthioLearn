"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import {
  CheckCircle,
  XCircle,
  Trophy,
  RotateCcw,
  Home,
  ChevronDown,
  ChevronUp,
  Star,
  RefreshCw,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ProgressBar } from "@/components/ui/progress-bar";
import { cn } from "@/lib/utils";
import { useQuizStore } from "@/stores/quiz-store";

interface AnswerResult {
  questionId: string;
  questionText: string;
  options: { label: string; text: string }[];
  studentAnswer: string;
  correctAnswer: string;
  isCorrect: boolean;
  explanation: string;
  pointsEarned: number;
}

interface QuizResults {
  quizId: string;
  score: number;
  totalQuestions: number;
  correctAnswers: number;
  totalPointsEarned: number;
  newTotalPoints: number;
  newXPLevel: number;
  answers: AnswerResult[];
  retryChapterId?: string | null;
  retryDifficulty?: string;
  retryQuestionCount?: number;
}

export default function QuizResultsPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const [results, setResults] = useState<QuizResults | null>(null);
  const [expandedQuestion, setExpandedQuestion] = useState<string | null>(null);
  const [retryParams, setRetryParams] = useState<{ chapterId: string; difficulty: string; questionCount: number } | null>(null);
  const [retrying, setRetrying] = useState(false);
  const startQuiz = useQuizStore((s) => s.startQuiz);

  useEffect(() => {
    const stored = sessionStorage.getItem(`quiz-results-${params.id}`);
    if (stored) {
      const data: QuizResults = JSON.parse(stored);
      setResults(data);
      if (data.retryChapterId) {
        setRetryParams({
          chapterId: data.retryChapterId,
          difficulty: data.retryDifficulty ?? "MEDIUM",
          questionCount: data.totalQuestions,
        });
      }
    } else {
      // Redirect back if no results found
      router.replace("/student");
    }
  }, [params.id, router]);

  async function handleRetry() {
    if (!retryParams) return;
    setRetrying(true);
    try {
      const res = await fetch("/api/quizzes/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chapterId: retryParams.chapterId,
          difficulty: retryParams.difficulty,
          questionCount: retryParams.questionCount,
          mode: "SOLO",
        }),
      });
      if (!res.ok) throw new Error("Failed to generate quiz");
      const data = await res.json();
      startQuiz(data.quizId, data.questions, data.mode ?? "SOLO");
      router.push(`/student/quiz/${data.quizId}`);
    } catch {
      setRetrying(false);
    }
  }

  if (!results) return null;

  const { score, totalQuestions, correctAnswers, totalPointsEarned, answers } =
    results;
  const wrong = totalQuestions - correctAnswers;

  const scoreColor =
    score >= 80 ? "text-success" : score >= 50 ? "text-warning" : "text-error";
  const scoreLabel =
    score >= 80 ? "Excellent!" : score >= 60 ? "Good job!" : score >= 40 ? "Keep practising!" : "Don't give up!";

  return (
    <div className="mx-auto max-w-2xl p-4 sm:p-6">
      {/* Score Header */}
      <div className="mb-6 text-center">
        <div className="mx-auto mb-4 flex h-20 w-20 items-center justify-center rounded-full bg-primary/10">
          <Trophy className="h-10 w-10 text-primary" />
        </div>
        <h1 className="text-2xl font-bold text-text-primary">{scoreLabel}</h1>
        <p className={cn("mt-1 text-5xl font-black", scoreColor)}>{score}%</p>
        <p className="mt-1 text-sm text-text-secondary">
          {correctAnswers} of {totalQuestions} correct
        </p>
      </div>

      {/* Score Breakdown Cards */}
      <div className="mb-6 grid grid-cols-3 gap-3">
        <Card className="text-center">
          <CardContent className="py-4">
            <CheckCircle className="mx-auto mb-1 h-6 w-6 text-success" />
            <p className="text-xl font-bold text-success">{correctAnswers}</p>
            <p className="text-xs text-text-secondary">Correct</p>
          </CardContent>
        </Card>
        <Card className="text-center">
          <CardContent className="py-4">
            <XCircle className="mx-auto mb-1 h-6 w-6 text-error" />
            <p className="text-xl font-bold text-error">{wrong}</p>
            <p className="text-xs text-text-secondary">Wrong</p>
          </CardContent>
        </Card>
        <Card className="text-center">
          <CardContent className="py-4">
            <Star className="mx-auto mb-1 h-6 w-6 text-secondary-dark" />
            <p className="text-xl font-bold text-primary">
              +{totalPointsEarned}
            </p>
            <p className="text-xs text-text-secondary">Points</p>
          </CardContent>
        </Card>
      </div>

      {/* Accuracy Bar */}
      <Card className="mb-6">
        <CardContent className="py-4">
          <div className="mb-2 flex items-center justify-between text-sm">
            <span className="text-text-secondary">Accuracy</span>
            <span className="font-semibold text-text-primary">{score}%</span>
          </div>
          <ProgressBar
            value={score}
            color={score >= 70 ? "success" : "primary"}
            size="md"
          />
        </CardContent>
      </Card>

      {/* Action Buttons */}
      <div className="mb-6 flex flex-wrap gap-3">
        <Link href="/student/quiz" className="flex-1">
          <Button variant="primary" size="md" className="w-full gap-2">
            <RotateCcw className="h-4 w-4" />
            New Quiz
          </Button>
        </Link>
        {retryParams && (
          <Button
            variant="outline"
            size="md"
            onClick={handleRetry}
            isLoading={retrying}
            className="flex-1 gap-2"
          >
            <RefreshCw className="h-4 w-4" />
            Retry Quiz
          </Button>
        )}
        <Link href="/student" className="flex-1">
          <Button variant="outline" size="md" className="w-full gap-2">
            <Home className="h-4 w-4" />
            Dashboard
          </Button>
        </Link>
      </div>

      {/* Question Review */}
      <div>
        <h2 className="mb-3 text-lg font-semibold text-text-primary">
          Review Answers
        </h2>
        <div className="space-y-3">
          {answers.map((a, index) => (
            <Card
              key={a.questionId}
              className={cn(
                "overflow-hidden border-l-4",
                a.isCorrect ? "border-l-success" : "border-l-error"
              )}
            >
              <button
                className="w-full text-left"
                onClick={() =>
                  setExpandedQuestion(
                    expandedQuestion === a.questionId ? null : a.questionId
                  )
                }
              >
                <CardContent className="flex items-center gap-3 py-3">
                  {a.isCorrect ? (
                    <CheckCircle className="h-5 w-5 shrink-0 text-success" />
                  ) : (
                    <XCircle className="h-5 w-5 shrink-0 text-error" />
                  )}
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-text-primary">
                      Q{index + 1}. {a.questionText}
                    </p>
                    <div className="mt-0.5 flex items-center gap-2">
                      <span className="text-xs text-text-secondary">
                        Your answer:{" "}
                        <span
                          className={cn(
                            "font-medium",
                            a.isCorrect ? "text-success" : "text-error"
                          )}
                        >
                          {a.studentAnswer || "—"}
                        </span>
                      </span>
                      {a.pointsEarned > 0 && (
                        <Badge variant="success" className="text-xs">
                          +{a.pointsEarned}
                        </Badge>
                      )}
                    </div>
                  </div>
                  {expandedQuestion === a.questionId ? (
                    <ChevronUp className="h-4 w-4 shrink-0 text-text-secondary" />
                  ) : (
                    <ChevronDown className="h-4 w-4 shrink-0 text-text-secondary" />
                  )}
                </CardContent>
              </button>

              {expandedQuestion === a.questionId && (
                <div className="border-t border-border bg-gray-50 px-4 py-3">
                  {/* Options */}
                  <div className="mb-3 space-y-2">
                    {(a.options as { label: string; text: string }[]).map(
                      (opt) => (
                        <div
                          key={opt.label}
                          className={cn(
                            "flex items-center gap-2 rounded-lg px-3 py-2 text-sm",
                            opt.label === a.correctAnswer
                              ? "bg-success/10 font-medium text-success"
                              : opt.label === a.studentAnswer && !a.isCorrect
                              ? "bg-error/10 text-error line-through"
                              : "text-text-secondary"
                          )}
                        >
                          <span className="font-bold">{opt.label}.</span>
                          <span>{opt.text}</span>
                          {opt.label === a.correctAnswer && (
                            <CheckCircle className="ml-auto h-4 w-4 text-success" />
                          )}
                        </div>
                      )
                    )}
                  </div>
                  {/* Explanation */}
                  {a.explanation && (
                    <div className="rounded-lg bg-blue-50 px-3 py-2 text-sm text-blue-800">
                      <span className="font-semibold">Explanation: </span>
                      {a.explanation}
                    </div>
                  )}
                </div>
              )}
            </Card>
          ))}
        </div>
      </div>
    </div>
  );
}
