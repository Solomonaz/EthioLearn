"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useSession } from "next-auth/react";
import {
  Gamepad2,
  GraduationCap,
  Pencil,
  Plus,
  Search,
  ShieldCheck,
  ShieldOff,
  Users,
  XCircle,
} from "lucide-react";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { toast } from "@/components/ui/sonner";
import { cn } from "@/lib/utils";
import { PRIMARY_MAX_GRADE, SECONDARY_MAX_GRADE, SECONDARY_MIN_GRADE } from "@/lib/teacher-band";
import { MAX_SECTION_LENGTH, normalizeSection } from "@/lib/section";
import { EditTeacherDialog } from "@/components/secondary-teacher/edit-teacher-dialog";

/**
 * Teacher management — shared by the super admin (/admin/teachers) and, via a
 * re-export, the school admin (/school-admin/teachers). The API scopes by the
 * caller's own school.
 *
 * Provisioning is SECONDARY ONLY (grades 9-12); grades 1-8 teachers keep their
 * own self-registration flow. The super admin can additionally list and
 * (de)activate grades 1-8 teachers through the level tabs. A school admin
 * stays secondary-only: elementary and secondary are separate institutions,
 * so a secondary school's admin never sees a grades 1-8 teacher.
 *
 * A class here is a (subject, grade, section) triple, not a grade: a grade can
 * run twenty sections and no one teacher takes them all.
 */

interface Assignment {
  id?: string;
  subject: string;
  grade: number;
  section: string | null;
}

interface Teacher {
  id: string;
  role: "TEACHER" | "SECONDARY_TEACHER";
  gamesHosted: number;
  name: string;
  phoneNumber: string | null;
  email: string | null;
  isActive: boolean;
  lastActiveAt: string | null;
  createdAt: string;
  school: { id: string; name: string } | null;
  teachingAssignments: Assignment[];
}

type Band = "all" | "elementary" | "secondary";

const BAND_TABS: { value: Band; label: string; title: string }[] = [
  { value: "all", label: "All", title: "All teachers" },
  {
    value: "elementary",
    label: `Elementary (1–${PRIMARY_MAX_GRADE})`,
    title: "Elementary teachers",
  },
  {
    value: "secondary",
    label: `Secondary (${SECONDARY_MIN_GRADE}–${SECONDARY_MAX_GRADE})`,
    title: "Secondary teachers",
  },
];

interface SchoolOption {
  id: string;
  name: string;
}

const GRADES = Array.from(
  { length: SECONDARY_MAX_GRADE - SECONDARY_MIN_GRADE + 1 },
  (_, i) => i + SECONDARY_MIN_GRADE,
);

function classLabel(a: Assignment): string {
  return `${a.subject} · G${a.grade}${a.section ? ` ${a.section}` : " (all sections)"}`;
}

