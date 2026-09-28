"use client";

import { useCallback, useEffect, useState } from "react";
import { Plus, X, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { toast } from "@/components/ui/sonner";
import { PRIMARY_MAX_GRADE, SECONDARY_MAX_GRADE, SECONDARY_MIN_GRADE } from "@/lib/teacher-band";
import { MAX_SECTION_LENGTH, normalizeSection } from "@/lib/section";

/**
 * Edit a teacher: their name, the phone number they sign in with, and the
 * classes they hold. Grades 1-8 teachers (`elementary`) hold entries with no
 * section, each naming a subject, a grade, or both — and may hold none.
 *
 * Band and school are deliberately absent. Moving a teacher between grades 1-8
 * and 9-12, or between schools, changes which surface they land on and which
 * students they can read — that is a re-provision, not a field edit.
 */

const SECONDARY_GRADES = Array.from(
  { length: SECONDARY_MAX_GRADE - SECONDARY_MIN_GRADE + 1 },
  (_, i) => i + SECONDARY_MIN_GRADE,
);
const ELEMENTARY_GRADES = Array.from({ length: PRIMARY_MAX_GRADE }, (_, i) => i + 1);

export interface EditableClass {
  /** Blank only on an elementary "whole grade" entry. */
  subject: string | null;
  /** Blank only on an elementary "one subject" entry. */
  grade: number | null;
  section: string | null;
}

export interface EditableTeacher {
  id: string;
  name: string;
  phoneNumber: string | null;
  teachingAssignments: EditableClass[];
}

export function EditTeacherDialog({
  teacher,
  elementary = false,
  onClose,
  onSaved,
}: {
  teacher: EditableTeacher;
  /** A grades 1-8 teacher: grades 1-8, no sections, classes optional. */
  elementary?: boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
  const grades = elementary ? ELEMENTARY_GRADES : SECONDARY_GRADES;
  const [name, setName] = useState(teacher.name);
  // Stored as +251XXXXXXXXX; the field shows the local part, like the add form.
  const [phone, setPhone] = useState(
    (teacher.phoneNumber ?? "").replace(/^\+251/, ""),
  );
  const [classes, setClasses] = useState<EditableClass[]>(
    teacher.teachingAssignments.map((c) => ({ ...c })),
  );

  const [subjects, setSubjects] = useState<string[]>([]);
  const [draftSubject, setDraftSubject] = useState("");
  // Elementary entries start on "All subjects" / "All grades" (blank).
  const [draftGrade, setDraftGrade] = useState<number | null>(elementary ? null : grades[0]);
  const [draftSection, setDraftSection] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    // The teacher's own level's list. A school admin gets their school's list
    // whatever is asked; the level only steers the super admin.
    fetch(`/api/subjects?level=${elementary ? "ELEMENTARY" : "SECONDARY"}`)
      .then((r) => (r.ok ? r.json() : { subjects: [] }))
      .then((d) => {
        const names = (d.subjects ?? []).map((s: { name: string }) => s.name);
        setSubjects(names);
        if (!elementary) setDraftSubject((cur) => cur || names[0] || "");
      })
      .catch(() => setSubjects([]));
  }, [elementary]);

  function addClass() {
    const subject = draftSubject.trim() || null;
    const section = elementary ? null : normalizeSection(draftSection);
    if (elementary ? !subject && draftGrade === null : !subject) {
      toast.error(elementary ? "Pick a subject, a grade, or both." : "Pick a subject first.");
      return;
    }
    if (!elementary && !section) {
      toast.error("Enter the section, for example A.");
      return;
    }
    const exists = classes.some(
      (c) =>
        (c.subject ?? "").toLowerCase() === (subject ?? "").toLowerCase() &&
        c.grade === draftGrade &&
        (c.section ?? "") === (section ?? ""),
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

  const save = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      if (saving) return;

      if (!elementary && classes.length === 0) {
        toast.error("A teacher needs at least one class.");
        return;
      }

      // Normalise so a pasted 0912…, 251912… or +251912… also works.
      const localDigits = phone.trim().replace(/\D/g, "").replace(/^251/, "").replace(/^0/, "");

      setSaving(true);
      try {
        const res = await fetch(`/api/admin/teachers/${teacher.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: name.trim(),
            phone: `+251${localDigits}`,
            assignments: classes.map((c) => ({
              subject: c.subject,
              grade: c.grade,
              section: c.section,
            })),
          }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error ?? "Could not save those changes");

        toast.success("Teacher updated.");
        onSaved();
        onClose();
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Something went wrong");
      } finally {
        setSaving(false);
      }
    },
    [saving, classes, phone, name, teacher.id, onSaved, onClose, elementary],
  );

  const fieldClass =
    "w-full rounded-xl border border-border bg-background px-3 py-2 text-sm text-text-primary outline-none focus:border-primary";

  const phoneChanged =
    phone.trim().replace(/\D/g, "").replace(/^251/, "").replace(/^0/, "") !==
    (teacher.phoneNumber ?? "").replace(/^\+251/, "");

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-0 sm:items-center sm:p-4">
      <div className="max-h-[92vh] w-full max-w-lg overflow-y-auto rounded-t-3xl bg-surface p-5 shadow-xl sm:rounded-3xl sm:p-6">
        <div className="mb-4 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="text-lg font-bold text-text-primary">Edit teacher</h2>
            <p className="text-xs text-text-secondary">
              Their band and school cannot be changed here.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="shrink-0 rounded-lg p-1 text-text-muted transition hover:bg-border/50 hover:text-text-primary"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <form onSubmit={save} className="space-y-4">
          <div className="space-y-1.5">
            <label
              htmlFor="edit-name"
              className="text-xs font-semibold uppercase text-text-muted"
            >
              Full name
            </label>
            <Input
              id="edit-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              disabled={saving}
              maxLength={50}
              required
            />
          </div>

          <div className="space-y-1.5">
            <label
              htmlFor="edit-phone"
              className="text-xs font-semibold uppercase text-text-muted"
            >
              Phone number
            </label>
            <div className="flex">
              <span className="inline-flex items-center rounded-l-lg border border-r-0 border-border bg-gray-50 px-3 text-sm text-text-secondary">
                +251
              </span>
              <Input
                id="edit-phone"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                disabled={saving}
                className="rounded-l-none"
                inputMode="numeric"
                required
              />
            </div>
            {phoneChanged && (
              <p className="text-xs text-amber-600">
                This is how they sign in — changing it means they must use the new
                number from now on.
              </p>
            )}
          </div>

          {/* Classes */}
          <div className="space-y-2 rounded-xl border border-border p-3">
            <span className="text-xs font-semibold uppercase text-text-muted">
              Classes
            </span>
            <p className="text-xs text-text-muted">
              Removing a class does not delete the work they already set for it.
            </p>

            {classes.length > 0 ? (
              <ul className="flex flex-wrap gap-2 pt-1">
                {classes.map((c, i) => (
                  <li
                    key={`${c.subject}-${c.grade}-${c.section ?? ""}`}
                    className="inline-flex items-center gap-1.5 rounded-full bg-primary/10 px-3 py-1 text-xs font-semibold text-primary"
                  >
                    {c.subject ?? "All subjects"} ·{" "}
                    {c.grade !== null ? `G${c.grade}` : "all grades"}
                    {c.section ? ` ${c.section}` : ""}
                    <button
                      type="button"
                      onClick={() => removeClass(i)}
                      disabled={saving}
                      aria-label={`Remove ${c.subject ?? "all subjects"}, ${c.grade !== null ? `grade ${c.grade}` : "all grades"}`}
                      className="text-primary/70 hover:text-primary disabled:opacity-40"
                    >
                      <XCircle className="h-3.5 w-3.5" />
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              !elementary && (
                <p className="text-xs text-amber-600">
                  No classes — add at least one before saving.
                </p>
              )
            )}

            <div className="flex flex-wrap gap-2 pt-1">
              <select
                aria-label="Subject"
                value={draftSubject}
                onChange={(e) => setDraftSubject(e.target.value)}
                disabled={saving || (!elementary && subjects.length === 0)}
                className={`min-w-0 flex-1 ${fieldClass}`}
              >
                {elementary && <option value="">All subjects</option>}
                {!elementary && subjects.length === 0 && <option value="">No subjects yet</option>}
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
                disabled={saving}
                className={`w-32 ${fieldClass}`}
              >
                {elementary && <option value="">All grades</option>}
                {grades.map((g) => (
                  <option key={g} value={g}>
                    Grade {g}
                  </option>
                ))}
              </select>
              {!elementary && (
                <Input
                  aria-label="Section"
                  placeholder="Section"
                  value={draftSection}
                  onChange={(e) => setDraftSection(e.target.value)}
                  disabled={saving}
                  maxLength={MAX_SECTION_LENGTH}
                  className="w-24"
                />
              )}
              <Button
                type="button"
                variant="secondary"
                onClick={addClass}
                disabled={saving || (!elementary && subjects.length === 0)}
              >
                <Plus className="h-4 w-4" />
              </Button>
            </div>
          </div>

          <div className="flex gap-2 pt-1">
            <Button type="submit" className="flex-1" disabled={saving}>
              {saving ? <Spinner size="sm" /> : "Save changes"}
            </Button>
            <Button type="button" variant="outline" onClick={onClose} disabled={saving}>
              Cancel
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
