"use client";

import { useEffect, useState } from "react";
import { useParams, usePathname, useRouter } from "next/navigation";
import {
  ArrowLeft,
  Trophy,
  BookOpen,
  Target,
  Flame,
  Calendar,
  School,
  AtSign,
  TrendingUp,
  Star,
  Clock,
  Shield,
  ShieldOff,
  ShieldAlert,
  KeyRound,
  Pencil,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Avatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { ProgressBar } from "@/components/ui/progress-bar";
import { SubscriptionPanel } from "@/components/admin/subscription-panel";
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

/** Shared styling for the edit form's inputs. */
const editFieldClass =
  "w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-text-primary outline-none focus:border-primary focus:ring-2 focus:ring-primary/20 disabled:opacity-60";

interface StudentDetailResponse {
  student: {
    id: string;
    name: string;
    /** School-issued sign-in name; null for students who signed up themselves. */
    username: string | null;
    email: string | null;
    grade: number | null;
    section: string | null;
    xpLevel: number;
    totalPoints: number;
    avatarUrl: string | null;
    streakDays: number;
    lastActiveAt: string | null;
    createdAt: string;
    school: { name: string } | null;
    isActive: boolean;
    suspendedAt: string | null;
    suspendReason: string | null;
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
  // Only the super admin reaches /admin (school admins are sent to /school-admin,
  // which renders this same page) — the permanent delete is theirs alone.
  const isSuperAdminView = usePathname().startsWith("/admin");

  const [data, setData] = useState<StudentDetailResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState(false);
  // A freshly issued temporary password, shown once for the admin to hand over.
  const [issued, setIssued] = useState<{ signInAs: string | null; tempPassword: string } | null>(null);

  /**
   * Editing the student's record.
   *
   * These are the fields the student themself can no longer change — name,
   * grade and section are how their teachers identify them. The school owns
   * them, so this is the only place they can be corrected. Sign-in details are
   * not edited here: a forgotten password is replaced with "Reset password".
   */
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [form, setForm] = useState({
    name: "",
    grade: "" as number | "",
    section: "",
  });

  function startEditing(student: StudentDetailResponse["student"]) {
    setForm({
      name: student.name,
      grade: student.grade ?? "",
      section: student.section ?? "",
    });
    setFormError(null);
    setEditing(true);
  }

  async function saveProfile(studentId: string) {
    setSaving(true);
    setFormError(null);
    try {
      const res = await fetch(`/api/admin/students/${studentId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: form.name,
          grade: form.grade === "" ? undefined : String(form.grade),
          section: form.section,
        }),
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(payload.error ?? "Could not save those changes");

      // Merge rather than refetch: the rest of this page is quiz history and
      // achievements, none of which an edit can have changed.
      setData((prev) =>
        prev ? { ...prev, student: { ...prev.student, ...payload.student } } : prev,
      );
      setEditing(false);
      toast.success("Student updated.");
    } catch (e) {
      setFormError(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setSaving(false);
    }
  }

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
              <div className="flex flex-wrap items-center justify-center gap-2 sm:justify-start">
                <h2 className="text-xl font-bold text-text-primary">
                  {student.name}
                </h2>
                {!editing && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 gap-1 px-2 text-xs text-text-secondary"
                    onClick={() => startEditing(student)}
                  >
                    <Pencil className="h-3.5 w-3.5" /> Edit
                  </Button>
                )}
              </div>

              <div className="mt-2 flex flex-wrap items-center justify-center gap-x-4 gap-y-1.5 text-sm text-text-secondary sm:justify-start">
                {(student.username || student.email) && (
                  <span className="flex items-center gap-1.5">
                    <AtSign className="h-4 w-4" />
                    {student.username ?? student.email}
                  </span>
                )}
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

              {/* ── Edit form ──────────────────────────────────────────
                  Shown below the read-only summary rather than replacing
                  it, so an admin can see what they are changing from. */}
              {editing && (
                <div className="mt-4 space-y-3 border-t border-border pt-4 text-left">
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div>
                      <label
                        htmlFor="edit-name"
                        className="mb-1 block text-xs font-semibold uppercase text-text-muted"
                      >
                        Full name
                      </label>
                      <input
                        id="edit-name"
                        value={form.name}
                        onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                        disabled={saving}
                        maxLength={50}
                        className={editFieldClass}
                      />
                    </div>

                    <div>
                      <label
                        htmlFor="edit-grade"
                        className="mb-1 block text-xs font-semibold uppercase text-text-muted"
                      >
                        Grade
                      </label>
                      <select
                        id="edit-grade"
                        value={form.grade}
                        onChange={(e) =>
                          setForm((f) => ({
                            ...f,
                            grade: e.target.value === "" ? "" : Number(e.target.value),
                          }))
                        }
                        disabled={saving}
                        className={editFieldClass}
                      >
                        <option value="">Select grade</option>
                        {Array.from({ length: 12 }, (_, i) => i + 1).map((g) => (
                          <option key={g} value={g}>
                            Grade {g}
                          </option>
                        ))}
                      </select>
                    </div>

                    <div>
                      <label
                        htmlFor="edit-section"
                        className="mb-1 block text-xs font-semibold uppercase text-text-muted"
                      >
                        Section
                      </label>
                      <input
                        id="edit-section"
                        value={form.section}
                        onChange={(e) =>
                          setForm((f) => ({ ...f, section: e.target.value }))
                        }
                        disabled={saving}
                        maxLength={8}
                        placeholder="e.g. A"
                        className={editFieldClass}
                      />
                      <p className="mt-1 text-[11px] text-text-muted">
                        Decides whose class they appear in. Saved in capitals.
                      </p>
                    </div>
                  </div>

                  {formError && (
                    <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
                      {formError}
                    </p>
                  )}

                  <div className="flex flex-wrap gap-2">
                    <Button
                      onClick={() => saveProfile(student.id)}
                      disabled={saving}
                    >
                      {saving ? <Spinner size="sm" /> : "Save changes"}
                    </Button>
                    <Button
                      variant="outline"
                      onClick={() => {
                        setEditing(false);
                        setFormError(null);
                      }}
                      disabled={saving}
                    >
                      Cancel
                    </Button>
                  </div>
                </div>
              )}
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

      {/* ── Admin Actions ───────────────────────────────────────────────────── */}
      <Card className="border-orange-200/50">
        <CardHeader>
          <div className="flex items-center gap-2">
            <Shield className="h-5 w-5 text-orange-600" />
            <h2 className="text-lg font-semibold text-text-primary">
              Admin Actions
            </h2>
          </div>
        </CardHeader>
        <CardContent className="space-y-5 pb-6">
          {/* Current Status */}
          <div className="flex items-center gap-3">
            <span className="text-sm font-medium text-text-secondary">
              Account Status:
            </span>
            {student.suspendedAt ? (
              <Badge variant="error" className="gap-1">
                <ShieldAlert className="h-3 w-3" />
                Suspended
              </Badge>
            ) : student.isActive ? (
              <Badge variant="success" className="gap-1">
                <Shield className="h-3 w-3" />
                Active
              </Badge>
            ) : (
              <Badge variant="default" className="gap-1">
                <ShieldOff className="h-3 w-3" />
                Inactive
              </Badge>
            )}
            {student.suspendedAt && student.suspendReason && (
              <span className="text-xs text-text-secondary">
                Reason: {student.suspendReason}
              </span>
            )}
          </div>

          {/* Action Buttons */}
          <div className="flex flex-wrap gap-2">
            {/* Activate — shown when inactive or suspended */}
            {(!student.isActive || student.suspendedAt) && (
              <Button
                variant="outline"
                size="sm"
                disabled={actionLoading}
                className="gap-1.5 border-green-300 text-green-700 hover:bg-green-50"
                onClick={async () => {
                  setActionLoading(true);
                  try {
                    const res = await fetch(`/api/admin/students/${id}`, {
                      method: "PATCH",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({ isActive: true, suspend: false }),
                    });
                    if (!res.ok) throw new Error("Failed");
                    toast.success("Student account activated");
                    setData((prev) =>
                      prev
                        ? {
                            ...prev,
                            student: {
                              ...prev.student,
                              isActive: true,
                              suspendedAt: null,
                              suspendReason: null,
                            },
                          }
                        : prev
                    );
                  } catch {
                    toast.error("Failed to activate account");
                  } finally {
                    setActionLoading(false);
                  }
                }}
              >
                <Shield className="h-3.5 w-3.5" />
                Activate
              </Button>
            )}

            {/* Deactivate — shown when active and not suspended */}
            {student.isActive && !student.suspendedAt && (
              <Button
                variant="outline"
                size="sm"
                disabled={actionLoading}
                className="gap-1.5"
                onClick={async () => {
                  if (!confirm("Deactivate this student? They will not be able to log in.")) return;
                  setActionLoading(true);
                  try {
                    const res = await fetch(`/api/admin/students/${id}`, {
                      method: "PATCH",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({ isActive: false }),
                    });
                    if (!res.ok) throw new Error("Failed");
                    toast.success("Student account deactivated");
                    setData((prev) =>
                      prev
                        ? { ...prev, student: { ...prev.student, isActive: false } }
                        : prev
                    );
                  } catch {
                    toast.error("Failed to deactivate account");
                  } finally {
                    setActionLoading(false);
                  }
                }}
              >
                <ShieldOff className="h-3.5 w-3.5" />
                Deactivate
              </Button>
            )}

            {/* Suspend — shown when active and not suspended */}
            {student.isActive && !student.suspendedAt && (
              <Button
                variant="outline"
                size="sm"
                disabled={actionLoading}
                className="gap-1.5 border-red-300 text-red-700 hover:bg-red-50"
                onClick={async () => {
                  const reason = prompt("Enter suspension reason (optional):");
                  if (reason === null) return; // user cancelled
                  setActionLoading(true);
                  try {
                    const res = await fetch(`/api/admin/students/${id}`, {
                      method: "PATCH",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({ suspend: true, suspendReason: reason || undefined }),
                    });
                    if (!res.ok) throw new Error("Failed");
                    toast.success("Student account suspended");
                    setData((prev) =>
                      prev
                        ? {
                            ...prev,
                            student: {
                              ...prev.student,
                              suspendedAt: new Date().toISOString(),
                              suspendReason: reason || null,
                            },
                          }
                        : prev
                    );
                  } catch {
                    toast.error("Failed to suspend account");
                  } finally {
                    setActionLoading(false);
                  }
                }}
              >
                <ShieldAlert className="h-3.5 w-3.5" />
                Suspend
              </Button>
            )}

            {/* Unsuspend — shown when suspended */}
            {student.suspendedAt && (
              <Button
                variant="outline"
                size="sm"
                disabled={actionLoading}
                className="gap-1.5 border-green-300 text-green-700 hover:bg-green-50"
                onClick={async () => {
                  setActionLoading(true);
                  try {
                    const res = await fetch(`/api/admin/students/${id}`, {
                      method: "PATCH",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({ suspend: false }),
                    });
                    if (!res.ok) throw new Error("Failed");
                    toast.success("Student account unsuspended");
                    setData((prev) =>
                      prev
                        ? {
                            ...prev,
                            student: {
                              ...prev.student,
                              suspendedAt: null,
                              suspendReason: null,
                            },
                          }
                        : prev
                    );
                  } catch {
                    toast.error("Failed to unsuspend account");
                  } finally {
                    setActionLoading(false);
                  }
                }}
              >
                <Shield className="h-3.5 w-3.5" />
                Unsuspend
              </Button>
            )}
          </div>

          {/* Divider */}
          <div className="border-t border-border" />

          {/* Reset password */}
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-sm font-medium text-text-primary">Reset password</p>
              <p className="text-xs text-text-secondary">
                Gives the student a new temporary password and signs them out
                everywhere. They choose their own at next sign-in.
              </p>
            </div>
            <Button
              variant="outline"
              size="sm"
              disabled={actionLoading}
              className="shrink-0 gap-1.5"
              onClick={async () => {
                if (!window.confirm("Give this student a new temporary password?")) return;
                setActionLoading(true);
                try {
                  const res = await fetch(`/api/admin/students/${id}/reset-password`, {
                    method: "POST",
                  });
                  const payload = await res.json().catch(() => ({}));
                  if (!res.ok) throw new Error(payload.error ?? "Failed");
                  setIssued({ signInAs: payload.signInAs, tempPassword: payload.tempPassword });
                } catch (e) {
                  toast.error(e instanceof Error ? e.message : "Failed to reset the password");
                } finally {
                  setActionLoading(false);
                }
              }}
            >
              <KeyRound className="h-3.5 w-3.5" />
              Reset password
            </Button>
          </div>
          {issued && (
            <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
              <p className="font-semibold">Give these to the student — they are shown only once.</p>
              <p className="mt-1">
                Sign in as: <span className="font-mono font-semibold">{issued.signInAs}</span>
              </p>
              <p>
                Temporary password:{" "}
                <span className="font-mono font-semibold">{issued.tempPassword}</span>
              </p>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Subscription */}
      <SubscriptionPanel audience="STUDENT" targetId={id} />

      {/* Permanent delete — super admin only (this page is shared with school admins) */}
      {isSuperAdminView && (
        <DeleteStudentCard
          studentId={id}
          studentName={student.name}
          onDeleted={() => router.push("/admin/students")}
        />
      )}
    </div>
  );
}

/**
 * Permanently delete the student. Asks for the admin's own sign-in password;
 * the server checks it again and refuses without it.
 */
function DeleteStudentCard({
  studentId,
  studentName,
  onDeleted,
}: {
  studentId: string;
  studentName: string;
  onDeleted: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [password, setPassword] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function confirmDelete() {
    setDeleting(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/students/${studentId}`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(payload.error ?? "Could not delete the student.");
      toast.success(`${studentName} was deleted.`);
      onDeleted();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not delete the student.");
      setPassword("");
    } finally {
      setDeleting(false);
    }
  }

  return (
    <Card className="border-red-300">
      <CardContent className="space-y-3 py-5">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="flex items-center gap-2 text-sm font-semibold text-red-700">
              <Trash2 className="h-4 w-4" />
              Delete student
            </p>
            <p className="mt-0.5 text-xs text-text-secondary">
              Permanently removes this account and all of its quizzes, points, notifications,
              subscriptions and payments. This cannot be undone.
            </p>
          </div>
          {!open && (
            <Button
              variant="outline"
              size="sm"
              className="shrink-0 gap-1.5 border-red-300 text-red-700 hover:bg-red-50"
              onClick={() => setOpen(true)}
            >
              <Trash2 className="h-3.5 w-3.5" />
              Delete
            </Button>
          )}
        </div>

        {open && (
          <form
            className="space-y-2 rounded-lg border border-red-200 bg-red-50/60 p-3"
            onSubmit={(e) => {
              e.preventDefault();
              if (password && !deleting) confirmDelete();
            }}
          >
            <label htmlFor="delete-confirm-password" className="block text-sm text-text-primary">
              To delete <span className="font-semibold">{studentName}</span>, enter your admin password:
            </label>
            <input
              id="delete-confirm-password"
              type="password"
              autoComplete="current-password"
              autoFocus
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              disabled={deleting}
              className="h-9 w-full rounded-lg border border-border bg-surface px-3 text-sm text-text-primary"
            />
            {error && <p className="text-xs font-medium text-red-700">{error}</p>}
            <div className="flex gap-2">
              <Button
                type="submit"
                size="sm"
                disabled={!password || deleting}
                className="gap-1.5 bg-red-600 text-white hover:bg-red-700"
              >
                {deleting ? <Spinner size="sm" /> : <Trash2 className="h-3.5 w-3.5" />}
                Delete permanently
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={deleting}
                onClick={() => {
                  setOpen(false);
                  setPassword("");
                  setError(null);
                }}
              >
                Cancel
              </Button>
            </div>
          </form>
        )}
      </CardContent>
    </Card>
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
