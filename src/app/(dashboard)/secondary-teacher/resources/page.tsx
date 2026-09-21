"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { ArrowRight, BookMarked, Sparkles, Trash2 } from "lucide-react";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { toast } from "@/components/ui/sonner";
import { MarkdownView } from "@/components/ui/markdown-view";
import { ResourceActions } from "@/components/secondary-teacher/resource-actions";
import { ASSISTANT_TASKS } from "@/lib/assistant-tasks";

/**
 * The teacher's saved AI material. Opening one loads its body on demand — the
 * list itself carries only titles, so a library of fifty lesson plans stays
 * light on a slow connection.
 */

interface ResourceRow {
  id: string;
  task: string;
  title: string;
  subject: string | null;
  grade: number | null;
  chapterTitle: string | null;
  createdAt: string;
}

interface OpenResource extends ResourceRow {
  body: string;
}

const TASK_LABEL: Record<string, string> = Object.fromEntries(
  ASSISTANT_TASKS.map((t) => [t.value, t.label]),
);

export default function TeacherResourcesPage() {
  const [resources, setResources] = useState<ResourceRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [open, setOpen] = useState<OpenResource | null>(null);
  const [openingId, setOpeningId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/secondary-teacher/resources");
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? "Failed to load your materials");
      setResources(data.resources ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function openResource(row: ResourceRow) {
    setOpeningId(row.id);
    try {
      const res = await fetch(`/api/secondary-teacher/resources/${row.id}`);
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? "Could not open that");
      setOpen(data.resource);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setOpeningId(null);
    }
  }

  async function remove(row: ResourceRow) {
    if (!window.confirm(`Delete "${row.title}"? This cannot be undone.`)) return;
    setDeletingId(row.id);
    try {
      const res = await fetch(`/api/secondary-teacher/resources/${row.id}`, {
        method: "DELETE",
      });
      if (!res.ok) throw new Error("Could not delete that");
      setResources((prev) => prev.filter((r) => r.id !== row.id));
      if (open?.id === row.id) setOpen(null);
      toast.success("Deleted.");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setDeletingId(null);
    }
  }

  return (
    <div className="mx-auto max-w-5xl space-y-5">
      <div className="print-hide">
        <h1 className="flex items-center gap-2 text-2xl font-bold text-text-primary">
          <BookMarked className="h-6 w-6 text-primary" /> My materials
        </h1>
        <p className="text-sm text-text-secondary">
          Lesson plans, worksheets and notes you have saved from the AI assistant.
        </p>
      </div>

      {open && (
        <Card className="print-area">
          <CardHeader>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <h2 className="font-semibold text-text-primary">{open.title}</h2>
                <p className="print-hide text-xs text-text-muted">
                  {TASK_LABEL[open.task] ?? open.task}
                  {open.subject ? ` · ${open.subject}` : ""}
                  {open.grade ? ` · Grade ${open.grade}` : ""}
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <ResourceActions title={open.title} markdown={open.body} task={open.task} />
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setOpen(null)}
                  className="print-hide"
                >
                  Close
                </Button>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <MarkdownView markdown={open.body} />
          </CardContent>
        </Card>
      )}

      <div className="print-hide">
        {loading ? (
          <div className="flex justify-center py-16">
            <Spinner size="lg" className="text-primary" />
          </div>
        ) : error ? (
          <Card>
            <CardContent>
              <p className="py-8 text-center text-sm text-red-600">{error}</p>
            </CardContent>
          </Card>
        ) : resources.length === 0 ? (
          <Card>
            <CardContent>
              <div className="py-12 text-center">
                <Sparkles className="mx-auto mb-3 h-10 w-10 text-text-muted" />
                <h2 className="font-semibold text-text-primary">Nothing saved yet</h2>
                <p className="mx-auto mt-1 max-w-md text-sm text-text-secondary">
                  Generate something with the AI assistant, then press Save to keep it
                  here.
                </p>
                <Link
                  href="/secondary-teacher/assistant"
                  className="mt-4 inline-flex items-center gap-1.5 rounded-xl bg-primary px-4 py-2 text-sm font-semibold text-white hover:bg-primary-dark"
                >
                  Open the assistant <ArrowRight className="h-4 w-4" />
                </Link>
              </div>
            </CardContent>
          </Card>
        ) : (
          <Card>
            <CardContent>
              <ul className="divide-y divide-border">
                {resources.map((r) => (
                  <li
                    key={r.id}
                    className="flex flex-wrap items-center justify-between gap-3 py-3"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-medium text-text-primary">{r.title}</p>
                      <p className="text-xs text-text-muted">
                        {TASK_LABEL[r.task] ?? r.task}
                        {r.subject ? ` · ${r.subject}` : ""}
                        {r.grade ? ` · Grade ${r.grade}` : ""} ·{" "}
                        {new Date(r.createdAt).toLocaleDateString()}
                      </p>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => openResource(r)}
                        disabled={openingId === r.id}
                      >
                        {openingId === r.id ? <Spinner size="sm" /> : "Open"}
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => remove(r)}
                        disabled={deletingId === r.id}
                        aria-label={`Delete ${r.title}`}
                      >
                        {deletingId === r.id ? (
                          <Spinner size="sm" />
                        ) : (
                          <Trash2 className="h-4 w-4 text-text-muted" />
                        )}
                      </Button>
                    </div>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
