"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import {
  Users,
  BookOpen,
  Target,
  Activity,
  TrendingUp,
  Trophy,
  Library,
  Gift,
  BarChart2,
  Database,
  Brain,
  MessageSquare,
} from "lucide-react";
import Link from "next/link";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Avatar } from "@/components/ui/avatar";
import { StatCard } from "@/components/shared/stat-card";
import { Spinner } from "@/components/ui/spinner";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface AdminDashboardData {
  stats: {
    totalStudents: number;
    activeStudents: number;
    totalQuizzes: number;
    totalTextbooks: number;
    avgScore: number;
  };
  recentQuizzes: {
    id: string;
    score: number;
    totalQuestions: number;
    correctAnswers: number;
    totalPointsEarned: number;
    completedAt: string;
    student: { name: string; grade: number | null };
  }[];
  topStudents: {
    id: string;
    name: string;
    grade: number | null;
    section: string | null;
    totalPoints: number;
    xpLevel: number;
    avatarUrl: string | null;
    _count: { quizzes: number };
  }[];
}

interface HealthData {
  api: { status: "operational" | "down"; latencyMs: number; uptime: number };
  database: { status: "operational" | "down"; latencyMs: number };
  ai: { status: "operational" | "degraded" | "unavailable" };
  sms: { status: "operational" | "unavailable"; deliveryRate: number };
}

