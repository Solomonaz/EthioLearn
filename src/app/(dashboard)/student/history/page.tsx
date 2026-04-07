"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import {
  BookOpen,
  Target,
  Trophy,
  Star,
  ChevronLeft,
  ChevronRight,
  Clock,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { SkeletonRow } from "@/components/ui/skeleton";
import { formatDate, scoreVariant } from "@/lib/utils";

// ── Types ────────────────────────────────────────────────────────────────────

interface QuizItem {
  id: string;
  mode: string;
  score: number;
  totalPointsEarned: number;
  totalQuestions: number;
  correctAnswers: number;
  completedAt: string;
  startedAt: string;
  subject: string | null;
  textbookTitle: string | null;
  chapterTitle: string | null;
  chapterNumber: number | null;
}

interface QuizStats {
  totalQuizzes: number;
  avgScore: number;
  totalPoints: number;
  bestScore: number;
}

interface QuizHistoryData {
  quizzes: QuizItem[];
  total: number;
  page: number;
  totalPages: number;
  stats: QuizStats;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

// Subjects will be fetched dynamically via the API

const SORT_OPTIONS = [
  { value: "date", label: "Recent First" },
  { value: "score", label: "Highest Score" },
  { value: "points", label: "Most Points" },
];

// ── Page ─────────────────────────────────────────────────────────────────────

export default function QuizHistoryPage() {
  const [data, setData] = useState<QuizHistoryData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [page, setPage] = useState(1);
  const [subject, setSubject] = useState("");
  const [subjectsList, setSubjectsList] = useState<string[]>(["All Subjects"]);
  const [sortBy, setSortBy] = useState("date");

  useEffect(() => {
    async function fetchSubjects() {
      try {
        const res = await fetch("/api/subjects");
        if (res.ok) {
          const data = await res.json();
          setSubjectsList([
            "All Subjects",
            ...(data.subjects as { id: string; name: string }[]).map((s) => s.name),
          ]);
        }
      } catch (err) {
        console.error("Failed to fetch subjects", err);
      }
    }
    fetchSubjects();
  }, []);

  const fetchHistory = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({
        page: String(page),
        limit: "10",
        sortBy,
      });
      if (subject) params.set("subject", subject);

      const res = await fetch(`/api/students/me/quizzes?${params}`);
      if (!res.ok) throw new Error("Failed to load quiz history");
      const json = await res.json();
      setData(json);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setLoading(false);
    }
  }, [page, subject, sortBy]);

  useEffect(() => {
    fetchHistory();
  }, [fetchHistory]);

  // Reset page when filters change
  useEffect(() => {
    setPage(1);
  }, [subject, sortBy]);

  if (loading && !data) {
    return (
      <div className="mx-auto max-w-4xl space-y-6 p-4 sm:p-6">
        <div>
          <h1 className="text-2xl font-bold text-text-primary">Quiz History</h1>
          <p className="mt-1 text-sm text-text-secondary">Review your past quiz performance</p>
        </div>
        <div className="rounded-xl border border-border overflow-hidden">
          {Array.from({ length: 5 }).map((_, i) => (
            <SkeletonRow key={i} />
          ))}
        </div>
      </div>
    );
  }

  if (error && !data) {
    return (
      <div className="flex min-h-[60vh] flex-col items-center justify-center gap-4">
        <p className="text-text-secondary">{error}</p>
        <Button variant="outline" onClick={fetchHistory}>
          Try Again
        </Button>
      </div>
    );
  }

  const stats = data?.stats;
  const quizzes = data?.quizzes ?? [];
  const totalPages = data?.totalPages ?? 1;

  return (
    <div className="mx-auto max-w-4xl space-y-6 p-4 sm:p-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-text-primary">Quiz History</h1>
        <p className="mt-1 text-sm text-text-secondary">
          Review your past quiz performance
        </p>
      </div>

      {/* Stats Cards */}
      {stats && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 sm:gap-4">
          <StatMiniCard
            label="Total Quizzes"
            value={stats.totalQuizzes}
            icon={<BookOpen className="h-5 w-5 text-primary" />}
          />
          <StatMiniCard
            label="Avg Score"
            value={`${stats.avgScore}%`}
            icon={<Target className="h-5 w-5 text-primary" />}
          />
          <StatMiniCard
            label="Total Points"
            value={stats.totalPoints.toLocaleString()}
            icon={<Star className="h-5 w-5 text-primary" />}
          />
          <StatMiniCard
            label="Best Score"
            value={`${stats.bestScore}%`}
            icon={<Trophy className="h-5 w-5 text-primary" />}
          />
        </div>
      )}

      {/* Filters Bar */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex gap-3">
          <select
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            className="rounded-lg border border-border bg-surface px-3 py-2 text-sm text-text-primary outline-none focus:border-primary focus:ring-1 focus:ring-primary"
          >
            {subjectsList.map((s) => (
              <option key={s} value={s === "All Subjects" ? "" : s}>
                {s}
              </option>
            ))}
          </select>

          <select
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value)}
            className="rounded-lg border border-border bg-surface px-3 py-2 text-sm text-text-primary outline-none focus:border-primary focus:ring-1 focus:ring-primary"
          >
            {SORT_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </div>

        {loading && <Spinner size="sm" className="text-primary" />}
      </div>

      {/* Quiz List */}
      {quizzes.length === 0 ? (
        <Card>
          <CardContent className="py-16 text-center">
            <BookOpen className="mx-auto mb-3 h-12 w-12 text-text-secondary/40" />
            <p className="text-lg font-medium text-text-primary">
              No quizzes yet
            </p>
            <p className="mt-1 text-sm text-text-secondary">
              Take your first quiz to see your history here!
            </p>
            <Link href="/student/quiz" className="mt-4 inline-block">
              <Button size="md">Start a Quiz</Button>
            </Link>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {quizzes.map((quiz) => (
            <Card
              key={quiz.id}
              className="transition-shadow hover:shadow-md"
            >
              <CardContent className="py-4">
                <div className="flex items-start justify-between gap-3">
                  {/* Left: Subject + details */}
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="text-sm font-semibold text-text-primary">
                        {quiz.subject
                          ? `${quiz.subject}${quiz.chapterNumber != null ? ` — Ch. ${quiz.chapterNumber}: ${quiz.chapterTitle}` : ""}`
                          : `${quiz.mode} Quiz`}
                      </p>
                      <Badge variant={scoreVariant(quiz.score)}>
                        {quiz.score}%
                      </Badge>
                      <Badge
                        variant={
                          quiz.mode === "SOLO"
                            ? "info"
                            : quiz.mode === "TIMED"
                              ? "warning"
                              : "default"
                        }
                      >
                        {quiz.mode}
                      </Badge>
                    </div>

                    <div className="mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-text-secondary">
                      <span>
                        {quiz.correctAnswers}/{quiz.totalQuestions} correct
                      </span>
                      <span className="flex items-center gap-1">
                        <Star className="h-3 w-3" />
                        +{quiz.totalPointsEarned} pts
                      </span>
                      <span className="flex items-center gap-1">
                        <Clock className="h-3 w-3" />
                        {formatDate(quiz.completedAt)}
                      </span>
                    </div>
                  </div>

                  {/* Right: Points */}
                  <div className="shrink-0 text-right">
                    <p className="text-lg font-bold text-primary">
                      +{quiz.totalPointsEarned}
                    </p>
                    <p className="text-xs text-text-secondary">points</p>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-2">
          <Button
            variant="outline"
            size="sm"
            disabled={page <= 1}
            onClick={() => setPage((p) => p - 1)}
          >
            <ChevronLeft className="h-4 w-4" />
            Prev
          </Button>

          <div className="flex items-center gap-1">
            {Array.from({ length: totalPages }, (_, i) => i + 1)
              .filter((p) => {
                // Show first, last, and pages near current
                return (
                  p === 1 ||
                  p === totalPages ||
                  Math.abs(p - page) <= 1
                );
              })
              .reduce<(number | "ellipsis")[]>((acc, p, idx, arr) => {
                if (idx > 0 && arr[idx - 1] !== p - 1) {
                  acc.push("ellipsis");
                }
                acc.push(p);
                return acc;
              }, [])
              .map((item, idx) =>
                item === "ellipsis" ? (
                  <span
                    key={`ellipsis-${idx}`}
                    className="px-2 text-sm text-text-secondary"
                  >
                    ...
                  </span>
                ) : (
                  <button
                    key={item}
                    onClick={() => setPage(item)}
                    className={`h-8 w-8 rounded-lg text-sm font-medium transition-colors ${
                      page === item
                        ? "bg-primary text-white"
                        : "text-text-secondary hover:bg-gray-100"
                    }`}
                  >
                    {item}
                  </button>
                ),
              )}
          </div>

          <Button
            variant="outline"
            size="sm"
            disabled={page >= totalPages}
            onClick={() => setPage((p) => p + 1)}
          >
            Next
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      )}
    </div>
  );
}

// ── Sub-component ─────────────────────────────────────────────────────────────

function StatMiniCard({
  label,
  value,
  icon,
}: {
  label: string;
  value: string | number;
  icon: React.ReactNode;
}) {
  return (
    <Card>
      <CardContent className="py-4">
        <div className="flex items-start justify-between">
          <div>
            <p className="text-xs text-text-secondary">{label}</p>
            <p className="mt-1 text-2xl font-bold text-text-primary">
              {value}
            </p>
          </div>
          <div className="rounded-lg bg-primary/10 p-2">{icon}</div>
        </div>
      </CardContent>
    </Card>
  );
}
