"use client";

import { useEffect, useState } from "react";
import { useTranslations, useLocale } from "next-intl";
import { useSession, signOut } from "next-auth/react";
import { toast } from "sonner";
import {
  User as UserIcon,
  Mail,
  Phone,
  Building2,
  CalendarDays,
  Layers,
  Shield,
  LogOut,
  Save,
  BookOpen,
  Plus,
  X,
} from "lucide-react";
import { cn, formatDate } from "@/lib/utils";
import { Avatar } from "@/components/ui/avatar";
import { AVATAR_PRESETS } from "@/lib/avatar-presets";
import { useSound } from "@/hooks/use-sound";
import { PRIMARY_MAX_GRADE } from "@/lib/teacher-band";

interface TeacherProfile {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  avatarUrl: string | null;
  school: { name: string } | null;
  createdAt: string;
}

interface Assignment {
  id: string;
  subject: string;
  grade: number;
}

// Grades 1-8 only. This is the elementary teacher's own profile, and the API
// now refuses anything above PRIMARY_MAX_GRADE — offering grade 9 here would
// only produce a rejection after the fact. Grades 9-12 belong to
// SECONDARY_TEACHER, whose classes also carry a section.
const GRADES = Array.from({ length: PRIMARY_MAX_GRADE }, (_, i) => i + 1);