export default function AdminDashboardPage() {
  const t = useTranslations("admin");

  const [data, setData] = useState<AdminDashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [health, setHealth] = useState<HealthData | null>(null);

  useEffect(() => {
    async function fetchDashboard() {
      try {
        const res = await fetch("/api/admin/dashboard");
        if (!res.ok) throw new Error("Failed to load dashboard");
        setData(await res.json());
      } catch (e) {
        setError(e instanceof Error ? e.message : "Something went wrong");
      } finally {
        setLoading(false);
      }
    }
    fetchDashboard();
  }, []);

  useEffect(() => {
    async function fetchHealth() {
      try {
        const res = await fetch("/api/admin/health");
        if (res.ok) {
          setHealth(await res.json());
        }
      } catch {
        // silently fail — health bar just won't render
      }
    }
    fetchHealth();
    const interval = setInterval(fetchHealth, 60_000);
    return () => clearInterval(interval);
  }, []);

  if (loading) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <Spinner size="lg" className="text-primary" />
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="flex min-h-[60vh] flex-col items-center justify-center gap-4">
        <p className="text-text-secondary">{error || t("failedLoad")}</p>
        <Button variant="outline" onClick={() => window.location.reload()}>
          {t("tryAgain")}
        </Button>
      </div>
    );
  }

  const { stats, recentQuizzes, topStudents } = data;

  return (
    <div className="mx-auto max-w-6xl space-y-6 p-4 sm:p-6">
      {/* Page Title */}
      <div>
        <h1 className="text-2xl font-bold text-text-primary">{t("dashboardTitle")}</h1>
        <p className="text-sm text-text-secondary">
          {t("dashboardSubtitle")}
        </p>
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-5">
        <StatCard
          label={t("totalStudents")}
          value={stats.totalStudents}
          icon={Users}
        />
        <StatCard
          label={t("active7d")}
          value={
            stats.totalStudents > 0
              ? `${stats.activeStudents} (${Math.round((stats.activeStudents / stats.totalStudents) * 100)}%)`
              : stats.activeStudents
          }
          icon={Activity}
          trend="up"
        />
        <StatCard
          label={t("totalQuizzes")}
          value={stats.totalQuizzes.toLocaleString()}
          icon={BookOpen}
        />
        <StatCard
          label={t("textbooks")}
          value={stats.totalTextbooks}
          icon={TrendingUp}
        />
        <StatCard
          label={t("avgScore")}
          value={`${stats.avgScore}%`}
          icon={Target}
        />
      </div>

      {/* System Health Bar */}
      {health && (
        <Card>
          <CardContent className="flex flex-wrap items-center gap-4 px-4 py-3 sm:gap-6">
            <span className="text-xs font-semibold uppercase tracking-wide text-text-secondary">
              {t("systemHealth")}
            </span>

            <div className="flex items-center gap-2">
              <Activity className="h-4 w-4 text-text-secondary" />
              <span
                className={cn(
                  "h-2 w-2 shrink-0 rounded-full",
                  health.api.status === "operational"
                    ? "bg-green-500"
                    : "bg-red-500"
                )}
              />
              <span className="text-xs text-text-primary">{t("apiService")}</span>
              <Badge
                variant={
                  health.api.status === "operational" ? "success" : "error"
                }
                className="text-[10px] px-1.5 py-0"
              >
                {health.api.status === "operational"
                  ? `${t("operational")} (${health.api.uptime}%)`
                  : t("down")}
              </Badge>
            </div>

            <div className="flex items-center gap-2">
              <Database className="h-4 w-4 text-text-secondary" />
              <span
                className={cn(
                  "h-2 w-2 shrink-0 rounded-full",
                  health.database.status === "operational"
                    ? "bg-green-500"
                    : "bg-red-500"
                )}
              />
              <span className="text-xs text-text-primary">{t("databaseService")}</span>
              <Badge
                variant={
                  health.database.status === "operational" ? "success" : "error"
                }
                className="text-[10px] px-1.5 py-0"
              >
                {health.database.status === "operational"
                  ? `${health.database.latencyMs}ms`
                  : t("down")}
              </Badge>
            </div>

            <div className="flex items-center gap-2">
              <Brain className="h-4 w-4 text-text-secondary" />
              <span
                className={cn(
                  "h-2 w-2 shrink-0 rounded-full",
                  health.ai.status === "operational"
                    ? "bg-green-500"
                    : health.ai.status === "degraded"
                    ? "bg-yellow-500"
                    : "bg-red-500"
                )}
              />
              <span className="text-xs text-text-primary">{t("aiServices")}</span>
              <Badge
                variant={
                  health.ai.status === "operational"
                    ? "success"
                    : health.ai.status === "degraded"
                    ? "warning"
                    : "error"
                }
                className="text-[10px] px-1.5 py-0"
              >
                {health.ai.status === "operational"
                  ? t("operational")
                  : health.ai.status === "degraded"
                  ? t("degraded")
                  : t("unavailable")}
              </Badge>
            </div>

            <div className="flex items-center gap-2">
              <MessageSquare className="h-4 w-4 text-text-secondary" />
              <span
                className={cn(
                  "h-2 w-2 shrink-0 rounded-full",
                  health.sms.status === "operational"
                    ? "bg-green-500"
                    : "bg-red-500"
                )}
              />
              <span className="text-xs text-text-primary">{t("smsGateway")}</span>
              <Badge
                variant={
                  health.sms.status === "operational" ? "success" : "error"
                }
                className="text-[10px] px-1.5 py-0"
              >
                {health.sms.status === "operational"
                  ? `${t("operational")} (${health.sms.deliveryRate}%)`
                  : t("unavailable")}
              </Badge>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Admin Quick Links */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
        <AdminLink href="/admin/students" icon={Users} label={t("quickStudents")} desc={t("registeredCount", { count: stats.totalStudents })} />
        <AdminLink href="/admin/textbooks" icon={Library} label={t("quickTextbooks")} desc={t("availableCount", { count: stats.totalTextbooks })} />
        <AdminLink href="/admin/rewards" icon={Gift} label={t("quickRewards")} desc={t("quickRewardsDesc")} />
        <AdminLink href="/admin/games" icon={Trophy} label={t("quickGames")} desc={t("quickGamesDesc")} />
        <AdminLink href="/admin/analytics" icon={BarChart2} label={t("quickAnalytics")} desc={t("quickAnalyticsDesc")} />
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Top Students Leaderboard */}
        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <Trophy className="h-5 w-5 text-primary" />
              <h2 className="font-semibold text-text-primary">
                {t("topStudents")}
              </h2>
            </div>
          </CardHeader>
          <CardContent className="p-0">
            {topStudents.length === 0 ? (
              <p className="px-4 py-6 text-center text-sm text-text-secondary">
                {t("noStudentData")}
              </p>
            ) : (
              <div className="divide-y divide-border">
                {topStudents.map((student, index) => (
                  <div
                    key={student.id}
                    className="flex items-center gap-3 px-4 py-3"
                  >
                    <span
                      className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-sm font-bold ${
                        index === 0
                          ? "bg-yellow-100 text-yellow-700"
                          : index === 1
                          ? "bg-gray-100 text-gray-600"
                          : index === 2
                          ? "bg-orange-100 text-orange-600"
                          : "bg-background text-text-secondary"
                      }`}
                    >
                      {index + 1}
                    </span>
                    <Avatar
                      src={student.avatarUrl ?? undefined}
                      name={student.name}
                      size="sm"
                    />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-text-primary">
                        {student.name}
                      </p>
                      <p className="text-xs text-text-secondary">
                        {t("gradeLabel", { grade: student.grade ?? "—" })} &middot;{" "}
                        {t("quizzesCount", { count: student._count.quizzes })}
                      </p>
                    </div>
                    <div className="text-right">
                      <p className="text-sm font-bold text-primary">
                        {student.totalPoints.toLocaleString()}
                      </p>
                      <Badge variant="info" className="text-xs">
                        {t("lvlLabel", { level: student.xpLevel })}
                      </Badge>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Recent Quiz Activity */}
        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <Activity className="h-5 w-5 text-primary" />
              <h2 className="font-semibold text-text-primary">
                {t("recentActivity")}
              </h2>
            </div>
          </CardHeader>
          <CardContent className="p-0">
            {recentQuizzes.length === 0 ? (
              <p className="px-4 py-6 text-center text-sm text-text-secondary">
                {t("noQuizzesSubmitted")}
              </p>
            ) : (
              <div className="divide-y divide-border">
                {recentQuizzes.map((quiz) => (
                  <div
                    key={quiz.id}
                    className="flex items-center justify-between px-4 py-3"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-text-primary">
                        {quiz.student.name}
                      </p>
                      <p className="text-xs text-text-secondary">
                        {t("gradeLabel", { grade: quiz.student.grade ?? "—" })} &middot;{" "}
                        {t("correctTotal", { correct: quiz.correctAnswers, total: quiz.totalQuestions })}
                      </p>
                    </div>
                    <div className="ml-4 flex items-center gap-2">
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
                      <span className="text-xs text-text-secondary">
                        {new Date(quiz.completedAt).toLocaleDateString()}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function AdminLink({ href, icon: Icon, label, desc }: {
  href: string; icon: any; label: string; desc: string;
}) {
  return (
    <Link href={href}>
      <Card className="group cursor-pointer transition-all hover:shadow-md hover:-translate-y-0.5">
        <div className="p-4 text-center">
          <div className={cn("mx-auto mb-2 w-fit rounded-xl p-3 bg-primary/10 text-primary")}>
            <Icon className="h-6 w-6" />
          </div>
          <p className="font-semibold text-text-primary text-sm">{label}</p>
          <p className="text-xs text-text-muted mt-0.5">{desc}</p>
        </div>
      </Card>
    </Link>
  );
}
