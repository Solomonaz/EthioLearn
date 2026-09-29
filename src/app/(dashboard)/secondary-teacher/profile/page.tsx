"use client";

import { useCallback, useEffect, useState } from "react";
import {
  Building2,
  CalendarDays,
  Layers,
  Mail,
  Plus,
  Shield,
  Trash2,
} from "lucide-react";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { toast } from "@/components/ui/sonner";
import { SECONDARY_MAX_GRADE, SECONDARY_MIN_GRADE } from "@/lib/teacher-band";
import { MAX_SECTION_LENGTH, normalizeSection } from "@/lib/section";
import { SignInMethodsCard } from "@/components/auth/sign-in-methods-card";

/** Grades this band may teach — mirrors the server's own validation. */
const GRADES = Array.from(
  { length: SECONDARY_MAX_GRADE - SECONDARY_MIN_GRADE + 1 },
  (_, i) => i + SECONDARY_MIN_GRADE,
);

interface Profile {
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
  /** Null on rows written before sections existed: every section. */
  section: string | null;
}

export default function SecondaryTeacherProfilePage() {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [assignments, setAssignments] = useState<Assignment[]>([]);
  const [subjects, setSubjects] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [name, setName] = useState("");
  const [saving, setSaving] = useState(false);

  const [newSubject, setNewSubject] = useState("");
  const [newGrade, setNewGrade] = useState<number>(SECONDARY_MIN_GRADE);
  const [newSection, setNewSection] = useState("");
  const [adding, setAdding] = useState(false);
  const [removingId, setRemovingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [meRes, aRes, sRes] = await Promise.all([
        fetch("/api/secondary-teacher/me"),
        fetch("/api/teacher/me/assignments"),
        fetch("/api/subjects"),
      ]);

      const meData = await meRes.json().catch(() => ({}));
      if (!meRes.ok) throw new Error(meData.error ?? "Failed to load your profile");
      setProfile(meData.user);
      setName(meData.user?.name ?? "");

      const aData = await aRes.json().catch(() => ({}));
      setAssignments(aRes.ok ? aData.assignments ?? [] : []);

      const sData = await sRes.json().catch(() => ({}));
      const names: string[] = (sData.subjects ?? []).map((s: { name: string }) => s.name);
      setSubjects(names);
      setNewSubject((cur) => cur || names[0] || "");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function saveProfile(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      const res = await fetch("/api/secondary-teacher/me", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim() }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? "Could not save your profile");
      toast.success("Profile updated.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setSaving(false);
    }
  }

  async function addAssignment(e: React.FormEvent) {
    e.preventDefault();
    if (!newSubject.trim()) return;

    const section = normalizeSection(newSection);
    if (!section) {
      toast.error("Enter the section you teach, for example A.");
      return;
    }

    setAdding(true);
    try {
      const res = await fetch("/api/teacher/me/assignments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ subject: newSubject.trim(), grade: newGrade, section }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? "Could not add that class");
      setAssignments((prev) =>
        [...prev, data.assignment].sort(
          (a, b) =>
            a.grade - b.grade ||
            a.subject.localeCompare(b.subject) ||
            (a.section ?? "").localeCompare(b.section ?? ""),
        ),
      );
      setNewSection("");
      toast.success("Class added.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setAdding(false);
    }
  }

  async function removeAssignment(id: string) {
    setRemovingId(id);
    try {
      const res = await fetch(`/api/teacher/me/assignments/${id}`, {
        method: "DELETE",
      });
      if (!res.ok) throw new Error("Could not remove that class");
      setAssignments((prev) => prev.filter((a) => a.id !== id));
      toast.success("Class removed.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setRemovingId(null);
    }
  }

  if (loading) {
    return (
      <div className="flex justify-center py-16">
        <Spinner size="lg" className="text-primary" />
      </div>
    );
  }

  if (error || !profile) {
    return (
      <Card>
        <CardContent>
          <p className="py-8 text-center text-sm text-red-600">
            {error ?? "Profile unavailable"}
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <div>
        <h1 className="text-2xl font-bold text-text-primary">My profile</h1>
        <p className="text-sm text-text-secondary">
          Grades {SECONDARY_MIN_GRADE}-{SECONDARY_MAX_GRADE} teacher
        </p>
      </div>

      {/* ── Editable details ────────────────────────────────────────── */}
      <Card>
        <CardHeader>
          <h2 className="font-semibold text-text-primary">Your details</h2>
        </CardHeader>
        <CardContent>
          <form onSubmit={saveProfile} className="space-y-4">
            <div className="space-y-2">
              <label
                htmlFor="profile-name"
                className="text-xs font-semibold uppercase text-text-muted"
              >
                Full name
              </label>
              <Input
                id="profile-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                disabled={saving}
              />
            </div>
            <Button type="submit" disabled={saving}>
              {saving ? <Spinner size="sm" /> : "Save changes"}
            </Button>
          </form>
        </CardContent>
      </Card>

      {/* ── Classes ─────────────────────────────────────────────────── */}
      <Card>
        <CardHeader>
          <h2 className="font-semibold text-text-primary">Subjects and grades</h2>
          <p className="text-xs text-text-muted">
            One row per class — for example Maths grade 9 section A and Physics
            grade 10 section C. A grade runs several sections, so the section is
            what makes it your class. Your insights are built from exactly these.
          </p>
        </CardHeader>
        <CardContent>
          {assignments.length > 0 ? (
            <ul className="mb-4 flex flex-wrap gap-2">
              {assignments.map((a) => (
                <li
                  key={a.id}
                  className="inline-flex items-center gap-2 rounded-full bg-primary/10 px-3 py-1.5 text-xs font-semibold text-primary"
                >
                  {a.subject} · Grade {a.grade}
                  {a.section ? ` ${a.section}` : " (all sections)"}
                  <button
                    type="button"
                    onClick={() => removeAssignment(a.id)}
                    disabled={removingId === a.id}
                    aria-label={`Remove ${a.subject} grade ${a.grade}`}
                    className="text-primary/70 transition hover:text-primary disabled:opacity-40"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mb-4 text-sm text-text-secondary">
              You have no classes yet. Add the subjects and grades you teach.
            </p>
          )}

          <form onSubmit={addAssignment} className="flex flex-wrap items-end gap-2">
            <div className="min-w-0 flex-1">
              <label
                htmlFor="ta-subject"
                className="mb-1.5 block text-xs font-semibold uppercase text-text-muted"
              >
                Subject
              </label>
              <select
                id="ta-subject"
                value={newSubject}
                onChange={(e) => setNewSubject(e.target.value)}
                disabled={adding || subjects.length === 0}
                className="w-full rounded-xl border border-border bg-background px-3 py-2.5 text-sm text-text-primary outline-none focus:border-primary"
              >
                {subjects.length === 0 && <option value="">No subjects yet</option>}
                {subjects.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </div>
            <div className="w-32">
              <label
                htmlFor="ta-grade"
                className="mb-1.5 block text-xs font-semibold uppercase text-text-muted"
              >
                Grade
              </label>
              <select
                id="ta-grade"
                value={newGrade}
                onChange={(e) => setNewGrade(Number(e.target.value))}
                disabled={adding}
                className="w-full rounded-xl border border-border bg-background px-3 py-2.5 text-sm text-text-primary outline-none focus:border-primary"
              >
                {GRADES.map((g) => (
                  <option key={g} value={g}>
                    Grade {g}
                  </option>
                ))}
              </select>
            </div>
            <div className="w-24">
              <label
                htmlFor="ta-section"
                className="mb-1.5 block text-xs font-semibold uppercase text-text-muted"
              >
                Section
              </label>
              <Input
                id="ta-section"
                placeholder="A"
                value={newSection}
                onChange={(e) => setNewSection(e.target.value)}
                disabled={adding}
                maxLength={MAX_SECTION_LENGTH}
              />
            </div>
            <Button type="submit" disabled={adding || subjects.length === 0}>
              <Plus className="mr-1.5 h-4 w-4" /> Add
            </Button>
          </form>

          {subjects.length === 0 && (
            <p className="mt-2 text-xs text-amber-600">
              No subjects are set up yet. Ask your school administrator to add them —
              the subject has to match the textbook exactly for your insights to
              resolve.
            </p>
          )}
        </CardContent>
      </Card>

      {/* ── Read-only account info ──────────────────────────────────── */}
      <Card>
        <CardHeader>
          <h2 className="flex items-center gap-2 font-semibold text-text-primary">
            <Shield className="h-5 w-5 text-primary" /> Account
          </h2>
        </CardHeader>
        <CardContent>
          <dl className="divide-y divide-border">
            <InfoRow icon={<Mail className="h-4 w-4" />} label="Email" value={profile.email ?? "—"} />
            <InfoRow
              icon={<Building2 className="h-4 w-4" />}
              label="School"
              value={profile.school?.name ?? "—"}
            />
            <InfoRow
              icon={<Layers className="h-4 w-4" />}
              label="Classes"
              value={String(assignments.length)}
            />
            <InfoRow
              icon={<CalendarDays className="h-4 w-4" />}
              label="Member since"
              value={new Date(profile.createdAt).toLocaleDateString()}
            />
          </dl>
        </CardContent>
      </Card>

      <SignInMethodsCard />
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
    <div className="flex items-center justify-between gap-3 py-2.5">
      <dt className="flex items-center gap-2 text-sm text-text-secondary">
        <span className="text-text-muted">{icon}</span>
        {label}
      </dt>
      <dd className="truncate text-sm font-medium text-text-primary">{value}</dd>
    </div>
  );
}
