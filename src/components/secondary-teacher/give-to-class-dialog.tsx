"use client";

import { useCallback, useEffect, useState } from "react";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { toast } from "@/components/ui/sonner";
import { cn } from "@/lib/utils";
import { useRouter } from "next/navigation";
import { displaySubject } from "@/lib/display-text";

/**
 * Give a piece of written work to a class.
 *
 * Creates a DOCUMENT activity: students read it and mark it done. There is
 * nothing to auto-mark — a worksheet is usually done in an exercise book — so
 * this is deliberately not the quiz flow.
 */

const KINDS = [
  { value: "ASSIGNMENT", label: "Assignment" },
  { value: "HOMEWORK", label: "Homework" },
  { value: "CLASSWORK", label: "Classwork" },
  { value: "PRACTICE", label: "Practice" },
] as const;

interface ClassOption {
  id: string;
  subject: string;
  grade: number;
  section: string | null;
  studentCount: number;
}

export function GiveToClassDialog({
  title,
  markdown,
  onClose,
  onGiven,
}: {
  title: string;
  markdown: string;
  onClose: () => void;
  onGiven?: () => void;
}) {
  const [classes, setClasses] = useState<ClassOption[]>([]);
  const [classId, setClassId] = useState("");
  const [kind, setKind] = useState<string>("ASSIGNMENT");
  const [workTitle, setWorkTitle] = useState(title);
  const [instructions, setInstructions] = useState("");
  const [dueAt, setDueAt] = useState("");
  const [requiresSubmission, setRequiresSubmission] = useState(false);
  const [maxMarks, setMaxMarks] = useState("10");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const router = useRouter();

  useEffect(() => {
    // lite: names and head counts only — no answer analytics for a picker.
    fetch("/api/secondary-teacher/classes?lite=1")
      .then((r) => (r.ok ? r.json() : { classes: [] }))
      .then((d) => {
        const list: ClassOption[] = (d.classes ?? []).map(
          (c: {
            id: string;
            subject: string;
            grade: number;
            section: string | null;
            studentCount: number;
          }) => ({
            id: c.id,
            subject: c.subject,
            grade: c.grade,
            section: c.section,
            studentCount: c.studentCount,
          }),
        );
        setClasses(list);
        // Default to the first class that actually has students in it.
        setClassId(list.find((c) => c.studentCount > 0)?.id ?? list[0]?.id ?? "");
      })
      .catch(() => setClasses([]))
      .finally(() => setLoading(false));
  }, []);

  const selected = classes.find((c) => c.id === classId) ?? null;

  const submit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      if (saving) return;
      if (!classId) {
        toast.error("Choose a class.");
        return;
      }

      setSaving(true);
      try {
        const res = await fetch("/api/secondary-teacher/activities", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            teachingAssignmentId: classId,
            format: "DOCUMENT",
            kind,
            title: workTitle.trim() || title,
            instructions: instructions.trim() || undefined,
            documentBody: markdown,
            dueAt: dueAt || null,
            requiresSubmission,
            maxMarks: requiresSubmission && maxMarks.trim() ? Number(maxMarks) : null,
          }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error ?? "Could not give that to the class");

        const n = data.activity?._count?.targets ?? 0;
        // It is a DRAFT — nothing has reached a student yet, so "Given to 30
        // students" was untrue. The teacher checks it, then sends it.
        toast.success(`Draft ready for ${n} student${n === 1 ? "" : "s"}. Check it, then send.`);
        // The server says when it kept an answer key back, or thinks the
        // student view may still give answers away.
        if (data.notice) toast.warning(data.notice, { duration: 10000 });
        onGiven?.();
        onClose();
        if (data.activity?.id) router.push(`/secondary-teacher/activities/${data.activity.id}`);
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Something went wrong");
      } finally {
        setSaving(false);
      }
    },
    [
      saving,
      classId,
      kind,
      workTitle,
      title,
      instructions,
      markdown,
      dueAt,
      requiresSubmission,
      maxMarks,
      onGiven,
      router,
      onClose,
    ],
  );

  const fieldClass =
    "w-full rounded-xl border border-border bg-background px-3 py-2.5 text-sm text-text-primary outline-none focus:border-primary";

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-0 sm:items-center sm:p-4">
      <div className="max-h-[92vh] w-full max-w-lg overflow-y-auto rounded-t-3xl bg-surface p-5 shadow-xl sm:rounded-3xl sm:p-6">
        <div className="mb-4 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="text-lg font-bold text-text-primary">Give to a class</h2>
            <p className="text-xs text-text-secondary">
              Students read this and mark it done. Nothing is auto-marked.
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

        {loading ? (
          <div className="flex justify-center py-8">
            <Spinner size="lg" className="text-primary" />
          </div>
        ) : classes.length === 0 ? (
          <p className="py-6 text-center text-sm text-text-secondary">
            You have no classes yet. Add them on your profile first.
          </p>
        ) : (
          <form onSubmit={submit} className="space-y-4">
            <div className="space-y-1.5">
              <label
                htmlFor="gtc-class"
                className="text-xs font-semibold uppercase text-text-muted"
              >
                Class
              </label>
              <select
                id="gtc-class"
                value={classId}
                onChange={(e) => setClassId(e.target.value)}
                disabled={saving}
                className={fieldClass}
              >
                {classes.map((c) => (
                  <option key={c.id} value={c.id}>
                    {displaySubject(c.subject)} · Grade {c.grade}
                    {c.section ? ` ${c.section}` : ""} ({c.studentCount})
                  </option>
                ))}
              </select>
              {selected?.studentCount === 0 && (
                <p className="text-xs text-amber-600">
                  No students are registered in that class yet.
                </p>
              )}
            </div>

            <div className="space-y-1.5">
              <span className="text-xs font-semibold uppercase text-text-muted">Type</span>
              <div className="flex flex-wrap gap-1.5">
                {KINDS.map((k) => (
                  <button
                    key={k.value}
                    type="button"
                    onClick={() => setKind(k.value)}
                    disabled={saving}
                    className={cn(
                      "rounded-full border px-3 py-1.5 text-xs font-semibold transition",
                      kind === k.value
                        ? "border-primary bg-primary/10 text-primary"
                        : "border-border bg-background text-text-secondary hover:border-primary/40",
                    )}
                  >
                    {k.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="space-y-1.5">
              <label
                htmlFor="gtc-title"
                className="text-xs font-semibold uppercase text-text-muted"
              >
                Title
              </label>
              <Input
                id="gtc-title"
                value={workTitle}
                onChange={(e) => setWorkTitle(e.target.value)}
                disabled={saving}
                maxLength={120}
              />
            </div>

            <div className="space-y-1.5">
              <label
                htmlFor="gtc-instructions"
                className="text-xs font-semibold uppercase text-text-muted"
              >
                Instructions (optional)
              </label>
              <textarea
                id="gtc-instructions"
                rows={2}
                value={instructions}
                onChange={(e) => setInstructions(e.target.value)}
                disabled={saving}
                maxLength={2000}
                placeholder="e.g. Answer questions 1-8 in your exercise book."
                className={fieldClass}
              />
            </div>

            {/* Hand-in */}
            <div className="space-y-2 rounded-xl border border-border p-3">
              <label className="flex cursor-pointer items-start gap-2.5">
                <input
                  type="checkbox"
                  checked={requiresSubmission}
                  onChange={(e) => setRequiresSubmission(e.target.checked)}
                  disabled={saving}
                  className="mt-0.5 h-4 w-4"
                />
                <span className="min-w-0">
                  <span className="block text-sm font-semibold text-text-primary">
                    Students hand in an answer
                  </span>
                  <span className="block text-xs text-text-muted">
                    They type it here and you mark it. Leave this off for work done
                    in an exercise book — they just mark it as done.
                  </span>
                </span>
              </label>

              {requiresSubmission && (
                <div className="flex items-center gap-2 pt-1">
                  <label
                    htmlFor="gtc-marks"
                    className="text-xs font-semibold uppercase text-text-muted"
                  >
                    Out of
                  </label>
                  <Input
                    id="gtc-marks"
                    type="number"
                    min={1}
                    max={1000}
                    value={maxMarks}
                    onChange={(e) => setMaxMarks(e.target.value)}
                    disabled={saving}
                    className="w-24"
                  />
                  <span className="text-xs text-text-muted">
                    marks — clear it to give feedback only.
                  </span>
                </div>
              )}
            </div>

            <div className="space-y-1.5">
              <label
                htmlFor="gtc-due"
                className="text-xs font-semibold uppercase text-text-muted"
              >
                Due date (optional)
              </label>
              <Input
                id="gtc-due"
                type="date"
                value={dueAt}
                onChange={(e) => setDueAt(e.target.value)}
                disabled={saving}
              />
              <p className="text-xs text-text-muted">
                A reminder, not a lock — late work is still accepted.
              </p>
            </div>

            <div className="flex gap-2 pt-1">
              <Button type="submit" className="flex-1" disabled={saving || !classId}>
                {saving ? <Spinner size="sm" /> : "Give to class"}
              </Button>
              <Button type="button" variant="outline" onClick={onClose} disabled={saving}>
                Cancel
              </Button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
