"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { BookOpen, TrendingUp } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ProgressBar } from "@/components/ui/progress-bar";
import { Skeleton, SkeletonRow } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { scoreVariant } from "@/lib/utils";

// ── Types ─────────────────────────────────────────────────────────────────────

type MasteryLevel = "NOT_STARTED" | "IN_PROGRESS" | "PROFICIENT" | "MASTERED";

interface SubjectStat {
  subject: string;
  grade: number;
  avgScore: number;
  quizCount: number;
  chapterCount: number;
}

interface ChapterStat {
  id: string;
  title: string;
  subject: string;
  grade: number;
  masteryLevel: MasteryLevel;
  avgScore: number;
  attemptCount: number;
}

interface ProgressData {
  subjects: SubjectStat[];
  chapters: ChapterStat[];
  weakestChapters: ChapterStat[];
  studyRecommendations: string[];
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const masteryConfig: Record<
  MasteryLevel,
  { label: string; variant: "default" | "info" | "warning" | "success" }
> = {
  NOT_STARTED: { label: "NOT STARTED", variant: "default" },
  IN_PROGRESS: { label: "IN PROGRESS", variant: "info" },
  PROFICIENT: { label: "PROFICIENT", variant: "warning" },
  MASTERED: { label: "MASTERED", variant: "success" },
};

function scoreToProgressColor(
  score: number,
): "success" | "primary" | "secondary" {
  if (score >= 70) return "success";
  if (score >= 40) return "primary";
  return "secondary";
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function StudentProgressPage() {
  const [data, setData] = useState<ProgressData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function fetchProgress() {
      try {
        const res = await fetch("/api/students/me/progress");
        if (!res.ok) throw new Error("Failed to load progress data");
        const json = await res.json();
        setData(json);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Something went wrong");
      } finally {
        setLoading(false);
      }
    }
    fetchProgress();
  }, []);

