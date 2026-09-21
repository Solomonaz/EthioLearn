"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  Trophy,
  BookOpen,
  Target,
  Flame,
  Pencil,
  Calendar,
  School,
  CheckCircle2,
  TrendingUp,
  Lock,
} from "lucide-react";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Avatar } from "@/components/ui/avatar";
import { ProgressBar } from "@/components/ui/progress-bar";
import { Spinner } from "@/components/ui/spinner";
import { Button } from "@/components/ui/button";
import { cn, formatDate, scoreVariant } from "@/lib/utils";

// ── Types ────────────────────────────────────────────────────────────────────

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
  completedAt: string;
  mode: string;
  chapter: {
    id: string;
    title: string;
    chapterNumber: number;
    textbook: {
      subject: string;
      grade: number;
    };
  } | null;
}

interface ProfileData {
  user: {
    id: string;
    name: string;
    phone: string;
    grade: number | null;
    section: string | null;
    totalPoints: number;
    xpLevel: number;
    avatarUrl: string | null;
    school: { name: string } | null;
  };
  stats: {
    totalQuizzes: number;
    avgScore: number;
    totalCorrect: number;
    totalQuestions: number;
    currentStreak: number;
    longestStreak: number;
    joinedDaysAgo: number;
  };
  subjectMastery: SubjectMastery[];
  recentActivity: RecentQuiz[];
  achievements: Achievement[];
}

// ── Page ─────────────────────────────────────────────────────────────────────

