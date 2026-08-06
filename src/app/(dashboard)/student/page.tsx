"use client";

import { useEffect, useState, useMemo } from "react";
import { useSession } from "next-auth/react";
import { useTranslations } from "next-intl";
import Link from "next/link";
import {
  Trophy,
  BookOpen,
  Target,
  Flame,
  ArrowRight,
  Swords,
  Gift,
  AlertTriangle,
  Brain,
  ChevronRight,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ProgressBar } from "@/components/ui/progress-bar";
import { StatCard } from "@/components/shared/stat-card";
import { Spinner } from "@/components/ui/spinner";
import { Skeleton, SkeletonCard } from "@/components/ui/skeleton";
import { useEntitlements } from "@/hooks/use-entitlements";
import { cn } from "@/lib/utils";

// ── Types ────────────────────────────────────────────────────────────────────

interface ChallengeData {
  completed: boolean;
  chapterId: string | null;
  chapterTitle?: string;
  subject?: string;
  questionCount?: number;
  pointsEarned?: number;
}

interface WeakestChapter {
  id: string;
  title: string;
  subject: string;
  grade: number;
  avgScore: number;
  attemptCount: number;
}

interface StudyRecommendation {
  chapterId: string;
  subject: string;
  chapter: string;
  avgScore: number;
  message: string;
  focusAreas: string[];
}

interface DailyMessageData {
  en: string;
  am: string;
}

