"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import {
  ArrowLeft,
  Trophy,
  BookOpen,
  Target,
  Flame,
  Calendar,
  School,
  Phone,
  TrendingUp,
  Star,
  Clock,
} from "lucide-react";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Avatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { ProgressBar } from "@/components/ui/progress-bar";
import { formatDate, scoreVariant } from "@/lib/utils";
import { cn } from "@/lib/utils";

// ── Types ─────────────────────────────────────────────────────────────────────

interface Achievement {
  id: string;
  name: string;
  desc: string;
  icon: string;
  earned: boolean;
}

interface SubjectMastery {
  subject: string;
  quizzes: number;
  avgScore: number;
  totalPoints: number;
}

interface RecentQuiz {
  id: string;
  score: number;
  totalQuestions: number;
  correctAnswers: number;
  totalPointsEarned: number;
  completedAt: string | null;
  subject: string | null;
  chapterTitle: string | null;
  chapterNumber: number | null;
}

interface PointEntry {
  id: string;
  actionType: string;
  points: number;
  description: string | null;
  createdAt: string;
}

interface StudentDetailResponse {
  student: {
    id: string;
    name: string;
    phoneNumber: string;
    grade: number | null;
    section: string | null;
    xpLevel: number;
    totalPoints: number;
    avatarUrl: string | null;
    streakDays: number;
    lastActiveAt: string | null;
    createdAt: string;
    school: { name: string } | null;
  };
  stats: {
    totalQuizzes: number;
    avgScore: number;
  };
  subjectMastery: SubjectMastery[];
  recentQuizzes: RecentQuiz[];
  achievements: Achievement[];
  pointLedger: PointEntry[];
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function relativeTime(iso: string | null): string {
  if (!iso) return "Never";
  const diff = Date.now() - new Date(iso).getTime();
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return "Just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months}mo ago`;
  return `${Math.floor(months / 12)}y ago`;
}


function actionTypeLabel(raw: string): string {
  return raw
    .replace(/_/g, " ")
    .toLowerCase()
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function AdminStudentDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();

  const [data, setData] = useState<StudentDetailResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!id) return;
    setLoading(true);
    setError(null);