export default function TeacherProfilePage() {
  const t = useTranslations("teacher");
  const c = useTranslations("common");
  const locale = useLocale();
  const { playSfx } = useSound();
  const { update } = useSession();

  const [profile, setProfile] = useState<TeacherProfile | null>(null);
  const [stats, setStats] = useState<{ gameSets: number }>({ gameSets: 0 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  // Editable form state
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [avatarUrl, setAvatarUrl] = useState("");
  const [saving, setSaving] = useState(false);

  // Teaching assignments ("what I teach")
  const [assignments, setAssignments] = useState<Assignment[]>([]);
  const [subjectOptions, setSubjectOptions] = useState<string[]>([]);
  const [newSubject, setNewSubject] = useState("");
  const [newGrade, setNewGrade] = useState<number>(1);
  const [addingAssignment, setAddingAssignment] = useState(false);
  const [removingId, setRemovingId] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/teacher/me")
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((d) => {
        const u: TeacherProfile = d.user;
        setProfile(u);
        setStats(d.stats ?? { gameSets: 0 });
        setName(u.name ?? "");
        setEmail(u.email ?? "");
        setAvatarUrl(u.avatarUrl ?? "");
      })
      .catch(() => setError(true))
      .finally(() => setLoading(false));

    fetch("/api/teacher/me/assignments")
      .then((r) => (r.ok ? r.json() : { assignments: [] }))
      .then((d) => setAssignments(d.assignments ?? []))
      .catch(() => {});

    fetch("/api/subjects")
      .then((r) => (r.ok ? r.json() : { subjects: [] }))
      .then((d) =>
        setSubjectOptions(
          (d.subjects ?? []).map((s: { name: string }) => s.name).filter(Boolean),
        ),
      )
      .catch(() => {});
  }, []);

  const addAssignment = async (e: React.FormEvent) => {
    e.preventDefault();
    const subject = newSubject.trim();
    if (!subject) return;
    setAddingAssignment(true);
    playSfx("click");
    try {
      const res = await fetch("/api/teacher/me/assignments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ subject, grade: newGrade }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error || t("teachAddError"));
        return;
      }
      setAssignments((prev) =>
        [...prev, data.assignment].sort(
          (a, b) => a.grade - b.grade || a.subject.localeCompare(b.subject),
        ),
      );
      setNewSubject("");
    } catch {
      toast.error(t("teachAddError"));
    } finally {
      setAddingAssignment(false);
    }
  };

  const removeAssignment = async (id: string) => {
    setRemovingId(id);
    try {
      const res = await fetch(`/api/teacher/me/assignments/${id}`, { method: "DELETE" });
      if (!res.ok) {
        toast.error(t("teachRemoveError"));
        return;
      }
      setAssignments((prev) => prev.filter((a) => a.id !== id));
    } catch {
      toast.error(t("teachRemoveError"));
    } finally {
      setRemovingId(null);
    }
  };

  const dirty =
    profile !== null &&
    (name.trim() !== (profile.name ?? "") ||
      email.trim() !== (profile.email ?? "") ||
      (avatarUrl || "") !== (profile.avatarUrl ?? ""));

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (name.trim().length < 2) {
      toast.error(t("profileSaveError"));
      return;
    }
    setSaving(true);
    playSfx("click");
    try {
      const res = await fetch("/api/teacher/me", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          email: email.trim(),
          avatarUrl: avatarUrl || "",
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error || t("profileSaveError"));
        return;
      }
      setProfile((p) => (p ? { ...p, ...data.user } : p));
      // Best-effort: refresh the session so the top-bar avatar/name follow.
      try {
        await update?.();
      } catch {
        /* ignore */
      }
      toast.success(t("profileSaved"));
    } catch {
      toast.error(t("profileSaveError"));
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="flex min-h-[50vh] items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
      </div>
    );
  }

  if (error || !profile) {
    return (
      <div className="flex min-h-[50vh] flex-col items-center justify-center gap-4 text-center">
        <p className="text-text-secondary">{t("profileLoadError")}</p>
        <button
          onClick={() => window.location.reload()}
          className="rounded-full bg-primary px-5 py-2.5 text-sm font-bold text-white hover:bg-primary-dark"
        >
          {c("retry")}
        </button>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      {/* ── Header ─────────────────────────────────────────── */}
      <div>
        <h1 className="text-2xl font-extrabold text-text-primary">{t("profileTitle")}</h1>
        <p className="mt-1 text-sm text-text-secondary">{t("profileSubtitle")}</p>
      </div>

      {/* ── Editable profile ───────────────────────────────── */}
      <form
        onSubmit={save}
        className="rounded-3xl border border-border bg-surface p-5 shadow-sm sm:p-6"
      >
        <h2 className="mb-4 flex items-center gap-2 text-base font-extrabold text-text-primary">
          <UserIcon className="h-5 w-5 text-primary" /> {t("profileSection")}
        </h2>

        {/* avatar preview + picker */}
        <div className="flex flex-col items-center gap-4 sm:flex-row sm:items-start">
          <Avatar
            name={name || profile.name}
            src={avatarUrl || null}
            size="lg"
            className="h-20 w-20 shrink-0 text-2xl"
          />
          <div className="w-full">
            <p className="mb-2 text-sm font-semibold text-text-primary">{t("profileAvatar")}</p>
            <div className="grid grid-cols-6 gap-2 sm:grid-cols-12">
              {AVATAR_PRESETS.map((preset) => {
                const value = `preset:${preset.id}`;
                const selected = avatarUrl === value;
                return (
                  <button
                    key={preset.id}
                    type="button"
                    onClick={() => setAvatarUrl(selected ? "" : value)}
                    className={cn(
                      "flex h-10 w-10 items-center justify-center rounded-full text-xl transition-all",
                      preset.bg,
                      selected
                        ? "scale-110 ring-2 ring-primary ring-offset-2 ring-offset-surface"
                        : "opacity-75 hover:scale-105 hover:opacity-100",
                    )}
                    title={preset.emoji}
                    aria-pressed={selected}
                  >
                    {preset.emoji}
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        {/* name */}
        <div className="mt-5">
          <label htmlFor="name" className="mb-1.5 block text-sm font-semibold text-text-primary">
            {t("profileName")}
          </label>
          <input
            id="name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={t("profileNamePh")}
            required
            minLength={2}
            maxLength={50}
            className="w-full rounded-2xl border border-border bg-background px-4 py-3 text-text-primary outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/20"
          />
        </div>

        {/* email */}
        <div className="mt-4">
          <label htmlFor="email" className="mb-1.5 block text-sm font-semibold text-text-primary">
            {t("profileEmail")}
          </label>
          <input
            id="email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder={t("profileEmailPh")}
            className="w-full rounded-2xl border border-border bg-background px-4 py-3 text-text-primary outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/20"
          />
        </div>

        <button
          type="submit"
          disabled={saving || !dirty}
          className="mt-5 inline-flex w-full items-center justify-center gap-2 rounded-2xl bg-primary px-5 py-3 text-sm font-bold text-white shadow-sm transition hover:bg-primary-dark active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-50 sm:w-auto"
        >
          {saving ? (
            <span className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" />
          ) : (
            <Save className="h-4 w-4" />
          )}
          {c("save")}
        </button>
      </form>

      {/* ── What I teach ───────────────────────────────────── */}
      <div className="rounded-3xl border border-border bg-surface p-5 shadow-sm sm:p-6">
        <h2 className="flex items-center gap-2 text-base font-extrabold text-text-primary">
          <BookOpen className="h-5 w-5 text-primary" /> {t("teachTitle")}
        </h2>
        <p className="mt-0.5 text-sm text-text-secondary">{t("teachSubtitle")}</p>

        {/* current assignments as chips */}
        <div className="mt-4 flex flex-wrap gap-2">
          {assignments.length === 0 ? (
            <p className="text-sm text-text-muted">{t("teachEmpty")}</p>
          ) : (
            assignments.map((a) => (
              <span
                key={a.id}
                className="inline-flex items-center gap-2 rounded-full bg-primary/10 py-1.5 pl-3.5 pr-1.5 text-sm font-semibold text-primary"
              >
                <span>{a.subject}</span>
                <span className="rounded-full bg-primary/15 px-2 py-0.5 text-xs">
                  {t("gradeOption", { grade: a.grade })}
                </span>
                <button
                  type="button"
                  onClick={() => removeAssignment(a.id)}
                  disabled={removingId === a.id}
                  aria-label={`${a.subject} · ${t("gradeOption", { grade: a.grade })}`}
                  className="flex h-6 w-6 items-center justify-center rounded-full text-primary/70 transition hover:bg-primary/20 hover:text-primary disabled:opacity-50"
                >
                  {removingId === a.id ? (
                    <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-primary border-t-transparent" />
                  ) : (
                    <X className="h-3.5 w-3.5" />
                  )}
                </button>
              </span>
            ))
          )}
        </div>

        {/* add form */}
        <form onSubmit={addAssignment} className="mt-5 flex flex-col gap-2.5 sm:flex-row sm:items-end">
          <div className="min-w-0 flex-1">
            <label htmlFor="ta-subject" className="mb-1.5 block text-sm font-semibold text-text-primary">
              {t("teachSubject")}
            </label>
            <input
              id="ta-subject"
              list="ta-subject-options"
              value={newSubject}
              onChange={(e) => setNewSubject(e.target.value)}
              placeholder={t("teachSubjectPh")}
              maxLength={40}
              className="w-full rounded-2xl border border-border bg-background px-4 py-2.5 text-text-primary outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/20"
            />
            <datalist id="ta-subject-options">
              {subjectOptions.map((s) => (
                <option key={s} value={s} />
              ))}
            </datalist>
          </div>
          <div className="sm:w-40">
            <label htmlFor="ta-grade" className="mb-1.5 block text-sm font-semibold text-text-primary">
              {t("teachGrade")}
            </label>
            <select
              id="ta-grade"
              value={newGrade}
              onChange={(e) => setNewGrade(Number(e.target.value))}
              className="w-full rounded-2xl border border-border bg-background px-4 py-2.5 text-text-primary outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/20"
            >
              {GRADES.map((g) => (
                <option key={g} value={g}>
                  {t("gradeOption", { grade: g })}
                </option>
              ))}
            </select>
          </div>
          <button
            type="submit"
            disabled={addingAssignment || !newSubject.trim()}
            className="inline-flex items-center justify-center gap-1.5 rounded-2xl bg-primary px-5 py-2.5 text-sm font-bold text-white shadow-sm transition hover:bg-primary-dark active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Plus className="h-4 w-4" /> {t("teachAdd")}
          </button>
        </form>
      </div>

      {/* ── Account info (read-only) ───────────────────────── */}
      <div className="rounded-3xl border border-border bg-surface p-5 shadow-sm sm:p-6">
        <h2 className="mb-4 flex items-center gap-2 text-base font-extrabold text-text-primary">
          <Shield className="h-5 w-5 text-primary" /> {t("profileAccount")}
        </h2>
        <div className="divide-y divide-border">
          <InfoRow icon={<Phone className="h-4 w-4" />} label={t("profilePhone")} value={profile.phone || "—"} />
          <InfoRow icon={<Mail className="h-4 w-4" />} label={t("profileEmail")} value={profile.email || "—"} />
          <InfoRow
            icon={<Building2 className="h-4 w-4" />}
            label={t("profileSchool")}
            value={profile.school?.name || "—"}
          />
          <InfoRow icon={<Shield className="h-4 w-4" />} label={t("profileRole")} value={t("profileRoleTeacher")} />
          <InfoRow
            icon={<Layers className="h-4 w-4" />}
            label={t("profileGameSets")}
            value={String(stats.gameSets)}
          />
          <InfoRow
            icon={<CalendarDays className="h-4 w-4" />}
            label={t("profileMemberSince")}
            value={formatDate(profile.createdAt, {
              month: "long",
              day: "numeric",
              year: "numeric",
            })}
          />
        </div>
      </div>

      {/* ── Sign out ───────────────────────────────────────── */}
      <div className="flex justify-end">
        <button
          onClick={() => signOut({ callbackUrl: "/" })}
          className="inline-flex items-center gap-2 rounded-full border border-error/30 px-5 py-2.5 text-sm font-bold text-error transition hover:bg-error/10"
        >
          <LogOut className="h-4 w-4" /> {c("signOut")}
        </button>
      </div>
    </div>
  );
}

function InfoRow({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
}) {
  return (
    <div className="flex items-center justify-between gap-3 py-3">
      <span className="flex items-center gap-2 text-sm text-text-secondary">
        <span className="text-text-muted">{icon}</span>
        {label}
      </span>
      <span className="truncate text-sm font-semibold text-text-primary">{value}</span>
    </div>
  );
}
