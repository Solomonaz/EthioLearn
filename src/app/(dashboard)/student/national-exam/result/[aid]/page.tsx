"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { CheckCircle2, XCircle, MinusCircle, ChevronLeft } from "lucide-react";
import { useTranslations } from "next-intl";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { MathText } from "@/components/ui/math-text";
import { cn } from "@/lib/utils";

const LETTERS = ["A", "B", "C", "D", "E", "F"];

interface ReviewItem {
  id: string;
  number: number;
  questionText: string;
  options: string[];
  hasImage: boolean;
  chosen: string | null;
  correctAnswer: string | null;
  explanation: string | null;
  isCorrect: boolean;
}

interface Result {
  id: string;
  mode: "EXAM" | "PRACTICE";
  correctCount: number;
  totalQuestions: number;
  startedAt: string;
  completedAt: string;
  exam: { id: string; subject: string; yearLabel: string };
  review: ReviewItem[];
}

type Filter = "all" | "wrong" | "unanswered";

/** Score and full review of a finished past paper. */
export default function NationalExamResultPage() {
  const t = useTranslations("nationalExam");
  const { aid } = useParams<{ aid: string }>();
  const [result, setResult] = useState<Result | null>(null);
  const [error, setError] = useState(false);
  const [filter, setFilter] = useState<Filter>("all");

  useEffect(() => {
    fetch(`/api/national-exams/attempts/${aid}`)
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((d) => setResult(d.attempt))
      .catch(() => setError(true));
  }, [aid]);

  if (error) return <p className="p-6 text-text-secondary">{t("loadError")}</p>;
  if (!result) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <Spinner size="lg" className="text-primary" />
      </div>
    );
  }

  const percent = result.totalQuestions ? Math.round((result.correctCount / result.totalQuestions) * 100) : 0;
  const minutes = Math.max(1, Math.round((new Date(result.completedAt).getTime() - new Date(result.startedAt).getTime()) / 60000));
  const wrong = result.review.filter((r) => r.chosen && !r.isCorrect).length;
  const unanswered = result.review.filter((r) => !r.chosen).length;
  const items = result.review.filter((r) => (filter === "wrong" ? r.chosen && !r.isCorrect : filter === "unanswered" ? !r.chosen : true));

  return (
    <div className="mx-auto max-w-4xl space-y-6 p-4 sm:p-6">
      <Link href="/student/national-exam" className="flex items-center gap-1 text-sm text-text-secondary hover:text-primary">
        <ChevronLeft className="h-4 w-4" /> {t("backToPapers")}
      </Link>

      <Card>
        <CardContent className="py-6 text-center">
          <p className="text-sm text-text-secondary">
            {result.exam.subject} · {result.exam.yearLabel} · {result.mode === "EXAM" ? t("examMode") : t("practiceMode")}
          </p>
          <p className={cn("mt-2 text-5xl font-bold", percent >= 50 ? "text-success" : "text-warning")}>{percent}%</p>
          <p className="mt-2 text-text-secondary">
            {t("scoreLine", { correct: result.correctCount, total: result.totalQuestions, minutes })}
          </p>
          <div className="mt-4 flex justify-center gap-2">
            <Link href={`/student/national-exam/${result.exam.id}?mode=${result.mode}`}>
              <Button size="sm" variant="outline">{t("tryAgain")}</Button>
            </Link>
          </div>
        </CardContent>
      </Card>

      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant={filter === "all" ? "primary" : "outline"} onClick={() => setFilter("all")}>
          {t("filterAll", { count: result.review.length })}
        </Button>
        <Button size="sm" variant={filter === "wrong" ? "primary" : "outline"} onClick={() => setFilter("wrong")}>
          {t("filterWrong", { count: wrong })}
        </Button>
        <Button size="sm" variant={filter === "unanswered" ? "primary" : "outline"} onClick={() => setFilter("unanswered")}>
          {t("filterUnanswered", { count: unanswered })}
        </Button>
      </div>

      <div className="space-y-3">
        {items.map((r) => (
          <Card key={r.id}>
            <CardContent className="space-y-3 py-4">
              <div className="flex items-center gap-2">
                {r.isCorrect ? (
                  <CheckCircle2 className="h-5 w-5 text-success" />
                ) : r.chosen ? (
                  <XCircle className="h-5 w-5 text-error" />
                ) : (
                  <MinusCircle className="h-5 w-5 text-text-secondary" />
                )}
                <p className="text-sm font-semibold text-text-primary">{t("questionN", { n: r.number })}</p>
              </div>
              <div className="whitespace-pre-line text-sm text-text-primary">
                <MathText text={r.questionText} />
              </div>
              {r.hasImage && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={`/api/national-exams/images/${r.id}`} alt={t("figureAlt", { n: r.number })} className="max-h-72 rounded border border-border" />
              )}
              <div className="space-y-1.5">
                {r.options.map((opt, i) => (
                  <div
                    key={i}
                    className={cn(
                      "flex gap-2 rounded-md border px-3 py-2 text-sm",
                      opt === r.correctAnswer ? "border-success bg-green-50" : opt === r.chosen ? "border-error bg-red-50" : "border-border",
                    )}
                  >
                    <span className="font-bold text-text-secondary">{LETTERS[i]}.</span>
                    <MathText text={opt} />
                  </div>
                ))}
              </div>
              {r.explanation && (
                <div className="rounded-md bg-gray-50 p-3 text-sm text-text-primary dark:bg-gray-800">
                  <MathText text={r.explanation} />
                </div>
              )}
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