export default function AdminTeachersPage() {
  const { data: session } = useSession();
  const isSuperAdmin =
    (session?.user as { role?: string } | undefined)?.role === "SUPER_ADMIN";

  const [teachers, setTeachers] = useState<Teacher[]>([]);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState<string | null>(null);

  const [search, setSearch] = useState("");
  // Only a super admin can switch level; the API pins everyone else to secondary.
  const [band, setBand] = useState<Band>("all");
  const [counts, setCounts] = useState<Record<Band, number> | null>(null);
  const [subjects, setSubjects] = useState<string[]>([]);
  const [schools, setSchools] = useState<SchoolOption[]>([]);

  // ── New teacher form ────────────────────────────────────────────────────
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [schoolId, setSchoolId] = useState("");
  const [draftSubject, setDraftSubject] = useState("");
  const [draftGrade, setDraftGrade] = useState<number>(SECONDARY_MIN_GRADE);
  const [draftSection, setDraftSection] = useState("");
  const [classes, setClasses] = useState<Assignment[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [editing, setEditing] = useState<Teacher | null>(null);

  const fetchTeachers = useCallback(async () => {
    setLoading(true);
    setFetchError(null);
    try {
      const params = new URLSearchParams();
      if (search.trim()) params.set("search", search.trim());
      if (isSuperAdmin) params.set("band", band);
      params.set("limit", "100");

      const res = await fetch(`/api/admin/teachers?${params.toString()}`);
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error ?? "Failed to load teachers");
      }
      const data = await res.json();
      setTeachers(data.teachers ?? []);
      setCounts(data.counts ?? null);
    } catch (e) {
      setFetchError(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setLoading(false);
    }
  }, [search, band, isSuperAdmin]);

  useEffect(() => {
    const id = setTimeout(fetchTeachers, 250);
    return () => clearTimeout(id);
  }, [fetchTeachers]);

  // Subjects come from the managed list, not free text — a teacher's subject
  // has to match the textbook's subject string exactly for their cohort views
  // to resolve, and typed-in spellings silently break that.
  useEffect(() => {
    fetch("/api/subjects")
      .then((r) => (r.ok ? r.json() : { subjects: [] }))
      .then((d) => {
        const names = (d.subjects ?? []).map((s: { name: string }) => s.name);
        setSubjects(names);
        setDraftSubject((cur) => cur || names[0] || "");
      })
      .catch(() => setSubjects([]));
  }, []);

  useEffect(() => {
    if (!isSuperAdmin) return;
    fetch("/api/admin/schools")
      .then((r) => (r.ok ? r.json() : { schools: [] }))
      .then((d) =>
        setSchools(
          (d.schools ?? []).map((s: { id: string; name: string }) => ({
            id: s.id,
            name: s.name,
          })),
        ),
      )
      .catch(() => setSchools([]));
  }, [isSuperAdmin]);

  const canAddClass = useMemo(
    () => subjects.length > 0 && normalizeSection(draftSection) !== null,
    [subjects.length, draftSection],
  );

  function addClass() {
    const subject = draftSubject.trim();
    const section = normalizeSection(draftSection);
    if (!subject) {
      toast.error("Pick a subject first.");
      return;
    }
    if (!section) {
      toast.error("Enter the section, for example A.");
      return;
    }
    const exists = classes.some(
      (c) =>
        c.subject.toLowerCase() === subject.toLowerCase() &&
        c.grade === draftGrade &&
        c.section === section,
    );
    if (exists) {
      toast.error("That class is already on the list.");
      return;
    }
    setClasses((prev) => [...prev, { subject, grade: draftGrade, section }]);
    setDraftSection("");
  }

  function removeClass(index: number) {
    setClasses((prev) => prev.filter((_, i) => i !== index));
  }

  function resetForm() {
    setName("");
    setPhone("");
    setClasses([]);
    setSchoolId("");
    setDraftSection("");
  }

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (submitting) return;

    if (classes.length === 0) {
      toast.error("Add at least one class — subject, grade and section.");
      return;
    }

    // Normalise so a pasted 0912…, 251912… or +251912… also works, matching
    // how the students form sends it.
    const localDigits = phone.trim().replace(/\D/g, "").replace(/^251/, "").replace(/^0/, "");

    setSubmitting(true);
    try {
      const res = await fetch("/api/admin/teachers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          phone: `+251${localDigits}`,
          assignments: classes,
          ...(isSuperAdmin && schoolId ? { schoolId } : {}),
        }),
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? "Failed to add teacher");

      toast.success(`${data.teacher.name} can now sign in with their phone number.`);
      resetForm();
      await fetchTeachers();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setSubmitting(false);
    }
  }

  async function toggleActive(teacher: Teacher) {
    const nextActive = !teacher.isActive;
    if (
      !nextActive &&
      !window.confirm(
        `Deactivate ${teacher.name}? They will be signed out and cannot sign back in until reactivated.`,
      )
    ) {
      return;
    }

    setBusyId(teacher.id);
    try {
      const res = await fetch(`/api/admin/teachers/${teacher.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isActive: nextActive }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? "Update failed");

      setTeachers((prev) =>
        prev.map((t) => (t.id === teacher.id ? { ...t, ...data.teacher } : t)),
      );
      toast.success(nextActive ? "Teacher reactivated." : "Teacher deactivated.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="mx-auto max-w-6xl space-y-6 p-4 sm:p-6">
      <div>
        <h1 className="text-2xl font-bold text-text-primary">Teachers</h1>
        <p className="text-sm text-text-secondary">
          {isSuperAdmin ? (
            <>
              Elementary (grades 1–{PRIMARY_MAX_GRADE}) and secondary (grades{" "}
              {SECONDARY_MIN_GRADE}–{SECONDARY_MAX_GRADE}) teachers. Secondary teachers
              sign in with the phone number you register here; elementary teachers
              sign up themselves.
            </>
          ) : (
            <>
              Secondary teachers, grades {SECONDARY_MIN_GRADE}–{SECONDARY_MAX_GRADE}. They
              sign in with the phone number you register here — no self sign-up.
            </>
          )}
        </p>
      </div>

      {editing && (
        <EditTeacherDialog
          teacher={editing}
          onClose={() => setEditing(null)}
          onSaved={fetchTeachers}
        />
      )}

      <div className="grid gap-6 lg:grid-cols-5">
        {/* ── Add teacher ──────────────────────────────────────────────── */}
        <div className="lg:col-span-2">
          <Card>
            <CardHeader>
              <div className="flex items-center gap-2">
                <Plus className="h-5 w-5 text-primary" />
                <h2 className="font-semibold text-text-primary">
                  {isSuperAdmin ? "Add a secondary teacher" : "Add a teacher"}
                </h2>
              </div>
            </CardHeader>
            <CardContent>
              <form onSubmit={handleCreate} className="space-y-4">
                <div className="space-y-2">
                  <label
                    htmlFor="teacher-name"
                    className="text-xs font-semibold uppercase text-text-muted"
                  >
                    Full name
                  </label>
                  <Input
                    id="teacher-name"
                    placeholder="e.g. Almaz Tesfaye"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    disabled={submitting}
                    required
                  />
                </div>

                <div className="space-y-2">
                  <label
                    htmlFor="teacher-phone"
                    className="text-xs font-semibold uppercase text-text-muted"
                  >
                    Phone number
                  </label>
                  <div className="flex">
                    <span className="inline-flex items-center rounded-l-lg border border-r-0 border-border bg-gray-50 px-3 text-sm text-text-secondary">
                      +251
                    </span>
                    <Input
                      id="teacher-phone"
                      placeholder="9XXXXXXXX"
                      value={phone}
                      onChange={(e) => setPhone(e.target.value)}
                      disabled={submitting}
                      className="rounded-l-none"
                      inputMode="numeric"
                      required
                    />
                  </div>
                  <p className="text-xs text-text-muted">
                    This is how they sign in. Ethiopian numbers only.
                  </p>
                </div>

                {isSuperAdmin && (
                  <div className="space-y-2">
                    <label
                      htmlFor="teacher-school"
                      className="text-xs font-semibold uppercase text-text-muted"
                    >
                      School
                    </label>
                    <select
                      id="teacher-school"
                      value={schoolId}
                      onChange={(e) => setSchoolId(e.target.value)}
                      disabled={submitting}
                      className="w-full rounded-xl border border-border bg-background px-3 py-2.5 text-sm text-text-primary outline-none focus:border-primary"
                    >
                      <option value="">Unassigned</option>
                      {schools.map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.name}
                        </option>
                      ))}
                    </select>
                    <p className="text-xs text-text-muted">
                      An unassigned teacher cannot open their dashboard.
                    </p>
                  </div>
                )}

                {/* Classes: subject + grade + section */}
                <div className="space-y-2 rounded-xl border border-border p-3">
                  <span className="text-xs font-semibold uppercase text-text-muted">
                    Classes
                  </span>
                  <p className="text-xs text-text-muted">
                    One row per class. A grade runs several sections, so pick the
                    section this teacher actually takes — Physics grade 11 A is a
                    different class from Physics grade 11 B.
                  </p>

                  <div className="flex flex-wrap gap-2">
                    <select
                      aria-label="Subject"
                      value={draftSubject}
                      onChange={(e) => setDraftSubject(e.target.value)}
                      disabled={submitting || subjects.length === 0}
                      className="min-w-0 flex-1 rounded-xl border border-border bg-background px-3 py-2 text-sm text-text-primary outline-none focus:border-primary"
                    >
                      {subjects.length === 0 && <option value="">No subjects yet</option>}
                      {subjects.map((s) => (
                        <option key={s} value={s}>
                          {s}
                        </option>
                      ))}
                    </select>
                    <select
                      aria-label="Grade"
                      value={draftGrade}
                      onChange={(e) => setDraftGrade(Number(e.target.value))}
                      disabled={submitting}
                      className="w-28 rounded-xl border border-border bg-background px-3 py-2 text-sm text-text-primary outline-none focus:border-primary"
                    >
                      {GRADES.map((g) => (
                        <option key={g} value={g}>
                          Grade {g}
                        </option>
                      ))}
                    </select>
                    <Input
                      aria-label="Section"
                      placeholder="Section"
                      value={draftSection}
                      onChange={(e) => setDraftSection(e.target.value)}
                      disabled={submitting}
                      maxLength={MAX_SECTION_LENGTH}
                      className="w-24"
                    />
                    <Button
                      type="button"
                      variant="secondary"
                      onClick={addClass}
                      disabled={submitting || !canAddClass}
                    >
                      <Plus className="h-4 w-4" />
                    </Button>
                  </div>

                  {subjects.length === 0 && (
                    <p className="text-xs text-amber-600">
                      Add subjects first — a teacher&apos;s subject must match the
                      textbook subject exactly.
                    </p>
                  )}

                  {classes.length > 0 && (
                    <ul className="flex flex-wrap gap-2 pt-1">
                      {classes.map((c, i) => (
                        <li
                          key={`${c.subject}-${c.grade}-${c.section}`}
                          className="inline-flex items-center gap-1.5 rounded-full bg-primary/10 px-3 py-1 text-xs font-semibold text-primary"
                        >
                          {c.subject} · G{c.grade} {c.section}
                          <button
                            type="button"
                            onClick={() => removeClass(i)}
                            aria-label={`Remove ${c.subject} grade ${c.grade} section ${c.section}`}
                            className="text-primary/70 hover:text-primary"
                          >
                            <XCircle className="h-3.5 w-3.5" />
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>

                <Button type="submit" className="w-full" disabled={submitting}>
                  {submitting ? <Spinner size="sm" /> : "Add teacher"}
                </Button>
              </form>
            </CardContent>
          </Card>
        </div>

        {/* ── Teacher list ─────────────────────────────────────────────── */}
        <div className="lg:col-span-3">
          <Card>
            <CardHeader>
              <div className="flex items-center gap-2">
                <Users className="h-5 w-5 text-primary" />
                <h2 className="font-semibold text-text-primary">
                  {isSuperAdmin
                    ? BAND_TABS.find((b) => b.value === band)?.title
                    : "All teachers"}{" "}
                  <span className="text-text-muted">({teachers.length})</span>
                </h2>
              </div>
              {isSuperAdmin && (
                <div role="tablist" aria-label="Teacher level" className="mt-3 flex flex-wrap gap-2">
                  {BAND_TABS.map((tab) => (
                    <button
                      key={tab.value}
                      type="button"
                      role="tab"
                      aria-selected={band === tab.value}
                      onClick={() => setBand(tab.value)}
                      className={cn(
                        "rounded-full border px-3 py-1 text-xs font-semibold transition-colors",
                        band === tab.value
                          ? "border-primary bg-primary text-white"
                          : "border-border text-text-secondary hover:border-primary/50",
                      )}
                    >
                      {tab.label}
                      {counts && <span className="ml-1.5 opacity-75">{counts[tab.value]}</span>}
                    </button>
                  ))}
                </div>
              )}
              <div className="relative mt-3">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-muted" />
                <Input
                  placeholder="Search by name or phone"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="pl-9"
                />
              </div>
            </CardHeader>

            <CardContent>
              {loading ? (
                <div className="flex justify-center py-10">
                  <Spinner size="lg" className="text-primary" />
                </div>
              ) : fetchError ? (
                <p className="py-8 text-center text-sm text-red-600">{fetchError}</p>
              ) : teachers.length === 0 ? (
                <div className="py-10 text-center">
                  <GraduationCap className="mx-auto mb-2 h-8 w-8 text-text-muted" />
                  <p className="text-sm text-text-secondary">No teachers yet.</p>
                </div>
              ) : (
                <ul className="divide-y divide-border">
                  {teachers.map((teacher) => (
                    <li
                      key={teacher.id}
                      className="flex flex-wrap items-start justify-between gap-3 py-3"
                    >
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-semibold text-text-primary">
                            {teacher.name}
                          </span>
                          {isSuperAdmin && (
                            <span
                              className={cn(
                                "rounded-full px-2 py-0.5 text-[11px] font-semibold",
                                teacher.role === "TEACHER"
                                  ? "bg-amber-100 text-amber-700"
                                  : "bg-primary/10 text-primary",
                              )}
                            >
                              {teacher.role === "TEACHER" ? "Elementary" : "Secondary"}
                            </span>
                          )}
                          {!teacher.isActive && (
                            <span className="rounded-full bg-red-100 px-2 py-0.5 text-[11px] font-semibold text-red-700">
                              Deactivated
                            </span>
                          )}
                        </div>
                        <p className="mt-0.5 text-xs text-text-muted">
                          {teacher.phoneNumber ?? "No phone"}
                          {teacher.school ? ` · ${teacher.school.name}` : " · Unassigned"}
                          {" · "}
                          {teacher.lastActiveAt
                            ? `Last active ${new Date(teacher.lastActiveAt).toLocaleDateString()}`
                            : "Never signed in"}
                        </p>
                        {teacher.role === "TEACHER" && (
                          <p className="mt-1 inline-flex items-center gap-1 text-[11px] text-text-secondary">
                            <Gamepad2 className="h-3.5 w-3.5" />
                            {teacher.gamesHosted} classroom game
                            {teacher.gamesHosted === 1 ? "" : "s"} hosted
                          </p>
                        )}
                        {teacher.teachingAssignments.length > 0 ? (
                          <ul className="mt-1.5 flex flex-wrap gap-1.5">
                            {teacher.teachingAssignments.map((a) => (
                              <li
                                key={a.id ?? `${a.subject}-${a.grade}-${a.section}`}
                                className={cn(
                                  "rounded-full px-2 py-0.5 text-[11px] font-medium",
                                  a.section
                                    ? "bg-primary/10 text-primary"
                                    : "bg-amber-100 text-amber-700",
                                )}
                              >
                                {classLabel(a)}
                              </li>
                            ))}
                          </ul>
                        ) : (
                          <p className="mt-1.5 text-[11px] text-amber-600">
                            No classes assigned yet
                          </p>
                        )}
                      </div>

                      <div className="flex shrink-0 items-center gap-2">
                        {/* Grades 1-8 classes live in their own surface; only
                            (de)activation is offered for them here. */}
                        {teacher.role === "SECONDARY_TEACHER" && (
                          <Button
                            type="button"
                            variant="outline"
                            onClick={() => setEditing(teacher)}
                            disabled={busyId === teacher.id}
                          >
                            <Pencil className="mr-1.5 h-4 w-4" /> Edit
                          </Button>
                        )}
                        <Button
                          type="button"
                          variant="secondary"
                          onClick={() => toggleActive(teacher)}
                          disabled={busyId === teacher.id}
                        >
                          {busyId === teacher.id ? (
                            <Spinner size="sm" />
                          ) : teacher.isActive ? (
                            <>
                              <ShieldOff className="mr-1.5 h-4 w-4" /> Deactivate
                            </>
                          ) : (
                            <>
                              <ShieldCheck className="mr-1.5 h-4 w-4" /> Reactivate
                            </>
                          )}
                        </Button>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
