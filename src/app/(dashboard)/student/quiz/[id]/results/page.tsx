"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { useTranslations } from "next-intl";
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
  PlayCircle,
  ExternalLink,
  Gift,
  AlertTriangle,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ProgressBar } from "@/components/ui/progress-bar";
import { cn } from "@/lib/utils";
import { useQuizStore } from "@/stores/quiz-store";

interface AnswerResultOption {
  label: string;
  text: string;
}

interface AnswerResult {
  questionId: string;
  questionText: string;
  options: (string | AnswerResultOption)[];
  studentAnswer: string;
  correctAnswer: string;
  isCorrect: boolean;
  explanation: string;
  videoUrl?: string | null;
  pointsEarned: number;
}

const OPTION_LABELS = ["A", "B", "C", "D", "E", "F"];

/** Convert a YouTube watch URL to an embed URL, or return null if not YouTube */
function getYouTubeEmbedUrl(url: string): string | null {
  try {
    const parsed = new URL(url);
    // https://www.youtube.com/watch?v=XXXXXXXX
    if (parsed.hostname.includes("youtube.com")) {
      const v = parsed.searchParams.get("v");
      if (v) return `https://www.youtube.com/embed/${v}`;
      // https://youtu.be/XXXXXXXX
    }
    if (parsed.hostname === "youtu.be") {
      return `https://www.youtube.com/embed${parsed.pathname}`;
    }
  } catch {
    // invalid URL — fall through
  }
  return null;
}

function normalizeOptions(options: (string | AnswerResultOption)[]): AnswerResultOption[] {
  return options.map((opt, i) =>
    typeof opt === "string"
      ? { label: OPTION_LABELS[i] || String(i + 1), text: opt }
      : opt
  );
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
  redeemablePointsEarned?: number;
  pointsBlocked?: boolean;
  pointsBlockedReason?: string;
  repeatQuestions?: number;
  pointsReducedForRepeats?: boolean;
}

export default function QuizResultsPage() {
  const t  = useTranslations("quiz");
  const tc = useTranslations("common");
  const tn = useTranslations("nav");
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

  const {
    score,
    totalQuestions,
    correctAnswers,
    totalPointsEarned,
    answers,
    redeemablePointsEarned = 0,
    pointsBlocked = false,
    pointsBlockedReason,
    repeatQuestions = 0,
    pointsReducedForRepeats = false,
  } = results;
  const wrong = totalQuestions - correctAnswers;
  const showPointsNote =
    pointsBlocked || pointsReducedForRepeats || redeemablePointsEarned > 0;

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
          {correctAnswers} {t("of")} {totalQuestions} {t("correct").toLowerCase()}
        </p>
      </div>

      {/* Score Breakdown Cards */}
      <div className="mb-6 grid grid-cols-3 gap-3">
        <Card className="text-center">
          <CardContent className="py-4">
            <CheckCircle className="mx-auto mb-1 h-6 w-6 text-success" />
            <p className="text-xl font-bold text-success">{correctAnswers}</p>
            <p className="text-xs text-text-secondary">{t("correct")}</p>
          </CardContent>
        </Card>
        <Card className="text-center">
          <CardContent className="py-4">
            <XCircle className="mx-auto mb-1 h-6 w-6 text-error" />
            <p className="text-xl font-bold text-error">{wrong}</p>
            <p className="text-xs text-text-secondary">{t("incorrect")}</p>
          </CardContent>
        </Card>
        <Card className="text-center">
          <CardContent className="py-4">
            <Star className="mx-auto mb-1 h-6 w-6 text-secondary-dark" />
            <p className="text-xl font-bold text-primary">
              +{totalPointsEarned}
            </p>
            <p className="text-xs text-text-secondary">{t("points")}</p>
          </CardContent>
        </Card>
      </div>

      {/* Points note — reward points, repeats, or a blocked-points reason */}
      {showPointsNote && (
        <Card className="mb-6">
          <CardContent className="space-y-1.5 py-3 text-sm">
            {pointsBlocked ? (
              <p className="flex items-center gap-2 text-warning">
                <AlertTriangle className="h-4 w-4 shrink-0" />
                {pointsBlockedReason ?? "No points awarded for this attempt."}
              </p>
            ) : (
              <>
                {redeemablePointsEarned > 0 && (
                  <p className="flex items-center gap-2 text-text-secondary">
                    <Gift className="h-4 w-4 shrink-0 text-primary" />
                    <span className="font-semibold text-primary">+{redeemablePointsEarned}</span>
                    reward points earned — spendable in the Rewards store.
                  </p>
                )}
                {pointsReducedForRepeats && (
                  <p className="flex items-center gap-2 text-text-secondary">
                    <RefreshCw className="h-4 w-4 shrink-0 text-warning" />
                    {repeatQuestions} review question{repeatQuestions === 1 ? "" : "s"} — reduced points, and no reward points (you&apos;d already mastered {repeatQuestions === 1 ? "it" : "them"}).
                  </p>
                )}
              </>
            )}
          </CardContent>
        </Card>
      )}

      {/* Accuracy Bar */}
      <Card className="mb-6">
        <CardContent className="py-4">
          <div className="mb-2 flex items-center justify-between text-sm">
            <span className="text-text-secondary">{t("score")}</span>
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
            {t("startQuiz")}
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
            {tc("retry")}
          </Button>
        )}
        <Link href="/student" className="flex-1">
          <Button variant="outline" size="md" className="w-full gap-2">
            <Home className="h-4 w-4" />
            {tn("dashboard")}
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
                    {normalizeOptions(a.options).map(
                      (opt, optIdx) => (
                        <div
                          key={`${optIdx}-${opt.label}`}
                          className={cn(
                            "flex items-center gap-2 rounded-lg px-3 py-2 text-sm",
                            opt.text === a.correctAnswer
                              ? "bg-success/10 font-medium text-success"
                              : opt.text === a.studentAnswer && !a.isCorrect
                              ? "bg-error/10 text-error line-through"
                              : "text-text-secondary"
                          )}
                        >
                          <span className="font-bold">{opt.label}.</span>
                          <span>{opt.text}</span>
                          {opt.text === a.correctAnswer && (
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

                  {/* Video Explanation */}
                  {a.videoUrl && (() => {
                    const embedUrl = getYouTubeEmbedUrl(a.videoUrl);
                    return embedUrl ? (
                      <div className="mt-3">
                        <div className="mb-1 flex items-center gap-1.5">
                          <PlayCircle className="h-4 w-4 text-red-500" />
                          <span className="text-xs font-semibold text-text-secondary uppercase tracking-wide">
                            Video Explanation
                          </span>
                        </div>
                        <div className="overflow-hidden rounded-lg border border-border bg-black">
                          <div className="relative w-full" style={{ paddingBottom: "56.25%" }}>
                            <iframe
                              src={embedUrl}
                              title="Video explanation"
                              allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                              allowFullScreen
                              className="absolute inset-0 h-full w-full border-0"
                            />
                          </div>
                        </div>
                      </div>
                    ) : (
                      <a
                        href={a.videoUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="mt-3 flex items-center gap-2 rounded-lg border border-purple-200 bg-purple-50 px-3 py-2 text-sm font-medium text-purple-700 hover:bg-purple-100 transition-colors"
                      >
                        <PlayCircle className="h-4 w-4 shrink-0" />
                        <span className="flex-1 truncate">Watch Video Explanation</span>
                        <ExternalLink className="h-3.5 w-3.5 shrink-0" />
                      </a>
                    );
                  })()}
                </div>
              )}
            </Card>
          ))}
        </div>
      </div>
    </div>
  );
}
