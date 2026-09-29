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
 * The school's LEVEL decides which teachers it creates: an elementary school
 * adds grades 1-8 teachers, a secondary school grades 9-12 teachers. A school
 * admin only ever sees their own band; the super admin switches between them
 * with the level tabs. Nobody self-registers as a teacher.
 *
 * A secondary class is a (subject, grade, section) triple, not a grade: a grade
 * can run twenty sections and no one teacher takes them all. An elementary
 * class is subject + grade only — those schools have no student roster for a
 * section to select from.
 */

interface Assignment {
  id?: string;
  /** Always set for secondary; blank on an elementary "whole grade" entry. */
  subject: string | null;
  /** Always set for secondary; blank on an elementary "one subject" entry. */
  grade: number | null;
  section: string | null;
}

interface Teacher {
  id: string;
  role: "TEACHER" | "SECONDARY_TEACHER";
  gameSets: number;
  name: string;
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

type SchoolLevel = "ELEMENTARY" | "SECONDARY";

interface SchoolOption {
  id: string;
  name: string;
  level: SchoolLevel;
}

const SECONDARY_GRADES = Array.from(
  { length: SECONDARY_MAX_GRADE - SECONDARY_MIN_GRADE + 1 },
  (_, i) => i + SECONDARY_MIN_GRADE,
);
const ELEMENTARY_GRADES = Array.from({ length: PRIMARY_MAX_GRADE }, (_, i) => i + 1);

function classLabel(a: Assignment): string {
  const subject = a.subject ?? "All subjects";
  const grade = a.grade !== null ? `G${a.grade}` : "all grades";
  return `${subject} · ${grade}${a.section ? ` ${a.section}` : ""}`;
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
  // A school admin's own school level, reported by the list endpoint.
  const [ownLevel, setOwnLevel] = useState<SchoolLevel | null>(null);

  // ── New teacher form ────────────────────────────────────────────────────
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [schoolId, setSchoolId] = useState("");
  const [draftSubject, setDraftSubject] = useState("");
  // Null = "All grades" (elementary only).
  const [draftGrade, setDraftGrade] = useState<number | null>(SECONDARY_MIN_GRADE);
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
      if (data.schoolLevel) setOwnLevel(data.schoolLevel);
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

  useEffect(() => {
    if (!isSuperAdmin) return;
    fetch("/api/admin/schools")
      .then((r) => (r.ok ? r.json() : { schools: [] }))
      .then((d) =>
        setSchools(
          (d.schools ?? []).map((s: SchoolOption) => ({
            id: s.id,
            name: s.name,
            level: s.level,
          })),
        ),
      )
      .catch(() => setSchools([]));
  }, [isSuperAdmin]);

  // The band of the teacher the form will create: the school admin's own
  // level, or the level of the school the super admin picked. An unassigned
  // teacher is secondary, matching the server.
  const formElementary = isSuperAdmin
    ? schools.find((s) => s.id === schoolId)?.level === "ELEMENTARY"
    : ownLevel === "ELEMENTARY";
  const gradeOptions = formElementary ? ELEMENTARY_GRADES : SECONDARY_GRADES;

  // Subjects come from the managed list for the form's level, not free text —
  // a teacher's subject has to match the textbook's subject string exactly for
  // their cohort views to resolve, and typed-in spellings silently break that.
  // A school admin always gets their own level's list (the API decides).
  useEffect(() => {
    const url = isSuperAdmin
      ? `/api/subjects?level=${formElementary ? "ELEMENTARY" : "SECONDARY"}`
      : "/api/subjects";
    fetch(url)
      .then((r) => (r.ok ? r.json() : { subjects: [] }))
      .then((d) => {
        const names = (d.subjects ?? []).map((s: { name: string }) => s.name);
        setSubjects(names);
        // Elementary entries start on "All subjects"; secondary needs one.
        setDraftSubject(formElementary ? "" : names[0] || "");
      })
      .catch(() => setSubjects([]));
  }, [isSuperAdmin, formElementary]);

  // Switching band clears classes that belong to the other one.
  useEffect(() => {
    setDraftGrade(formElementary ? null : SECONDARY_MIN_GRADE);
    setClasses([]);
    setDraftSection("");
  }, [formElementary]);

  // Elementary: a subject, a grade, or both. Secondary: all three.
  const canAddClass = useMemo(
    () =>
      formElementary
        ? draftSubject.trim() !== "" || draftGrade !== null
        : subjects.length > 0 && normalizeSection(draftSection) !== null,
    [subjects.length, draftSection, formElementary, draftSubject, draftGrade],
  );

  function addClass() {
    const subject = draftSubject.trim() || null;
    const section = formElementary ? null : normalizeSection(draftSection);
    if (formElementary ? !subject && draftGrade === null : !subject) {
      toast.error(formElementary ? "Pick a subject, a grade, or both." : "Pick a subject first.");
      return;
    }
    if (!formElementary && !section) {
      toast.error("Enter the section, for example A.");
      return;
    }
    const exists = classes.some(
      (c) =>
        (c.subject ?? "").toLowerCase() === (subject ?? "").toLowerCase() &&
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
    setEmail("");
    setClasses([]);
    setSchoolId("");
    setDraftSection("");
  }

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (submitting) return;

    // Elementary classes are optional: the games do not depend on them.
    if (!formElementary && classes.length === 0) {
      toast.error("Add at least one class — subject, grade and section.");
      return;
    }

    setSubmitting(true);
    try {
      const res = await fetch("/api/admin/teachers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          email: email.trim(),
          assignments: classes,
          ...(isSuperAdmin && schoolId ? { schoolId } : {}),
        }),
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? "Failed to add teacher");

      toast.success(`${data.teacher.name} was added. They can sign in with ${data.teacher.email}.`);
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
              {SECONDARY_MIN_GRADE}–{SECONDARY_MAX_GRADE}) teachers. The school you pick
              decides which kind you add. They sign in with Google using this email, or set a password with “Forgot password” on the sign-in page.
            </>
          ) : (
            <>
              {ownLevel === "ELEMENTARY"
                ? `Teachers, grades 1–${PRIMARY_MAX_GRADE}.`
                : `Secondary teachers, grades ${SECONDARY_MIN_GRADE}–${SECONDARY_MAX_GRADE}.`}{" "}
              They sign in with Google using this email, or set a password with “Forgot password” on the sign-in page.
            </>
          )}
        </p>
      </div>

      {editing && (
        <EditTeacherDialog
          teacher={editing}
          elementary={editing.role === "TEACHER"}
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
                  {isSuperAdmin
                    ? formElementary
                      ? "Add an elementary teacher"
                      : "Add a secondary teacher"
                    : "Add a teacher"}
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
                    htmlFor="teacher-email"
                    className="text-xs font-semibold uppercase text-text-muted"
                  >
                    Email
                  </label>
                  <Input
                    id="teacher-email"
                    type="email"
                    placeholder="name@example.com"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    disabled={submitting}
                    autoComplete="off"
                    required
                  />
                  <p className="text-xs text-text-muted">
                    How they sign in — no invite is sent.
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
                          {s.name} · {s.level === "ELEMENTARY" ? "Elementary" : "Secondary"}
                        </option>
                      ))}
                    </select>
                    <p className="text-xs text-text-muted">
                      An elementary school adds a grades 1–{PRIMARY_MAX_GRADE} teacher. An
                      unassigned teacher cannot open their dashboard.
                    </p>
                  </div>
                )}

                {/* Classes: subject + grade + section */}
                <div className="space-y-2 rounded-xl border border-border p-3">
                  <span className="text-xs font-semibold uppercase text-text-muted">
                    {formElementary ? "What they teach (optional)" : "Classes"}
                  </span>
                  <p className="text-xs text-text-muted">
                    {formElementary
                      ? "Pick a subject, a grade, or both — e.g. all of grade 3, or Mathematics across grades. The teacher can also add these later from their profile."
                      : "One row per class. A grade runs several sections, so pick the section this teacher actually takes — Physics grade 11 A is a different class from Physics grade 11 B."}
                  </p>

                  <div className="flex flex-wrap gap-2">
                    <select
                      aria-label="Subject"
                      value={draftSubject}
                      onChange={(e) => setDraftSubject(e.target.value)}
                      disabled={submitting || (!formElementary && subjects.length === 0)}
                      className="min-w-0 flex-1 rounded-xl border border-border bg-background px-3 py-2 text-sm text-text-primary outline-none focus:border-primary"
                    >
                      {formElementary && <option value="">All subjects</option>}
                      {!formElementary && subjects.length === 0 && (
                        <option value="">No subjects yet</option>
                      )}
                      {subjects.map((s) => (
                        <option key={s} value={s}>
                          {s}
                        </option>
                      ))}
                    </select>
                    <select
                      aria-label="Grade"
                      value={draftGrade ?? ""}
                      onChange={(e) =>
                        setDraftGrade(e.target.value === "" ? null : Number(e.target.value))
                      }
                      disabled={submitting}
                      className="w-32 rounded-xl border border-border bg-background px-3 py-2 text-sm text-text-primary outline-none focus:border-primary"
                    >
                      {formElementary && <option value="">All grades</option>}
                      {gradeOptions.map((g) => (
                        <option key={g} value={g}>
                          Grade {g}
                        </option>
                      ))}
                    </select>
                    {!formElementary && (
                      <Input
                        aria-label="Section"
                        placeholder="Section"
                        value={draftSection}
                        onChange={(e) => setDraftSection(e.target.value)}
                        disabled={submitting}
                        maxLength={MAX_SECTION_LENGTH}
                        className="w-24"
                      />
                    )}
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
                      {formElementary
                        ? "No elementary subjects yet — add them under Subjects to pick one here."
                        : "Add subjects first — a teacher's subject must match the textbook subject exactly."}
                    </p>
                  )}

                  {classes.length > 0 && (
                    <ul className="flex flex-wrap gap-2 pt-1">
                      {classes.map((c, i) => (
                        <li
                          key={`${c.subject}-${c.grade}-${c.section ?? ""}`}
                          className="inline-flex items-center gap-1.5 rounded-full bg-primary/10 px-3 py-1 text-xs font-semibold text-primary"
                        >
                          {classLabel(c)}
                          <button
                            type="button"
                            onClick={() => removeClass(i)}
                            aria-label={`Remove ${classLabel(c)}`}
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
                  placeholder="Search by name or email"
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
                          {teacher.email ?? "No email"}
                          {teacher.school ? ` · ${teacher.school.name}` : " · Unassigned"}
                          {" · "}
                          {teacher.lastActiveAt
                            ? `Last active ${new Date(teacher.lastActiveAt).toLocaleDateString()}`
                            : "Never signed in"}
                        </p>
                        {teacher.role === "TEACHER" && (
                          <p className="mt-1 inline-flex items-center gap-1 text-[11px] text-text-secondary">
                            <Gamepad2 className="h-3.5 w-3.5" />
                            {teacher.gameSets} game set
                            {teacher.gameSets === 1 ? "" : "s"} built
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
                          teacher.role === "SECONDARY_TEACHER" && (
                            <p className="mt-1.5 text-[11px] text-amber-600">
                              No classes assigned yet
                            </p>
                          )
                        )}
                      </div>

                      <div className="flex shrink-0 items-center gap-2">
                        <Button
                          type="button"
                          variant="outline"
                          onClick={() => setEditing(teacher)}
                          disabled={busyId === teacher.id}
                        >
                          <Pencil className="mr-1.5 h-4 w-4" /> Edit
                        </Button>
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
