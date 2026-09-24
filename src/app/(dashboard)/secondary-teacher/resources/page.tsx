"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { ArrowRight, BookMarked, Sparkles, Star, Trash2 } from "lucide-react";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { toast } from "@/components/ui/sonner";
import { TeacherDocument } from "@/components/secondary-teacher/teacher-document";
import { ResourceActions } from "@/components/secondary-teacher/resource-actions";
import { ASSISTANT_TASKS } from "@/lib/assistant-tasks";
import { displayChapterTitle, displaySubject } from "@/lib/display-text";

/**
 * The teacher's library of AI material: everything they generated, stored
 * automatically, with what they pressed Save on kept at the top.
 *
 * Only ever their own. Reuse across teachers (lib/teacher-library) happens
 * behind the scenes — a document served from the bank arrives here as theirs,
 * like anything else, and nothing on this page mentions other teachers.
 *
 * Opening an item loads its body on demand — the list carries only titles, so
 * a large library stays light on a slow connection.
 */

interface ResourceRow {
  id: string;
  task: string;
  title: string;
  subject: string | null;
  grade: number | null;
  chapterTitle: string | null;
  kept: boolean;
  createdAt: string;
  source?: string;
}

interface OpenResource extends ResourceRow {
  body: string;
}

const TASK_LABEL: Record<string, string> = {
  ...Object.fromEntries(ASSISTANT_TASKS.map((t) => [t.value, t.label])),
  WORKOUT: "Workout problems",
};

