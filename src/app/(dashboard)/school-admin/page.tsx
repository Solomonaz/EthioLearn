"use client";

import { useEffect, useState } from "react";
import { useSession } from "next-auth/react";
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
  HelpCircle,
  BookMarked,
  Settings,
} from "lucide-react";
import Link from "next/link";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Avatar } from "@/components/ui/avatar";
import { StatCard } from "@/components/shared/stat-card";
import { Spinner } from "@/components/ui/spinner";
import { Button } from "@/components/ui/button";
import { SubscriptionPanel } from "@/components/admin/subscription-panel";
import { cn } from "@/lib/utils";

interface DashboardData {
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

export default function SchoolAdminDashboardPage() {
  const t = useTranslations("admin");
  const { data: session } = useSession();
  const schoolId = (session?.user as { schoolId?: string } | undefined)?.schoolId;
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

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
        <p className="text-text-secondary">{error || "Failed to load"}</p>
        <Button variant="outline" onClick={() => window.location.reload()}>
          Try Again
        </Button>
      </div>
    );
  }

  const { stats, recentQuizzes, topStudents } = data;

  return (
    <div className="mx-auto max-w-6xl space-y-6 p-4 sm:p-6">
      {/* Page Title */}
      <div>
        <h1 className="text-2xl font-bold text-text-primary">
          School Dashboard
        </h1>
        <p className="text-sm text-text-secondary">
          Overview of your school&apos;s performance and activity
        </p>
      </div>

      {/* Subscription (read-only for school admins) */}
      {schoolId && <SubscriptionPanel audience="SCHOOL" targetId={schoolId} readOnly />}

      {/* Stats Grid */}
      <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-5">
        <StatCard
          label="Total Students"
          value={stats.totalStudents}
          icon={Users}
        />
        <StatCard
          label="Active (7d)"
          value={
            stats.totalStudents > 0
              ? `${stats.activeStudents} (${Math.round((stats.activeStudents / stats.totalStudents) * 100)}%)`
              : stats.activeStudents
          }
          icon={Activity}
          trend="up"
        />
        <StatCard
          label="Total Quizzes"
          value={stats.totalQuizzes.toLocaleString()}
          icon={BookOpen}
        />
        <StatCard
          label="Textbooks"
          value={stats.totalTextbooks}
          icon={TrendingUp}
        />
        <StatCard
          label="Avg Score"
          value={`${stats.avgScore}%`}
          icon={Target}
        />
      </div>

      {/* Quick Links */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <QuickLink href="/school-admin/students" icon={Users} label="Students" desc={`${stats.totalStudents} registered`} />
        <QuickLink href="/school-admin/textbooks" icon={Library} label="Textbooks" desc={`${stats.totalTextbooks} available`} />
        <QuickLink href="/school-admin/subjects" icon={BookMarked} label="Subjects" desc="Manage" />
        <QuickLink href="/school-admin/questions" icon={HelpCircle} label="Questions" desc="Manage" />
        <QuickLink href="/school-admin/rewards" icon={Gift} label="Rewards" desc="Manage" />
        <QuickLink href="/school-admin/analytics" icon={BarChart2} label="Analytics" desc="View reports" />
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Top Students Leaderboard */}
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Trophy className="h-5 w-5 text-primary" />
                <h2 className="font-semibold text-text-primary">
                  Top Students
                </h2>
              </div>
              <Link href="/school-admin/students">
                <Button variant="ghost" size="sm">View All</Button>
              </Link>
            </div>
          </CardHeader>
          <CardContent className="p-0">
            {topStudents.length === 0 ? (
              <p className="px-4 py-6 text-center text-sm text-text-secondary">
                No student data yet.
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
                        Grade {student.grade ?? "—"} &middot;{" "}
                        {student._count.quizzes} quizzes
                      </p>
                    </div>
                    <div className="text-right">
                      <p className="text-sm font-bold text-primary">
                        {student.totalPoints.toLocaleString()}
                      </p>
                      <Badge variant="info" className="text-xs">
                        Lvl {student.xpLevel}
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
                Recent Activity
              </h2>
            </div>
          </CardHeader>
          <CardContent className="p-0">
            {recentQuizzes.length === 0 ? (
              <p className="px-4 py-6 text-center text-sm text-text-secondary">
                No quizzes submitted yet.
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
                        Grade {quiz.student.grade ?? "—"} &middot;{" "}
                        {quiz.correctAnswers}/{quiz.totalQuestions} correct
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

function QuickLink({ href, icon: Icon, label, desc }: {
  href: string; icon: any; label: string; desc: string;
}) {
  return (
    <Link href={href}>
      <Card className="group cursor-pointer transition-all hover:shadow-md hover:-translate-y-0.5">
        <div className="p-4 text-center">
          <div className={cn("mx-auto mb-2 w-fit rounded-xl p-3 bg-primary/10 text-primary")}>
            <Icon className="h-5 w-5" />
          </div>
          <p className="font-semibold text-text-primary text-sm">{label}</p>
          <p className="text-xs text-text-muted mt-0.5">{desc}</p>
        </div>
      </Card>
    </Link>
  );
}
