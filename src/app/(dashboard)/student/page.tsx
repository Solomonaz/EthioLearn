"use client";

import { useEffect, useState } from "react";
import { useSession } from "next-auth/react";
import Link from "next/link";
import { Trophy, BookOpen, Target, Flame, ArrowRight, Swords, Gift } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ProgressBar } from "@/components/ui/progress-bar";
import { StatCard } from "@/components/shared/stat-card";
import { Spinner } from "@/components/ui/spinner";
import { Skeleton, SkeletonCard } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

interface ChallengeData {
  completed: boolean;
  chapterId: string | null;
  chapterTitle?: string;
  subject?: string;
  questionCount?: number;
  pointsEarned?: number;
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
}

export default function StudentDashboardPage() {
  const { data: session } = useSession();
  const [dashboard, setDashboard] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [challenge, setChallenge] = useState<ChallengeData | null>(null);

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
        {/* Welcome banner placeholder */}
        <Skeleton className="h-24 w-full rounded-xl" />
        {/* XP progress placeholder */}
        <Skeleton className="h-20 w-full rounded-xl" />
        {/* Stats grid */}
        <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
          <SkeletonCard />
          <SkeletonCard />
          <SkeletonCard />
          <SkeletonCard />
        </div>
        {/* Quick actions placeholder */}
        <Skeleton className="h-16 w-full rounded-xl" />
        {/* Recent quizzes placeholder */}
        <Skeleton className="h-48 w-full rounded-xl" />
      </div>
    );
  }

  if (error || !dashboard) {
    return (
      <div className="flex min-h-[60vh] flex-col items-center justify-center gap-4">
        <p className="text-text-secondary">{error || "Failed to load dashboard"}</p>
        <Button variant="outline" onClick={() => window.location.reload()}>
          Try Again
        </Button>
      </div>
    );
  }

  const { user, stats, recentQuizzes } = dashboard;
  const levelProgress = user.totalPoints % 100;
  const userName = session?.user?.name || user.name;

  return (
    <div className="mx-auto max-w-4xl space-y-6 p-4 sm:p-6">
      {/* Welcome Banner */}
      <Card className="bg-primary text-white">
        <CardContent className="py-6">
          <h1 className="text-xl font-bold sm:text-2xl">
            Welcome back, {userName}!
          </h1>
          <p className="mt-1 text-sm text-white/80">
            Keep up the great work. Every quiz brings you closer to mastery.
          </p>
        </CardContent>
      </Card>

      {/* XP Level Progress */}
      <Card>
        <CardContent>
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-text-secondary">XP Level</p>
              <p className="text-2xl font-bold text-primary">
                Level {user.xpLevel}
              </p>
            </div>
            <div className="rounded-full bg-primary/10 px-3 py-1 text-sm font-semibold text-primary">
              {user.totalPoints} XP
            </div>
          </div>
          <div className="mt-3">
            <div className="mb-1 flex justify-between text-xs text-text-secondary">
              <span>Progress to Level {user.xpLevel + 1}</span>
              <span>{levelProgress}/100 XP</span>
            </div>
            <ProgressBar value={levelProgress} color="primary" size="md" />
          </div>
        </CardContent>
      </Card>

      {/* Daily Challenge Widget */}
      {challenge && challenge.chapterId !== null && (
        challenge.completed ? (
          <Card className="border border-border bg-surface">
            <CardContent className="py-4">
              <p className="text-base font-semibold text-text-primary">
                Challenge Complete! ✅
              </p>
              <p className="mt-1 text-sm text-text-secondary">
                You earned +50 bonus points today. Come back tomorrow!
              </p>
            </CardContent>
          </Card>
        ) : (
          <Card className="border-2 border-green-500 bg-surface">
            <CardContent className="py-4">
              <p className="text-base font-semibold text-text-primary">
                Today&apos;s Challenge 🎯
              </p>
              <p className="mt-1 text-sm text-text-secondary">
                5 questions from {challenge.subject} &bull; +50 bonus points
              </p>
              <div className="mt-3">
                <Link
                  href={`/student/quiz?challenge=true&chapterId=${challenge.chapterId}&count=5`}
                >
                  <Button size="sm" className="bg-green-600 hover:bg-green-700 text-white">
                    Start Challenge
                  </Button>
                </Link>
              </div>
            </CardContent>
          </Card>
        )
      )}

      {/* Stats Grid */}
      <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
        <StatCard
          label="Total Points"
          value={stats.totalPoints.toLocaleString()}
          icon={Trophy}
        />
        <StatCard
          label="Quizzes Taken"
          value={stats.totalQuizzes}
          icon={BookOpen}
        />
        <StatCard
          label="Average Score"
          value={`${stats.averageScore}%`}
          icon={Target}
        />
        <StatCard
          label="Day Streak"
          value={stats.streakDays}
          icon={Flame}
        />
      </div>

      {/* Quick Actions */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <QuickAction href="/student/quiz" icon={BookOpen} label="Take Quiz" desc="Start a new quiz" color="bg-primary/10 text-primary" />
        <QuickAction href="/student/battle" icon={Swords} label="Battle Mode" desc="Challenge classmates" color="bg-purple-50 text-purple-600" />
        <QuickAction href="/student/leaderboard" icon={Trophy} label="Leaderboard" desc="Check rankings" color="bg-yellow-50 text-yellow-600" />
        <QuickAction href="/student/rewards" icon={Gift} label="Rewards" desc="Redeem points" color="bg-orange-50 text-orange-600" />
      </div>

      {/* Start New Quiz Button */}
      <Link href="/student/quiz" className="block">
        <Button size="lg" className="w-full gap-2 text-base">
          Start New Quiz
          <ArrowRight className="h-5 w-5" />
        </Button>
      </Link>

      {/* Recent Quizzes */}
      <div>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-text-primary">
            Recent Quizzes
          </h2>
          <Link href="/student/history" className="text-sm text-primary hover:underline">View All</Link>
        </div>
        {recentQuizzes.length === 0 ? (
          <Card>
            <CardContent className="py-8 text-center">
              <BookOpen className="mx-auto mb-2 h-10 w-10 text-text-secondary/40" />
              <p className="text-text-secondary">No quizzes yet</p>
              <p className="mt-1 text-sm text-text-secondary/70">
                Start your first quiz to see your progress here.
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
                        variant={quiz.score >= 70 ? "success" : quiz.score >= 40 ? "warning" : "error"}
                      >
                        {quiz.score}%
                      </Badge>
                    </div>
                    <p className="mt-0.5 text-xs text-text-secondary">
                      {quiz.correctAnswers}/{quiz.totalQuestions} correct
                      {" \u2022 "}
                      {new Date(quiz.completedAt).toLocaleDateString()}
                    </p>
                  </div>
                  <div className="ml-4 text-right">
                    <p className="text-sm font-semibold text-primary">
                      +{quiz.totalPointsEarned}
                    </p>
                    <p className="text-xs text-text-secondary">points</p>
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

function QuickAction({ href, icon: Icon, label, desc, color }: {
  href: string; icon: any; label: string; desc: string; color: string;
}) {
  return (
    <Link href={href}>
      <Card className="group cursor-pointer transition-all hover:shadow-md hover:-translate-y-0.5">
        <div className="p-4 text-center">
          <div className={cn("mx-auto mb-2 w-fit rounded-xl p-3", color)}>
            <Icon className="h-6 w-6" />
          </div>
          <p className="font-semibold text-text-primary text-sm">{label}</p>
          <p className="text-xs text-text-muted mt-0.5">{desc}</p>
        </div>
      </Card>
    </Link>
  );
}