export default function TeacherResourcesPage() {
  const [items, setItems] = useState<ResourceRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [open, setOpen] = useState<OpenResource | null>(null);
  const [openingId, setOpeningId] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const res = await fetch("/api/secondary-teacher/resources");
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? "Failed to load your materials");
      setItems(data.resources ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong");
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function openResource(row: ResourceRow) {
    setOpeningId(row.id);
    try {
      const res = await fetch(`/api/secondary-teacher/resources/${row.id}`);
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? "Could not open that");
      setOpen(data.resource);
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setOpeningId(null);
    }
  }

  async function keep(row: ResourceRow) {
    setBusyId(row.id);
    try {
      const res = await fetch(`/api/secondary-teacher/resources/${row.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kept: true }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? "Could not keep that");
      setItems((prev) => prev?.map((r) => (r.id === row.id ? { ...r, kept: true } : r)) ?? prev);
      if (open?.id === row.id) setOpen({ ...open, kept: true });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setBusyId(null);
    }
  }

  async function remove(row: ResourceRow) {
    if (!window.confirm(`Delete "${row.title}"? This cannot be undone.`)) return;
    setBusyId(row.id);
    try {
      const res = await fetch(`/api/secondary-teacher/resources/${row.id}`, { method: "DELETE" });
      if (!res.ok) throw new Error("Could not delete that");
      setItems((prev) => prev?.filter((r) => r.id !== row.id) ?? prev);
      if (open?.id === row.id) setOpen(null);
      toast.success("Deleted.");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setBusyId(null);
    }
  }

  const saved = (items ?? []).filter((r) => r.kept);
  const recent = (items ?? []).filter((r) => !r.kept);

  return (
    <div className="mx-auto max-w-5xl space-y-5">
      <div className="print-hide">
        <h1 className="flex items-center gap-2 text-2xl font-bold text-text-primary">
          <BookMarked className="h-6 w-6 text-primary" /> Materials
        </h1>
        <p className="text-sm text-text-secondary">
          Everything you generate with the AI assistant is kept here.
        </p>
      </div>

      {/* ── Open item ─────────────────────────────────────────────────── */}
      {open && (
        <Card className="print-area">
          <CardHeader>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <h2 className="font-semibold text-text-primary">{open.title}</h2>
                <p className="print-hide text-xs text-text-muted">
                  {TASK_LABEL[open.task] ?? open.task}
                  {open.subject ? ` · ${displaySubject(open.subject)}` : ""}
                  {open.grade ? ` · Grade ${open.grade}` : ""}
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <ResourceActions
                  title={open.title}
                  markdown={open.body}
                  task={open.task}
                  resourceId={open.id}
                  onSaved={
                    open.kept
                      ? undefined
                      : () => {
                          setItems((prev) => prev?.map((r) => (r.id === open.id ? { ...r, kept: true } : r)) ?? prev);
                          setOpen({ ...open, kept: true });
                        }
                  }
                />
                <Button type="button" variant="outline" size="sm" onClick={() => setOpen(null)} className="print-hide">
                  Close
                </Button>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <TeacherDocument markdown={open.body} />
          </CardContent>
        </Card>
      )}

      <div className="print-hide space-y-5">
        {items === null && !error ? (
          <div className="flex justify-center py-16">
            <Spinner size="lg" className="text-primary" />
          </div>
        ) : error ? (
          <Card>
            <CardContent>
              <p className="py-8 text-center text-sm text-red-600">{error}</p>
            </CardContent>
          </Card>
        ) : (items ?? []).length === 0 ? (
          <Empty
            title="Nothing here yet"
            text="Everything you generate with the AI assistant is kept here automatically."
            action={{ href: "/secondary-teacher/assistant", label: "Open the assistant" }}
          />
        ) : (
          <>
            {saved.length > 0 && (
              <Section title="Saved" hint="Things you chose to keep.">
                {saved.map((r) => (
                  <Row key={r.id} row={r} busy={busyId === r.id} opening={openingId === r.id} onOpen={() => openResource(r)} onKeep={() => keep(r)} onDelete={() => remove(r)} />
                ))}
              </Section>
            )}
            {recent.length > 0 && (
              <Section title="Recent" hint="Kept automatically as you generate. Press the star to move one to Saved.">
                {recent.map((r) => (
                  <Row key={r.id} row={r} busy={busyId === r.id} opening={openingId === r.id} onOpen={() => openResource(r)} onKeep={() => keep(r)} onDelete={() => remove(r)} />
                ))}
              </Section>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function Section({ title, hint, children }: { title: string; hint: string; children: React.ReactNode }) {
  return (
    <Card>
      <CardHeader>
        <h2 className="font-semibold text-text-primary">{title}</h2>
        <p className="text-xs text-text-muted">{hint}</p>
      </CardHeader>
      <CardContent>
        <ul className="divide-y divide-border">{children}</ul>
      </CardContent>
    </Card>
  );
}

function Row({
  row,
  busy,
  opening,
  onOpen,
  onKeep,
  onDelete,
}: {
  row: ResourceRow;
  busy: boolean;
  opening: boolean;
  onOpen: () => void;
  onKeep: () => void;
  onDelete: () => void;
}) {
  return (
    <li className="flex flex-wrap items-center justify-between gap-3 py-3">
      <div className="min-w-0 flex-1">
        <p className="truncate font-medium text-text-primary">{row.title}</p>
        <p className="text-xs text-text-muted">
          {TASK_LABEL[row.task] ?? row.task}
          {row.subject ? ` · ${displaySubject(row.subject)}` : ""}
          {row.grade ? ` · Grade ${row.grade}` : ""}
          {row.chapterTitle ? ` · ${displayChapterTitle(row.chapterTitle)}` : ""}
          {row.source === "WORKOUT_ACTIVITY" ? " · from an activity" : ""} ·{" "}
          {new Date(row.createdAt).toLocaleDateString()}
        </p>
      </div>
      <div className="flex shrink-0 items-center gap-1.5">
        {!row.kept && (
          <Button type="button" variant="ghost" size="sm" onClick={onKeep} disabled={busy} aria-label={`Keep ${row.title}`} title="Keep — move it to Saved">
            <Star className="h-4 w-4 text-text-muted" />
          </Button>
        )}
        <Button type="button" variant="outline" size="sm" onClick={onOpen} disabled={opening}>
          {opening ? <Spinner size="sm" /> : "Open"}
        </Button>
        <Button type="button" variant="ghost" size="sm" onClick={onDelete} disabled={busy} aria-label={`Delete ${row.title}`}>
          <Trash2 className="h-4 w-4 text-text-muted" />
        </Button>
      </div>
    </li>
  );
}

function Empty({
  title,
  text,
  action,
}: {
  title: string;
  text: string;
  action?: { href: string; label: string };
}) {
  return (
    <Card>
      <CardContent>
        <div className="py-12 text-center">
          <Sparkles className="mx-auto mb-3 h-10 w-10 text-text-muted" />
          <h2 className="font-semibold text-text-primary">{title}</h2>
          <p className="mx-auto mt-1 max-w-md text-sm text-text-secondary">{text}</p>
          {action && (
            <Link
              href={action.href}
              className="mt-4 inline-flex items-center gap-1.5 rounded-xl bg-primary px-4 py-2 text-sm font-semibold text-white hover:bg-primary-dark"
            >
              {action.label} <ArrowRight className="h-4 w-4" />
            </Link>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