  // Loading state
  if (loading) {
    return (
      <div className="mx-auto max-w-4xl space-y-6 p-4 sm:p-6">
        <div>
          <Skeleton className="h-8 w-48" />
          <Skeleton className="mt-2 h-4 w-72" />
        </div>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <Card key={i}>
              <CardContent className="py-5 space-y-3">
                <Skeleton className="h-5 w-1/2" />
                <Skeleton className="h-3 w-full" />
                <Skeleton className="h-3 w-1/3" />
              </CardContent>
            </Card>
          ))}
        </div>
        <div className="rounded-xl border border-border overflow-hidden">
          {Array.from({ length: 5 }).map((_, i) => (
            <SkeletonRow key={i} />
          ))}
        </div>
      </div>
    );
  }

  // Error state
  if (error) {
    return (
      <div className="flex min-h-[60vh] flex-col items-center justify-center gap-4">
        <p className="text-text-secondary">{error}</p>
        <Button variant="outline" onClick={() => window.location.reload()}>
          Try Again
        </Button>
      </div>
    );
  }

  // Empty state — no quizzes taken
  const hasData =
    data &&
    (data.subjects.length > 0 ||
      data.chapters.length > 0);

  if (!hasData) {
    return (
      <div className="mx-auto max-w-4xl space-y-6 p-4 sm:p-6">
        <div>
          <h1 className="text-2xl font-bold text-text-primary">
            My Progress
          </h1>
          <p className="mt-1 text-sm text-text-secondary">
            Track your mastery across subjects and chapters
          </p>
        </div>
        <Card>
          <CardContent className="py-16 text-center">
            <TrendingUp className="mx-auto mb-3 h-12 w-12 text-text-secondary/40" />
            <p className="text-lg font-medium text-text-primary">
              No progress yet
            </p>
            <p className="mt-1 text-sm text-text-secondary">
              Complete a quiz to start tracking your mastery and performance.
            </p>
            <Link href="/student/quiz" className="mt-4 inline-block">
              <Button size="md">Take a Quiz</Button>
            </Link>
          </CardContent>
        </Card>
      </div>
    );
  }

  const { subjects, chapters, studyRecommendations } = data;

  return (
    <div className="mx-auto max-w-4xl space-y-8 p-4 sm:p-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-text-primary">My Progress</h1>
        <p className="mt-1 text-sm text-text-secondary">
          Track your mastery across subjects and chapters
        </p>
      </div>

      {/* Section 1: Subject Overview */}
      {subjects.length > 0 && (
        <section>
          <h2 className="mb-3 text-base font-semibold text-text-primary">
            Subject Overview
          </h2>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {subjects.map((sub) => (
              <Card key={`${sub.subject}-${sub.grade}`}>
                <CardContent className="py-5">
                  <div className="mb-3 flex items-center justify-between gap-2">
                    <p className="font-bold text-text-primary truncate">
                      {sub.subject}
                    </p>
                    <Badge variant="info">Grade {sub.grade}</Badge>
                  </div>

                  <div className="mb-2 flex items-end justify-between">
                    <span className="text-2xl font-bold text-text-primary">
                      {sub.avgScore}%
                    </span>
                    <Badge variant={scoreVariant(sub.avgScore)}>
                      {sub.avgScore >= 70
                        ? "On Track"
                        : sub.avgScore >= 40
                          ? "Improving"
                          : "Needs Work"}
                    </Badge>
                  </div>

                  <ProgressBar
                    value={sub.avgScore}
                    color={scoreToProgressColor(sub.avgScore)}
                    size="sm"
                  />

                  <p className="mt-2 text-xs text-text-muted">
                    {sub.quizCount} {sub.quizCount === 1 ? "quiz" : "quizzes"} taken &middot;{" "}
                    {sub.chapterCount}{" "}
                    {sub.chapterCount === 1 ? "chapter" : "chapters"}
                  </p>
                </CardContent>
              </Card>
            ))}
          </div>
        </section>
      )}

      {/* Section 2: Study Recommendations / Focus Areas */}
      {studyRecommendations.length > 0 && (
        <section>
          <h2 className="mb-3 text-base font-semibold text-text-primary">
            Focus Areas 🎯
          </h2>
          <div className="rounded-xl border border-yellow-300 bg-yellow-50 px-5 py-4 dark:border-yellow-700 dark:bg-yellow-900/20">
            <ul className="space-y-2">
              {studyRecommendations.map((rec, idx) => (
                <li
                  key={idx}
                  className="flex items-start gap-2 text-sm text-yellow-900 dark:text-yellow-200"
                >
                  <span className="mt-0.5 shrink-0 text-yellow-600">•</span>
                  {rec}
                </li>
              ))}
            </ul>
          </div>
        </section>
      )}

      {/* Section 3: Chapter Mastery Map */}
      {chapters.length > 0 && (
        <section>
          <h2 className="mb-3 text-base font-semibold text-text-primary">
            Chapter Mastery
          </h2>
          <div className="rounded-xl border border-border overflow-hidden">
            {chapters.map((chapter, idx) => {
              const mastery = masteryConfig[chapter.masteryLevel];
              return (
                <div
                  key={chapter.id}
                  className={`flex items-center gap-4 px-5 py-4 ${
                    idx < chapters.length - 1
                      ? "border-b border-border"
                      : ""
                  } bg-surface`}
                >
                  {/* Icon */}
                  <div className="shrink-0 rounded-lg bg-primary/10 p-2">
                    <BookOpen className="h-4 w-4 text-primary" />
                  </div>

                  {/* Chapter info */}
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="text-sm font-medium text-text-primary truncate">
                        {chapter.title}
                      </p>
                      <Badge variant={mastery.variant}>{mastery.label}</Badge>
                    </div>
                    <p className="mt-0.5 text-xs text-text-muted">
                      {chapter.subject} &middot;{" "}
                      {chapter.attemptCount}{" "}
                      {chapter.attemptCount === 1 ? "attempt" : "attempts"}
                    </p>
                  </div>

                  {/* Score */}
                  {chapter.attemptCount > 0 && (
                    <div className="shrink-0 text-right">
                      <p
                        className={`text-lg font-bold ${
                          chapter.avgScore >= 70
                            ? "text-success"
                            : chapter.avgScore >= 40
                              ? "text-warning"
                              : "text-error"
                        }`}
                      >
                        {chapter.avgScore}%
                      </p>
                      <p className="text-xs text-text-muted">avg score</p>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </section>
      )}
    </div>
  );
}
