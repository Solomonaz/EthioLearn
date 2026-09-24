"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { BookOpen, Check, PenLine, Send, Users, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { toast } from "@/components/ui/sonner";
import { cn } from "@/lib/utils";
import { displaySubject } from "@/lib/display-text";
import { OptionCard, Segmented } from "./form-pieces";

/**
 * Give a piece of written work to a class.
 *
 * Creates a DOCUMENT activity: students read it and mark it done, or hand in
 * an answer the teacher marks. Nothing is auto-marked — a worksheet is usually
 * done in an exercise book — so this is deliberately not the quiz flow. It is
 * created as a DRAFT: the teacher checks the student view before sending.
 *
 * Same visual language as "Set an activity" (lib: ./form-pieces).
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
  excludeClassId,
}: {
  title: string;
  markdown: string;
  onClose: () => void;
  onGiven?: () => void;
  /**
   * A class to leave out — the one this work was already given to, when the
   * dialog is opened as "Give to another class" from an activity.
   */
  excludeClassId?: string | null;
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
        const list: ClassOption[] = (d.classes ?? [])
          .map(
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
          )
          .filter((c: ClassOption) => c.id !== excludeClassId);
        setClasses(list);
        // Default to the first class that actually has students in it.
        setClassId(list.find((c) => c.studentCount > 0)?.id ?? "");
      })
      .catch(() => setClasses([]))
      .finally(() => setLoading(false));
  }, [excludeClassId]);

  const selected = classes.find((c) => c.id === classId) ?? null;

  const submit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      if (saving || !classId) return;

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
    "w-full rounded-xl border border-border bg-background px-3 py-2.5 text-sm text-text-primary outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/15";
  const label = "text-xs font-semibold uppercase tracking-wide text-text-muted";
  const blocker = loading
    ? null
    : classes.length > 0 && classes.every((c) => c.studentCount === 0)
      ? `None of your ${excludeClassId ? "other " : ""}classes has students yet.`
      : !classId
        ? "Choose a class with students in it."
        : null;

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 backdrop-blur-[2px] sm:items-center sm:p-6">
      <form
        onSubmit={submit}
        className="flex max-h-[94vh] w-full max-w-2xl flex-col overflow-hidden rounded-t-[28px] bg-surface shadow-2xl sm:max-h-[90vh] sm:rounded-[28px]"
      >
        {/* ── Header ─────────────────────────────────────────────────────── */}
        <div className="shrink-0 bg-gradient-to-br from-primary/15 via-primary/5 to-transparent px-5 pb-5 pt-5 sm:px-8 sm:pt-6">
          <div className="flex items-start justify-between gap-3">
            <div className="flex min-w-0 items-center gap-3">
              <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-primary text-white shadow-sm">
                <Send className="h-5 w-5" />
              </span>
              <div className="min-w-0">
                <h2 className="text-lg font-bold text-text-primary sm:text-xl">
                  {excludeClassId ? "Give to another class" : "Give to a class"}
                </h2>
                <p className="truncate text-sm text-text-secondary">{title}</p>
              </div>
            </div>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close"
              className="shrink-0 rounded-xl p-2 text-text-muted transition hover:bg-surface/80 hover:text-text-primary"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
        </div>

        {/* ── Body ───────────────────────────────────────────────────────── */}
        <div className="min-h-0 flex-1 space-y-6 overflow-y-auto px-5 py-5 sm:px-8 sm:py-6">
          {loading ? (
            <div className="flex justify-center py-10">
              <Spinner size="lg" className="text-primary" />
            </div>
          ) : classes.length === 0 ? (
            <p className="rounded-2xl border border-dashed border-border px-4 py-10 text-center text-sm text-text-secondary">
              {excludeClassId
                ? "You have no other classes to give this to."
                : "You have no classes yet. Add them on your profile first."}
            </p>
          ) : (
            <>
              {/* Which class */}
              <div className="space-y-2">
                <span className={label}>Which class?</span>
                <div className="grid gap-2 sm:grid-cols-2">
                  {classes.map((c) => {
                    const on = c.id === classId;
                    const empty = c.studentCount === 0;
                    return (
                      <button
                        key={c.id}
                        type="button"
                        disabled={empty}
                        aria-pressed={on}
                        onClick={() => setClassId(c.id)}
                        className={cn(
                          "flex items-center gap-3 rounded-2xl border-2 p-3 text-left transition",
                          on
                            ? "border-primary bg-primary/[0.06] shadow-sm"
                            : "border-border hover:border-primary/40",
                          empty && "cursor-not-allowed opacity-50 hover:border-border",
                        )}
                      >
                        <span
                          className={cn(
                            "flex h-10 w-10 shrink-0 items-center justify-center rounded-xl transition",
                            on ? "bg-primary text-white" : "bg-border/50 text-text-secondary",
                          )}
                        >
                          {on ? <Check className="h-5 w-5" /> : <Users className="h-5 w-5" />}
                        </span>
                        <span className="min-w-0">
                          <span className="block truncate text-sm font-bold text-text-primary">
                            {displaySubject(c.subject)} · Grade {c.grade}
                            {c.section ? ` ${c.section}` : ""}
                          </span>
                          <span className="block text-xs text-text-muted">
                            {empty
                              ? "No students yet"
                              : `${c.studentCount} student${c.studentCount === 1 ? "" : "s"}`}
                          </span>
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Kind */}
              <div className="space-y-2">
                <span className={label}>It's a</span>
                <Segmented
                  options={KINDS.map((k) => ({ value: k.value, label: k.label }))}
                  value={kind}
                  onChange={setKind}
                />
              </div>

              {/* How it's done */}
              <div className="space-y-2">
                <span className={label}>How do students do it?</span>
                <div className="grid gap-3 sm:grid-cols-2">
                  <OptionCard
                    selected={!requiresSubmission}
                    onSelect={() => setRequiresSubmission(false)}
                    icon={BookOpen}
                    label="In their exercise book"
                    hint="They do it on paper and mark it done here."
                  />
                  <OptionCard
                    selected={requiresSubmission}
                    onSelect={() => setRequiresSubmission(true)}
                    icon={PenLine}
                    label="Hand in an answer"
                    hint="They type or photograph their work and you mark it."
                  />
                </div>
                {requiresSubmission && (
                  <div className="flex flex-wrap items-center gap-2 rounded-2xl bg-border/20 px-4 py-3">
                    <label htmlFor="gtc-marks" className="text-sm font-semibold text-text-primary">
                      Marked out of
                    </label>
                    <Input
                      id="gtc-marks"
                      type="number"
                      min={1}
                      max={1000}
                      value={maxMarks}
                      onChange={(e) => setMaxMarks(e.target.value)}
                      className="w-24"
                    />
                    <span className="text-xs text-text-muted">Clear it to give feedback only.</span>
                  </div>
                )}
              </div>

              {/* Title + due date */}
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <label htmlFor="gtc-title" className={label}>
                    Title
                  </label>
                  <Input
                    id="gtc-title"
                    value={workTitle}
                    onChange={(e) => setWorkTitle(e.target.value)}
                    maxLength={120}
                  />
                </div>
                <div className="space-y-1.5">
                  <label htmlFor="gtc-due" className={label}>
                    Due date <span className="normal-case tracking-normal">(optional)</span>
                  </label>
                  <Input id="gtc-due" type="date" value={dueAt} onChange={(e) => setDueAt(e.target.value)} />
                  <p className="text-xs text-text-muted">A reminder, not a lock.</p>
                </div>
              </div>

              <div className="space-y-1.5">
                <label htmlFor="gtc-instructions" className={label}>
                  Instructions for students <span className="normal-case tracking-normal">(optional)</span>
                </label>
                <textarea
                  id="gtc-instructions"
                  rows={2}
                  value={instructions}
                  onChange={(e) => setInstructions(e.target.value)}
                  maxLength={2000}
                  placeholder="e.g. Answer problems 1–8 in your exercise book."
                  className={fieldClass}
                />
              </div>
            </>
          )}
        </div>

        {/* ── Footer ─────────────────────────────────────────────────────── */}
        <div className="flex shrink-0 items-center justify-between gap-3 border-t border-border px-5 py-4 sm:px-8">
          <p className={cn("min-w-0 text-sm", blocker ? "text-amber-700" : "text-text-muted")}>
            {blocker ?? "Saved as a draft — you check it before students see it."}
          </p>
          <div className="flex shrink-0 gap-2">
            <Button type="button" variant="outline" onClick={onClose} disabled={saving}>
              Cancel
            </Button>
            {/* A quick request with no progress card, so the button's own
                spinner is the one indicator. */}
            <Button type="submit" disabled={!classId} isLoading={saving} className="min-w-[10rem]">
              {!saving && <Check className="mr-1.5 h-4 w-4" />}
              Create draft{selected ? ` for ${selected.studentCount}` : ""}
            </Button>
          </div>
        </div>
      </form>
    </div>
  );
}