interface DashboardData {
  user: {
    id: string;
    name: string;
    grade: number | null;
    xpLevel: number;
    totalPoints: number;
    streakDays: number;
    avatarUrl: string | null;
  };
  stats: {
    totalQuizzes: number;
    averageScore: number;
    totalPoints: number;
    streakDays: number;
  };
  recentQuizzes: {
    id: string;
    mode: string;
    score: number;
    totalQuestions: number;
    correctAnswers: number;
    totalPointsEarned: number;
    completedAt: string;
  }[];
  weakestChapters: WeakestChapter[];
  studyRecommendations: StudyRecommendation[];
  dailyMessage: DailyMessageData;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function getLocale(): "en" | "am" {
  if (typeof document === "undefined") return "en";
  const match = document.cookie.match(/(?:^|;\s*)locale=(\w+)/);
  return match?.[1] === "am" ? "am" : "en";
}

// ── Page ─────────────────────────────────────────────────────────────────────

export default function StudentDashboardPage() {
  const { data: session } = useSession();
  const ent = useEntitlements();
  const t  = useTranslations("student");
  const [dashboard, setDashboard] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [challenge, setChallenge] = useState<ChallengeData | null>(null);

  const locale = useMemo(() => getLocale(), []);

  useEffect(() => {
    async function fetchDashboard() {
      try {
        const res = await fetch("/api/students/me/dashboard");
        if (!res.ok) throw new Error("Failed to load dashboard");
        const data = await res.json();
        setDashboard(data);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Something went wrong");
      } finally {
        setLoading(false);
      }
    }
    async function fetchChallenge() {
      try {
        const res = await fetch("/api/students/me/daily-challenge");
        if (res.ok) {
          const data = await res.json();
          setChallenge(data);
        }
      } catch {
        // Challenge widget is non-critical; silently ignore errors
      }
    }
    fetchDashboard();
    fetchChallenge();
  }, []);

  if (loading) {
    return (
      <div className="mx-auto max-w-4xl space-y-6 p-4 sm:p-6">
        <Skeleton className="h-24 w-full rounded-xl" />
        <Skeleton className="h-20 w-full rounded-xl" />
        <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
          <SkeletonCard />
          <SkeletonCard />
          <SkeletonCard />
          <SkeletonCard />
        </div>
        <Skeleton className="h-16 w-full rounded-xl" />
        <Skeleton className="h-48 w-full rounded-xl" />
      </div>
    );
  }

  if (error || !dashboard) {
    return (
      <div className="flex min-h-[60vh] flex-col items-center justify-center gap-4">
        <p className="text-text-secondary">{error || t("failedLoad")}</p>
        <Button variant="outline" onClick={() => window.location.reload()}>
          {t("tryAgain")}
        </Button>
      </div>
    );
  }

  const { user, stats, recentQuizzes, weakestChapters, studyRecommendations, dailyMessage } =
    dashboard;
  const levelProgress = user.totalPoints % 100;
  const userName = session?.user?.name || user.name;

  return (
    <div className="mx-auto max-w-4xl space-y-6 p-4 sm:p-6">
      {/* ── Rotating Motivational Welcome Banner (SRS §4.3.1) ──────────── */}
      <Card className="bg-primary text-white">
        <CardContent className="py-6">
          <h1 className="text-xl font-bold sm:text-2xl">
            {t("welcome")}, {userName}!
          </h1>
          <p className="mt-1 text-sm text-white/80">
            {dailyMessage
              ? locale === "am"
                ? dailyMessage.am
                : dailyMessage.en
              : "Keep up the great work. Every quiz brings you closer to mastery."}
          </p>
        </CardContent>
      </Card>

      {/* XP Level Progress */}
      <Card>
        <CardContent>
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-text-secondary">{t("xpLevel")}</p>
              <p className="text-2xl font-bold text-primary">{t("levelLabel", { level: user.xpLevel })}</p>
            </div>
            <div className="rounded-full bg-primary/10 px-3 py-1 text-sm font-semibold text-primary">
              {user.totalPoints} XP
            </div>
          </div>
          <div className="mt-3">
            <div className="mb-1 flex justify-between text-xs text-text-secondary">
              <span>{t("progressTo", { level: user.xpLevel + 1 })}</span>
              <span>{t("xpPoints", { points: levelProgress })}/100</span>
            </div>
            <ProgressBar value={levelProgress} color="primary" size="md" />
          </div>
        </CardContent>
      </Card>

      {/* Daily Challenge Widget */}
      {challenge && challenge.chapterId !== null &&
        (challenge.completed ? (
          <Card className="border border-border bg-surface">
            <CardContent className="py-4">
              <p className="text-base font-semibold text-text-primary">
                {t("challengeComplete")}
              </p>
              <p className="mt-1 text-sm text-text-secondary">
                {t("challengeBonus")}
              </p>
            </CardContent>
          </Card>
        ) : (
          <Card className="border-2 border-green-500 bg-surface">
            <CardContent className="py-4">
              <p className="text-base font-semibold text-text-primary">
                {t("todayChallenge")}
              </p>
              <p className="mt-1 text-sm text-text-secondary">
                {t("challengeDetails", { subject: challenge.subject ?? "" })}
              </p>
              <div className="mt-3">
                <Link
                  href={`/student/quiz?challenge=true&chapterId=${challenge.chapterId}&count=5`}
                >
                  <Button
                    size="sm"
                    className="bg-green-600 text-white hover:bg-green-700"
                  >
                    {t("startChallenge")}
                  </Button>
                </Link>
              </div>
            </CardContent>
          </Card>
        ))}

      {/* Stats Grid */}
      <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
        <StatCard label={t("totalPoints")} value={stats.totalPoints.toLocaleString()} icon={Trophy} />
        <StatCard label={t("quizzesTaken")} value={stats.totalQuizzes} icon={BookOpen} />
        <StatCard label={t("avgScore")} value={`${stats.averageScore}%`} icon={Target} />
        <StatCard label={t("streak")} value={stats.streakDays} icon={Flame} />
      </div>

      {/* ── AI Study Recommendations (SRS §4.3.3) — AI feature, full-access only ── */}
      {ent.ai && studyRecommendations.length > 0 && (
        <section>
          <div className="mb-3 flex items-center gap-2">
            <Brain className="h-5 w-5 text-purple-500" />
            <h2 className="text-lg font-semibold text-text-primary">
              {t("studyRecs")}
            </h2>
          </div>
          <div className="space-y-3">
            {studyRecommendations.map((rec) => (
              <Card
                key={rec.chapterId}
                className="border-purple-200 bg-purple-50/50 transition-colors hover:bg-purple-50"
              >
                <CardContent className="flex items-start gap-3 py-4">
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-bold uppercase tracking-wider text-purple-600">
                      {rec.subject}
                    </p>
                    <p className="mt-0.5 text-sm font-medium leading-relaxed text-purple-900">
                      {rec.message}
                    </p>
                    {rec.focusAreas && rec.focusAreas.length > 0 && (
                      <div className="mt-2">
                        <p className="text-xs font-semibold uppercase tracking-wide text-purple-500">
                          Focus areas
                        </p>
                        <ul className="mt-1 space-y-1">
                          {rec.focusAreas.map((f, i) => (
                            <li key={i} className="flex items-start gap-1.5 text-sm text-purple-900/90">
                              <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-purple-400" />
                              <span>{f}</span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </div>
                  <Link
                    href={`/student/quiz?chapterId=${rec.chapterId}&count=10`}
                    className="flex-shrink-0"
                  >
                    <Button
                      size="sm"
                      variant="outline"
                      className="border-purple-300 text-purple-700 hover:bg-purple-100"
                    >
                      {t("practice")}
                      <ChevronRight className="ml-1 h-4 w-4" />
                    </Button>
                  </Link>
                </CardContent>
              </Card>
            ))}
          </div>
        </section>
      )}

      {/* ── Weakest Topics (SRS §4.3.3) ────────────────────────────────── */}
      {weakestChapters.length > 0 && (
        <section>
          <div className="mb-3 flex items-center gap-2">
            <AlertTriangle className="h-5 w-5 text-amber-500" />
            <h2 className="text-lg font-semibold text-text-primary">
              {t("weakTopics")}
            </h2>
            <Badge variant="warning" className="text-xs">
              {t("needsAttention")}
            </Badge>
          </div>
          <Card className="overflow-hidden border-amber-200">
            <div className="divide-y divide-amber-100">
              {weakestChapters.map((ch) => (
                <div
                  key={ch.id}
                  className="flex items-center justify-between px-4 py-3 transition-colors hover:bg-amber-50/50"
                >
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold text-text-primary">
                      {ch.title}
                    </p>
                    <p className="mt-0.5 text-xs text-text-secondary">
                      {ch.subject} &middot; {ch.attemptCount}{" "}
                      {ch.attemptCount === 1 ? t("attempt") : t("attempts")}
                    </p>
                  </div>
                  <div className="ml-4 flex items-center gap-3">
                    <div className="text-right">
                      <p
                        className={cn(
                          "text-lg font-bold",
                          ch.avgScore < 40 ? "text-red-600" : "text-amber-600"
                        )}
                      >
                        {ch.avgScore}%
                      </p>
                    </div>
                    <Link
                      href={`/student/quiz?chapterId=${ch.id}&count=10`}
                      className="flex-shrink-0"
                    >
                      <Button
                        size="sm"
                        variant="outline"
                        className="border-amber-300 text-amber-700 hover:bg-amber-100"
                      >
                        {t("retry")}
                      </Button>
                    </Link>
                  </div>
                </div>
              ))}
            </div>
            <div className="border-t border-amber-100 bg-amber-50/30 px-4 py-2">
              <Link
                href="/student/progress"
                className="flex items-center justify-center gap-1 text-xs font-medium text-amber-700 hover:text-amber-900"
              >
                {t("viewProgress")}
                <ChevronRight className="h-3 w-3" />
              </Link>
            </div>
          </Card>
        </section>
      )}

      {/* Quick Actions */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <QuickAction href="/student/quiz" icon={BookOpen} label={t("takeQuiz")} desc={t("startNewQuizDesc")} color="bg-primary/10 text-primary" />
        {ent.multiplayer && (
          <QuickAction href="/student/battle" icon={Swords} label={t("battleMode")} desc={t("challengeClassmates")} color="bg-purple-50 text-purple-600" />
        )}
        {ent.leaderboard && (
          <QuickAction href="/student/leaderboard" icon={Trophy} label={t("leaderboard")} desc={t("checkRankings")} color="bg-yellow-50 text-yellow-600" />
        )}
        {ent.rewards && (
          <QuickAction href="/student/rewards" icon={Gift} label={t("rewards")} desc={t("redeemPoints")} color="bg-orange-50 text-orange-600" />
        )}
      </div>

      {/* Start New Quiz Button */}
      <Link href="/student/quiz" className="block">
        <Button size="lg" className="w-full gap-2 text-base">
          {t("startQuiz")}
          <ArrowRight className="h-5 w-5" />
        </Button>
      </Link>

      {/* Recent Quizzes */}
      <div>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-text-primary">{t("recentQuizzes")}</h2>
          <Link href="/student/history" className="text-sm text-primary hover:underline">
            {t("viewAll")}
          </Link>
        </div>
        {recentQuizzes.length === 0 ? (
          <Card>
            <CardContent className="py-8 text-center">
              <BookOpen className="mx-auto mb-2 h-10 w-10 text-text-secondary/40" />
              <p className="text-text-secondary">{t("noQuizzes")}</p>
              <p className="mt-1 text-sm text-text-secondary/70">
                {t("noQuizzesDesc")}
              </p>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-3">
            {recentQuizzes.map((quiz) => (
              <Card key={quiz.id} className="transition-shadow hover:shadow-md">
                <CardContent className="flex items-center justify-between py-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <p className="text-sm font-medium text-text-primary">
                        {quiz.mode} Quiz
                      </p>
                      <Badge
                        variant={
                          quiz.score >= 70
                            ? "success"
                            : quiz.score >= 40
                              ? "warning"
                              : "error"
                        }
                      >
                        {quiz.score}%
                      </Badge>
                    </div>
                    <p className="mt-0.5 text-xs text-text-secondary">
                      {t("correctLabel", { correct: quiz.correctAnswers, total: quiz.totalQuestions })}
                      {" \u2022 "}
                      {new Date(quiz.completedAt).toLocaleDateString()}
                    </p>
                  </div>
                  <div className="ml-4 text-right">
                    <p className="text-sm font-semibold text-primary">
                      +{quiz.totalPointsEarned}
                    </p>
                    <p className="text-xs text-text-secondary">{t("pointsLabel")}</p>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Sub-component ──────────────────────────────────────────────────────────

function QuickAction({
  href,
  icon: Icon,
  label,
  desc,
  color,
}: {
  href: string;
  icon: any;
  label: string;
  desc: string;
  color: string;
}) {
  return (
    <Link href={href}>
      <Card className="group cursor-pointer transition-all hover:shadow-md hover:-translate-y-0.5">
        <div className="p-4 text-center">
          <div className={cn("mx-auto mb-2 w-fit rounded-xl p-3", color)}>
            <Icon className="h-6 w-6" />
          </div>
          <p className="text-sm font-semibold text-text-primary">{label}</p>
          <p className="mt-0.5 text-xs text-text-muted">{desc}</p>
        </div>
      </Card>
    </Link>
  );
}
