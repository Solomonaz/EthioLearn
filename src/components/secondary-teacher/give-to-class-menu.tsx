"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ChevronDown, Send, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { toast } from "@/components/ui/sonner";
import { cn } from "@/lib/utils";
import { displaySubject } from "@/lib/display-text";

/**
 * "Give to class": pick a class and it is sent — no form in between.
 *
 * The teacher has just read the document (in the assistant or Materials), so
 * a second review step was friction. Sending the wrong thing is what Undo is
 * for: the toast offers it straight away, and the activity page keeps a
 * "Take back" for as long as no student has started (lib/activity-send).
 *
 * Due dates and the like are set afterwards on the activity page, where they
 * belong, rather than asked for every time.
 *
 * `ClassSendList` is the list itself; `GiveToClassMenu` is the button that
 * drops it down.
 */

interface ClassOption {
  id: string;
  subject: string;
  grade: number;
  section: string | null;
  studentCount: number;
}

/** Same rule as lib/subject's subjectEquals, which can't be imported here (it pulls in the database). */
function sameSubject(a: string | null | undefined, b: string | null | undefined) {
  const key = (s: string | null | undefined) => (s ?? "").trim().replace(/\s+/g, " ").toLowerCase();
  return key(a).length > 0 && key(a) === key(b);
}

function classLabel(c: ClassOption) {
  return `${displaySubject(c.subject)} · Grade ${c.grade}${c.section ? ` ${c.section}` : ""}`;
}

interface SendProps {
  title: string;
  markdown: string;
  task?: string;
  /**
   * The document's subject: only classes of that subject are offered, and the
   * server refuses any other. Null (a general document) offers every class.
   */
  subject?: string | null;
}

/** The teacher's classes of this subject; clicking one sends the document there. */
function ClassSendList({
  title,
  markdown,
  task,
  subject,
  onSent,
  className,
}: SendProps & { onSent?: () => void; className?: string }) {
  const [classes, setClasses] = useState<ClassOption[] | null>(null);
  const [sendingTo, setSendingTo] = useState<string | null>(null);
  const router = useRouter();

  // Only classes of the document's subject: Biology work never reaches a
  // Chemistry class by a mis-click.
  useEffect(() => {
    let cancelled = false;
    fetch("/api/secondary-teacher/classes?lite=1")
      .then((r) => (r.ok ? r.json() : { classes: [] }))
      .then((d) => {
        if (cancelled) return;
        const list: ClassOption[] = (d.classes ?? []).map((c: ClassOption) => ({
          id: c.id,
          subject: c.subject,
          grade: c.grade,
          section: c.section,
          studentCount: c.studentCount,
        }));
        setClasses(subject ? list.filter((c) => sameSubject(c.subject, subject)) : list);
      })
      .catch(() => !cancelled && setClasses([]));
    return () => {
      cancelled = true;
    };
  }, [subject]);

  async function takeBack(activityId: string) {
    try {
      const res = await fetch(`/api/secondary-teacher/activities/${activityId}`, { method: "DELETE" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? "Could not take that back");
      toast.success("Taken back — your students no longer see it.");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Something went wrong");
    }
  }

  async function send(c: ClassOption) {
    if (sendingTo) return;
    setSendingTo(c.id);
    try {
      const res = await fetch("/api/secondary-teacher/activities", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          teachingAssignmentId: c.id,
          format: "DOCUMENT",
          kind: "ASSIGNMENT",
          title,
          documentBody: markdown,
          // Workout problems are worked and handed in; anything else is done
          // in the exercise book and marked done.
          requiresSubmission: task === "WORKOUT",
          send: true,
          documentSubject: subject ?? null,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? "Could not send that to the class");
      onSent?.();

      const activityId: string | undefined = data.activity?.id;
      if (!data.sent) {
        // Held back as a draft: the student view still looks like it has answers.
        toast.warning(data.notice ?? "Saved as a draft — check it, then send.", {
          duration: 12000,
          action: activityId
            ? { label: "Review", onClick: () => router.push(`/secondary-teacher/activities/${activityId}`) }
            : undefined,
        });
        return;
      }

      const n: number = data.notified ?? 0;
      toast.success(`Sent to ${classLabel(c)} — ${n} student${n === 1 ? "" : "s"}.`, {
        description: "Sent by mistake? Undo now, or take it back later from Activities.",
        duration: 12000,
        action: activityId ? { label: "Undo", onClick: () => void takeBack(activityId) } : undefined,
      });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setSendingTo(null);
    }
  }

  if (classes === null) {
    return (
      <div className="flex justify-center py-5">
        <Spinner className="text-primary" />
      </div>
    );
  }
  if (classes.length === 0) {
    return (
      <p className="px-3 py-4 text-sm text-text-secondary">
        {subject
          ? `You have no ${displaySubject(subject)} class to send this to.`
          : "You have no classes yet. Add them on your profile first."}
      </p>
    );
  }
  return (
    <ul className={cn("py-1", className)}>
      {classes.map((c) => {
        const empty = c.studentCount === 0;
        return (
          <li key={c.id}>
            <button
              type="button"
              disabled={empty || Boolean(sendingTo)}
              onClick={() => void send(c)}
              className={cn(
                "flex w-full items-center gap-3 px-3 py-2 text-left transition hover:bg-border/40",
                empty && "cursor-not-allowed opacity-50 hover:bg-transparent",
              )}
            >
              {sendingTo === c.id ? (
                <Spinner size="sm" className="shrink-0 text-primary" />
              ) : (
                <Users className="h-4 w-4 shrink-0 text-text-muted" />
              )}
              <span className="min-w-0">
                <span className="block truncate text-sm font-semibold text-text-primary">{classLabel(c)}</span>
                <span className="block text-[11px] text-text-muted">
                  {empty ? "No students yet" : `${c.studentCount} student${c.studentCount === 1 ? "" : "s"}`}
                </span>
              </span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}

export function GiveToClassMenu(props: SendProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div ref={ref} className="relative">
      <Button type="button" size="sm" onClick={() => setOpen((o) => !o)}>
        <Send className="mr-1.5 h-4 w-4" /> Give to class
        <ChevronDown className="ml-1 h-3.5 w-3.5" />
      </Button>
      {/* Mounted only while open: classes load when first needed, since
          most documents are never given to a class. */}
      {open && (
        <div className="absolute right-0 z-20 mt-1 w-72 overflow-hidden rounded-xl border border-border bg-surface shadow-lg">
          <p className="border-b border-border px-3 py-2 text-[11px] text-text-muted">
            Sent straight away, without the answer key. You can undo.
          </p>
          <ClassSendList {...props} onSent={() => setOpen(false)} className="max-h-72 overflow-y-auto" />
        </div>
      )}
    </div>
  );
}