export default function StudentProfilePage() {
  const [profile, setProfile] = useState<ProfileData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isEditing, setIsEditing] = useState(false);
  const [editName, setEditName] = useState("");
  const [editGrade, setEditGrade] = useState<number | "">("");
  const [editSection, setEditSection] = useState("");
  const [editSaving, setEditSaving] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);

  useEffect(() => {
    async function fetchProfile() {
      try {
        const res = await fetch("/api/students/me/profile");
        if (!res.ok) throw new Error("Failed to load profile");
        const data = await res.json();
        setProfile(data);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Something went wrong");
      } finally {
        setLoading(false);
      }
    }
    fetchProfile();
  }, []);

  async function handleSaveProfile() {
    setEditSaving(true);
    setEditError(null);
    try {
      const res = await fetch("/api/students/me/profile", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: editName || undefined,
          grade: editGrade !== "" ? Number(editGrade) : undefined,
          section: editSection || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to save");
      // Update local profile data
      if (profile) {
        setProfile({ ...profile, user: { ...profile.user, name: data.user.name, grade: data.user.grade, section: data.user.section } });
      }
      setIsEditing(false);
    } catch (err) {
      setEditError(err instanceof Error ? err.message : "Failed to save");
    } finally {
      setEditSaving(false);
    }
  }

  if (loading) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <Spinner size="lg" className="text-primary" />
      </div>
    );
  }

  if (error || !profile) {
    return (
      <div className="flex min-h-[60vh] flex-col items-center justify-center gap-4">
        <p className="text-text-secondary">{error ?? "Failed to load profile"}</p>
        <Button variant="outline" onClick={() => window.location.reload()}>
          Try Again
        </Button>
      </div>
    );
  }

  const { user, stats, subjectMastery, recentActivity, achievements } = profile;

  // Enrolled at a school → the school owns their identity fields.
  const schoolManaged = Boolean(user.school);

  const pointsInCurrentLevel = user.totalPoints % 100;
  const accuracy =
    stats.totalQuestions > 0
      ? Math.round((stats.totalCorrect / stats.totalQuestions) * 100)
      : 0;

  const earnedCount = achievements.filter((a) => a.earned).length;

  return (
    <div className="mx-auto max-w-4xl space-y-6 p-4 sm:p-6">

      {/* ── 1. Profile Header ─────────────────────────────────────────────── */}
      <Card>
        <CardContent className="py-6">
          <div className="flex flex-col items-center gap-4 sm:flex-row sm:items-start">
            {/* Avatar */}
            <div className="shrink-0">
              <Avatar
                name={user.name}
                src={user.avatarUrl}
                size="lg"
                className="h-20 w-20 text-2xl"
              />
            </div>

            {/* Info */}
            <div className="flex-1 text-center sm:text-left">
              <div className="flex flex-wrap items-center justify-center gap-2 sm:justify-start">
                <h1 className="text-2xl font-bold text-text-primary">
                  {user.name}
                </h1>
                {/*
                  A student enrolled at a school does not own their own name,
                  grade or section — those are how their teachers identify
                  them, and how the platform decides whose class they are in.
                  The API refuses these edits outright; hiding the button is
                  the courtesy, not the control.
                */}
                {schoolManaged ? (
                  <span
                    className="inline-flex items-center gap-1 rounded-full bg-border/50 px-2 py-0.5 text-[11px] font-medium text-text-muted"
                    title="Your school sets your name, grade and section. Ask your school administrator to change them."
                  >
                    <Lock className="h-3 w-3" />
                    Set by your school
                  </span>
                ) : (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 gap-1 px-2 text-xs text-text-secondary"
                    aria-label="Edit name"
                    onClick={() => {
                      setEditName(profile?.user.name ?? "");
                      setEditGrade(profile?.user.grade ?? "");
                      setEditSection(profile?.user.section ?? "");
                      setEditError(null);
                      setIsEditing(true);
                    }}
                  >
                    <Pencil className="h-3.5 w-3.5" />
                    Edit
                  </Button>
                )}
              </div>

              {isEditing && !schoolManaged && (
                <div className="mt-4 space-y-3 border-t border-border pt-4">
                  <div>
                    <label className="mb-1 block text-xs font-medium text-text-secondary">Display Name</label>
                    <input
                      className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-text-primary outline-none focus:border-primary focus:ring-2 focus:ring-primary/20"
                      value={editName}
                      onChange={(e) => setEditName(e.target.value)}
                      placeholder="Your name"
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-xs font-medium text-text-secondary">Grade</label>
                    <select
                      className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-text-primary outline-none focus:border-primary"
                      value={editGrade}
                      onChange={(e) => setEditGrade(e.target.value === "" ? "" : Number(e.target.value))}
                    >
                      <option value="">Select grade</option>
                      {Array.from({ length: 12 }, (_, i) => i + 1).map((g) => (
                        <option key={g} value={g}>Grade {g}</option>
                      ))}
                    </select>
                  </div>
                  {editError && (
                    <p className="text-sm text-error">{editError}</p>
                  )}
                  <div className="flex gap-2">
                    <button
                      onClick={handleSaveProfile}
                      disabled={editSaving}
                      className="flex-1 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-white hover:bg-primary/90 disabled:opacity-50"
                    >
                      {editSaving ? "Saving..." : "Save Changes"}
                    </button>
                    <button
                      onClick={() => setIsEditing(false)}
                      className="flex-1 rounded-lg border border-border px-4 py-2 text-sm font-semibold text-text-secondary hover:bg-border/50"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              )}

              <div className="mt-2 flex flex-wrap items-center justify-center gap-x-4 gap-y-1 text-sm text-text-secondary sm:justify-start">
                {user.grade && (
                  <span className="flex items-center gap-1">
                    <BookOpen className="h-4 w-4" />
                    Grade {user.grade}
                    {user.section ? ` — Section ${user.section}` : ""}
                  </span>
                )}
                {user.school && (
                  <span className="flex items-center gap-1">
                    <School className="h-4 w-4" />
                    {user.school.name}
                  </span>
                )}
                <span className="flex items-center gap-1">
                  <Calendar className="h-4 w-4" />
                  Member for {stats.joinedDaysAgo}{" "}
                  {stats.joinedDaysAgo === 1 ? "day" : "days"}
                </span>
              </div>
            </div>

            {/* Points badge */}
            <div className="shrink-0 rounded-xl bg-primary/10 px-4 py-3 text-center">
              <p className="text-2xl font-black text-primary">
                {user.totalPoints.toLocaleString()}
              </p>
              <p className="text-xs font-medium text-primary/80">Total XP</p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* ── 2. Level & Points Card ────────────────────────────────────────── */}
      <Card>
        <CardContent className="py-5">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="flex h-12 w-12 items-center justify-center rounded-full bg-primary text-lg font-black text-white">
                {user.xpLevel}
              </div>
              <div>
                <p className="text-xs text-text-secondary">Current Level</p>
                <p className="text-lg font-bold text-text-primary">
                  Level {user.xpLevel}
                </p>
              </div>
            </div>

            <div className="flex items-center gap-3">
              {stats.currentStreak > 0 && (
                <div className="flex items-center gap-1 rounded-full bg-orange-100 px-3 py-1 text-sm font-semibold text-orange-600">
                  <Flame className="h-4 w-4" />
                  {stats.currentStreak}d streak
                </div>
              )}
              <Badge variant="info" className="text-sm">
                {user.totalPoints} XP
              </Badge>
            </div>
          </div>

          <div className="mt-4">
            <div className="mb-1.5 flex justify-between text-xs text-text-secondary">
              <span>Progress to Level {user.xpLevel + 1}</span>
              <span>{pointsInCurrentLevel}/100 XP</span>
            </div>
            <ProgressBar value={pointsInCurrentLevel} color="primary" size="md" />
          </div>
        </CardContent>
      </Card>

      {/* ── 3. Stats Grid ────────────────────────────────────────────────── */}
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
          label="Accuracy"
          value={`${accuracy}%`}
          icon={<CheckCircle2 className="h-5 w-5 text-primary" />}
        />
        <StatMiniCard
          label="Study Streak"
          value={`${stats.currentStreak}d`}
          sub={`Best: ${stats.longestStreak}d`}
          icon={<Flame className="h-5 w-5 text-orange-500" />}
        />
      </div>

      {/* ── 4. Subject Mastery ───────────────────────────────────────────── */}
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
                      {subject.quizzes} {subject.quizzes === 1 ? "quiz" : "quizzes"}
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
                  color={
                    subject.avgScore >= 70
                      ? "success"
                      : "primary"
                  }
                  size="sm"
                />
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {/* ── 5. Achievements Grid ─────────────────────────────────────────── */}
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
          <div className="grid grid-cols-3 gap-3 sm:grid-cols-3 md:grid-cols-3">
            {achievements.map((achievement) => (
              <div
                key={achievement.id}
                className={cn(
                  "flex flex-col items-center gap-2 rounded-xl border border-border p-3 text-center transition-all",
                  achievement.earned
                    ? "bg-primary/5 border-primary/20"
                    : "opacity-50 grayscale"
                )}
              >
                <span className="text-3xl" role="img" aria-label={achievement.name}>
                  {achievement.icon}
                </span>
                <div>
                  <p className="text-xs font-semibold text-text-primary leading-tight">
                    {achievement.name}
                  </p>
                  <p className="mt-0.5 text-xs text-text-secondary leading-tight">
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

      {/* ── 6. Recent Activity ───────────────────────────────────────────── */}
      <div>
        <h2 className="mb-3 text-lg font-semibold text-text-primary">
          Recent Activity
        </h2>

        {recentActivity.length === 0 ? (
          <Card>
            <CardContent className="py-10 text-center">
              <BookOpen className="mx-auto mb-3 h-10 w-10 text-text-secondary/40" />
              <p className="text-text-secondary">No quizzes yet</p>
              <p className="mt-1 text-sm text-text-secondary/70">
                Complete your first quiz to see activity here.
              </p>
              <Link href="/student/quiz" className="mt-4 inline-block">
                <Button size="sm">Start a Quiz</Button>
              </Link>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-2">
            {recentActivity.map((quiz) => (
              <Card
                key={quiz.id}
                className="transition-shadow hover:shadow-md"
              >
                <CardContent className="flex items-center gap-3 py-3">
                  {/* Subject / Chapter info */}
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      {quiz.chapter ? (
                        <p className="text-sm font-medium text-text-primary">
                          {quiz.chapter.textbook.subject} — Ch.{" "}
                          {quiz.chapter.chapterNumber}: {quiz.chapter.title}
                        </p>
                      ) : (
                        <p className="text-sm font-medium text-text-primary">
                          {quiz.mode} Quiz
                        </p>
                      )}
                      <Badge variant={scoreVariant(quiz.score)}>
                        {quiz.score}%
                      </Badge>
                    </div>
                    <p className="mt-0.5 text-xs text-text-secondary">
                      {quiz.correctAnswers}/{quiz.totalQuestions} correct
                      {" \u2022 "}
                      {quiz.completedAt ? formatDate(quiz.completedAt) : "—"}
                    </p>
                  </div>

                  {/* Points */}
                  <div className="shrink-0 text-right">
                    <p className="text-sm font-semibold text-primary">
                      +{quiz.totalPointsEarned}
                    </p>
                    <p className="text-xs text-text-secondary">pts</p>
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

// ── Sub-component ─────────────────────────────────────────────────────────────

function StatMiniCard({
  label,
  value,
  sub,
  icon,
}: {
  label: string;
  value: string | number;
  sub?: string;
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
            {sub && (
              <p className="mt-0.5 text-xs text-text-secondary">{sub}</p>
            )}
          </div>
          <div className="rounded-lg bg-primary/10 p-2">{icon}</div>
        </div>
      </CardContent>
    </Card>
  );
}