    fetch(`/api/admin/students/${id}`)
      .then((res) => {
        if (!res.ok) throw new Error("Failed to load student");
        return res.json();
      })
      .then((json: StudentDetailResponse) => setData(json))
      .catch((err) =>
        setError(err instanceof Error ? err.message : "Something went wrong")
      )
      .finally(() => setLoading(false));
  }, [id]);

  // ── Loading / error ─────────────────────────────────────────────────────────

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
        <p className="text-text-secondary">{error ?? "Student not found"}</p>
        <Button variant="outline" onClick={() => router.back()}>
          Go Back
        </Button>
      </div>
    );
  }

  const { student, stats, subjectMastery, recentQuizzes, achievements, pointLedger } =
    data;
  const earnedCount = achievements.filter((a) => a.earned).length;
  const pointsInLevel = student.totalPoints % 100;

  return (
    <div className="mx-auto max-w-4xl space-y-6 p-4 sm:p-6">

      {/* ── Header ──────────────────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center gap-3">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => router.back()}
          className="gap-1.5"
        >
          <ArrowLeft className="h-4 w-4" />
          Back
        </Button>
        <h1 className="text-xl font-bold text-text-primary">{student.name}</h1>
        <Badge variant="info">Student</Badge>
      </div>

      {/* ── Profile card ────────────────────────────────────────────────────── */}
      <Card>
        <CardContent className="py-6">
          <div className="flex flex-col items-center gap-5 sm:flex-row sm:items-start">
            {/* Avatar */}
            <Avatar
              name={student.name}
              src={student.avatarUrl ?? undefined}
              size="lg"
              className="h-20 w-20 shrink-0 text-2xl"
            />

            {/* Details */}
            <div className="flex-1 text-center sm:text-left">
              <h2 className="text-xl font-bold text-text-primary">
                {student.name}
              </h2>

              <div className="mt-2 flex flex-wrap items-center justify-center gap-x-4 gap-y-1.5 text-sm text-text-secondary sm:justify-start">
                <span className="flex items-center gap-1.5">
                  <Phone className="h-4 w-4" />
                  {student.phoneNumber}
                </span>
                {student.grade && (
                  <span className="flex items-center gap-1.5">
                    <BookOpen className="h-4 w-4" />
                    Grade {student.grade}
                    {student.section ? ` — Section ${student.section}` : ""}
                  </span>
                )}
                {student.school && (
                  <span className="flex items-center gap-1.5">
                    <School className="h-4 w-4" />
                    {student.school.name}
                  </span>
                )}
                <span className="flex items-center gap-1.5">
                  <Calendar className="h-4 w-4" />
                  Joined {formatDate(student.createdAt)}
                </span>
                {student.streakDays > 0 && (
                  <span className="flex items-center gap-1.5">
                    <Flame className="h-4 w-4 text-orange-500" />
                    {student.streakDays}d streak
                  </span>
                )}
                {student.lastActiveAt && (
                  <span className="flex items-center gap-1.5">
                    <Clock className="h-4 w-4" />
                    Active {relativeTime(student.lastActiveAt)}
                  </span>
                )}
              </div>
            </div>

            {/* XP badge */}
            <div className="shrink-0 rounded-xl bg-primary/10 px-4 py-3 text-center">
              <p className="text-2xl font-black text-primary">
                {student.totalPoints.toLocaleString()}
              </p>
              <p className="text-xs font-medium text-primary/80">Total Points</p>
            </div>
          </div>

          {/* Level progress */}
          <div className="mt-5">
            <div className="mb-1.5 flex items-center justify-between text-xs text-text-secondary">
              <span className="font-medium">
                Level {student.xpLevel} → Level {student.xpLevel + 1}
              </span>
              <span>{pointsInLevel}/100 XP</span>
            </div>
            <ProgressBar value={pointsInLevel} color="primary" size="md" />
          </div>
        </CardContent>
      </Card>

      {/* ── Stats row ───────────────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 sm:gap-4">
        <StatCard
          label="Total Points"
          value={student.totalPoints.toLocaleString()}
          icon={<Star className="h-5 w-5 text-primary" />}
        />
        <StatCard
          label="XP Level"
          value={`Level ${student.xpLevel}`}
          icon={<TrendingUp className="h-5 w-5 text-primary" />}
        />
        <StatCard
          label="Quizzes Done"
          value={stats.totalQuizzes}
          icon={<BookOpen className="h-5 w-5 text-primary" />}
        />
        <StatCard
          label="Avg Score"
          value={`${stats.avgScore}%`}
          icon={<Target className="h-5 w-5 text-primary" />}
        />
      </div>

      {/* ── Subject Mastery ─────────────────────────────────────────────────── */}
      {subjectMastery.length > 0 && (
        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <TrendingUp className="h-5 w-5 text-primary" />
              <h2 className="text-lg font-semibold text-text-primary">
                Subject Mastery
              </h2>
            </div>
          </CardHeader>
          <CardContent className="space-y-4 pb-5">
            {subjectMastery.map((subject) => (
              <div key={subject.subject}>
                <div className="mb-1.5 flex items-center justify-between">
                  <div>
                    <span className="text-sm font-medium text-text-primary">
                      {subject.subject}
                    </span>
                    <span className="ml-2 text-xs text-text-secondary">
                      {subject.quizzes}{" "}
                      {subject.quizzes === 1 ? "quiz" : "quizzes"}
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-text-secondary">
                      {subject.totalPoints} pts
                    </span>
                    <span
                      className={cn(
                        "text-sm font-bold",
                        subject.avgScore >= 70
                          ? "text-success"
                          : subject.avgScore >= 40
                          ? "text-warning"
                          : "text-error"
                      )}
                    >
                      {subject.avgScore}%
                    </span>
                  </div>
                </div>
                <ProgressBar
                  value={subject.avgScore}
                  color={subject.avgScore >= 70 ? "success" : "primary"}
                  size="sm"
                />
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {/* ── Achievements grid ────────────────────────────────────────────────── */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Trophy className="h-5 w-5 text-primary" />
              <h2 className="text-lg font-semibold text-text-primary">
                Achievements
              </h2>
            </div>
            <span className="text-sm text-text-secondary">
              {earnedCount}/{achievements.length} earned
            </span>
          </div>
        </CardHeader>
        <CardContent className="pb-5">
          <div className="grid grid-cols-3 gap-3">
            {achievements.map((achievement) => (
              <div
                key={achievement.id}
                className={cn(
                  "flex flex-col items-center gap-2 rounded-xl border border-border p-3 text-center transition-all",
                  achievement.earned
                    ? "border-primary/20 bg-primary/5"
                    : "opacity-50 grayscale"
                )}
              >
                <span
                  className="text-3xl"
                  role="img"
                  aria-label={achievement.name}
                >
                  {achievement.icon}
                </span>
                <div>
                  <p className="text-xs font-semibold leading-tight text-text-primary">
                    {achievement.name}
                  </p>
                  <p className="mt-0.5 text-xs leading-tight text-text-secondary">
                    {achievement.desc}
                  </p>
                </div>
                {achievement.earned && (
                  <Badge variant="success" className="text-xs">
                    Earned
                  </Badge>
                )}
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* ── Recent Quizzes ───────────────────────────────────────────────────── */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <BookOpen className="h-5 w-5 text-primary" />
            <h2 className="text-lg font-semibold text-text-primary">
              Recent Quizzes
            </h2>
          </div>
        </CardHeader>
        <CardContent className="pb-5">
          {recentQuizzes.length === 0 ? (
            <p className="py-6 text-center text-sm text-text-secondary">
              No quizzes completed yet.
            </p>
          ) : (
            <div className="space-y-2">
              {recentQuizzes.map((quiz) => (
                <div
                  key={quiz.id}
                  className="flex items-center gap-3 rounded-lg border border-border px-4 py-3"
                >
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-text-primary">
                      {quiz.subject
                        ? quiz.chapterTitle
                          ? `${quiz.subject} — Ch. ${quiz.chapterNumber}: ${quiz.chapterTitle}`
                          : quiz.subject
                        : "Quiz"}
                    </p>
                    <p className="mt-0.5 text-xs text-text-secondary">
                      {quiz.correctAnswers}/{quiz.totalQuestions} correct
                      {" · "}
                      {formatDate(quiz.completedAt)}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <Badge variant={scoreVariant(quiz.score)}>
                      {quiz.score}%
                    </Badge>
                    <span className="text-sm font-semibold text-primary">
                      +{quiz.totalPointsEarned}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* ── Point History ────────────────────────────────────────────────────── */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <Star className="h-5 w-5 text-primary" />
            <h2 className="text-lg font-semibold text-text-primary">
              Point History
            </h2>
          </div>
        </CardHeader>
        <CardContent className="pb-5">
          {pointLedger.length === 0 ? (
            <p className="py-6 text-center text-sm text-text-secondary">
              No point history yet.
            </p>
          ) : (
            <div className="space-y-1">
              {pointLedger.map((entry) => (
                <div
                  key={entry.id}
                  className="flex items-center gap-3 rounded-lg px-3 py-2.5 transition-colors hover:bg-gray-50"
                >
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-text-primary">
                      {entry.description
                        ? entry.description
                        : actionTypeLabel(entry.actionType)}
                    </p>
                    <p className="text-xs text-text-secondary">
                      {formatDate(entry.createdAt)}
                    </p>
                  </div>
                  <span
                    className={cn(
                      "shrink-0 text-sm font-bold",
                      entry.points >= 0 ? "text-success" : "text-error"
                    )}
                  >
                    {entry.points >= 0 ? "+" : ""}
                    {entry.points}
                  </span>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

// ── Sub-component ─────────────────────────────────────────────────────────────

function StatCard({
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
            <p className="mt-1 text-2xl font-bold text-text-primary">{value}</p>
          </div>
          <div className="rounded-lg bg-primary/10 p-2">{icon}</div>
        </div>
      </CardContent>
    </Card>
  );
}
