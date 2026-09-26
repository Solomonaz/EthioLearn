"use client";

import { useEffect, useMemo, useState } from "react";
import { ChevronDown, ChevronUp, Merge, Search, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { toast } from "@/components/ui/sonner";
import {
  GenerationProgressCard,
  type GenerationProgressState,
  type ProgressStage,
} from "@/components/ui/generation-progress";
import { consumeSse } from "@/lib/sse-client";
import { cn } from "@/lib/utils";
import { ASSISTANT_TASKS } from "@/lib/assistant-tasks";
import { displayChapterTitle, displaySubject } from "@/lib/display-text";
import { TeacherDocument } from "./teacher-document";

/**
 * Merge several of the teacher's own materials into one polished document.
 *
 * The assistant writes best from one chapter at a time, so this is the other
 * half of that advice: generate chapter by chapter, then merge. The teacher
 * browses their Materials, previews what they need to, ticks them in the order
 * they want them, and gets back a single document — stored as a new item, with
 * the originals untouched.
 *
 * One subject at a time: a Biology worksheet and a Chemistry one are not one
 * document, so the teacher picks the subject first and only its materials are
 * listed (the server refuses a mix too). Once merged, the dialog closes and
 * the result opens for review; sending it is the document's own Give to class.
 */

/** Grouping key for a subject; "" is materials written without one. */
function subjectKey(s: string | null): string {
  return (s ?? "").trim().replace(/\s+/g, " ").toLowerCase();
}

const MIN_DOCS = 2;
const MAX_DOCS = 6;

const STAGES: ProgressStage[] = [
  { at: 8, label: "1. Read materials" },
  { at: 25, label: "2. Merge" },
  { at: 88, label: "3. Format" },
];

const TASK_LABEL: Record<string, string> = Object.fromEntries(
  ASSISTANT_TASKS.map((t) => [t.value, t.label]),
);

interface Row {
  id: string;
  task: string;
  title: string;
  subject: string | null;
  grade: number | null;
  chapterTitle: string | null;
  createdAt: string;
}

export interface MergedResult {
  title: string;
  markdown: string;
  resourceId: string | null;
  task: string;
  subject: string | null;
  grade: number | null;
  chapterTitle: string | null;
}

export function MergeMaterialsDialog({
  onClose,
  onMerged,
}: {
  onClose: () => void;
  onMerged: (result: MergedResult) => void;
}) {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [query, setQuery] = useState("");
  /** The kind being merged — one kind per merge, like one subject. */
  const [kind, setKind] = useState("");
  /** Ticked ids, in the order ticked — the order of the merged document. */
  const [picked, setPicked] = useState<string[]>([]);
  const [instructions, setInstructions] = useState("");
  const [previewId, setPreviewId] = useState<string | null>(null);
  const [previews, setPreviews] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<GenerationProgressState | null>(null);
  /** The subject being merged — see the note at the top. */
  const [subject, setSubject] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/secondary-teacher/resources?limit=200")
      .then((r) => (r.ok ? r.json() : { resources: [] }))
      .then((d) => {
        const list: Row[] = d.resources ?? [];
        setRows(list);
        // Start on the subject of the most recent material.
        if (list[0]) setSubject(subjectKey(list[0].subject));
      })
      .catch(() => setRows([]));
  }, []);

  /** Subjects the teacher has materials in, with a display name and count. */
  const subjects = useMemo(() => {
    const map = new Map<string, { label: string; count: number }>();
    for (const r of rows ?? []) {
      const k = subjectKey(r.subject);
      const cur = map.get(k);
      if (cur) cur.count++;
      else map.set(k, { label: r.subject ? displaySubject(r.subject) : "General", count: 1 });
    }
    return [...map.entries()].map(([key, v]) => ({ key, ...v }));
  }, [rows]);

  function pickSubject(key: string) {
    if (key === subject) return;
    setSubject(key);
    // Picks never cross subjects, so a new subject starts a new selection.
    setPicked([]);
    setKind("");
    setPreviewId(null);
  }

  function pickKind(k: string) {
    if (k === kind) return;
    setKind(k);
    // A worksheet and board notes are not one document: a new kind starts a
    // new selection, as a new subject does.
    setPicked([]);
    setPreviewId(null);
  }

  const inSubject = useMemo(
    () => (rows ?? []).filter((r) => subjectKey(r.subject) === subject),
    [rows, subject],
  );

  /** Kinds the teacher has in this subject, with counts — never an empty choice. */
  const kinds = useMemo(() => {
    const counts = new Map<string, number>();
    for (const r of inSubject) counts.set(r.task, (counts.get(r.task) ?? 0) + 1);
    return [...counts.entries()].map(([key, count]) => ({ key, count }));
  }, [inSubject]);

  // Default to the subject's first kind, and keep the choice valid when the
  // subject changes.
  useEffect(() => {
    if (kinds.length > 0 && !kinds.some((k) => k.key === kind)) setKind(kinds[0].key);
  }, [kinds, kind]);

  const inKind = useMemo(() => inSubject.filter((r) => r.task === kind), [inSubject, kind]);

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return inKind.filter(
      (r) =>
        !q || r.title.toLowerCase().includes(q) || (r.chapterTitle ?? "").toLowerCase().includes(q),
    );
  }, [inKind, query]);

  function toggle(id: string) {
    setPicked((cur) => {
      if (cur.includes(id)) return cur.filter((x) => x !== id);
      if (cur.length >= MAX_DOCS) {
        toast.error(`You can merge up to ${MAX_DOCS} at a time.`);
        return cur;
      }
      return [...cur, id];
    });
  }

  function move(id: string, by: -1 | 1) {
    setPicked((cur) => {
      const i = cur.indexOf(id);
      const j = i + by;
      if (i < 0 || j < 0 || j >= cur.length) return cur;
      const next = [...cur];
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    });
  }

  async function togglePreview(id: string) {
    if (previewId === id) {
      setPreviewId(null);
      return;
    }
    setPreviewId(id);
    if (previews[id] !== undefined) return;
    try {
      const res = await fetch(`/api/secondary-teacher/resources/${id}`);
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? "Could not open that");
      setPreviews((p) => ({ ...p, [id]: data.resource.body as string }));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not open that");
      setPreviewId(null);
    }
  }

  async function merge() {
    if (busy || picked.length < MIN_DOCS) return;
    setBusy(true);
    setProgress({ message: "Starting...", percent: 5 });
    try {
      const res = await fetch("/api/secondary-teacher/resources/merge?stream=1", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ resourceIds: picked, instructions: instructions.trim() }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error ?? "Could not merge those");
      }
      const data = await consumeSse<MergedResult>(
        res,
        setProgress,
        "The connection ended before the merge was finished.",
      );
      toast.success("Merged. It's in your Materials.");
      onMerged(data);
      onClose();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setBusy(false);
      setProgress(null);
    }
  }

  const byId = new Map((rows ?? []).map((r) => [r.id, r]));
  const label = "text-xs font-semibold uppercase tracking-wide text-text-muted";
  const fieldClass =
    "w-full rounded-xl border border-border bg-background px-3 py-2.5 text-sm text-text-primary outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/15";

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 backdrop-blur-[2px] sm:items-center sm:p-6">
      <div className="flex max-h-[94vh] w-full max-w-3xl flex-col overflow-hidden rounded-t-[28px] bg-surface shadow-2xl sm:max-h-[90vh] sm:rounded-[28px]">
        {/* ── Header ─────────────────────────────────────────────────────── */}
        <div className="shrink-0 bg-gradient-to-br from-primary/15 via-primary/5 to-transparent px-5 pb-5 pt-5 sm:px-8 sm:pt-6">
          <div className="flex items-start justify-between gap-3">
            <div className="flex min-w-0 items-center gap-3">
              <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-primary text-white shadow-sm">
                <Merge className="h-5 w-5" />
              </span>
              <div className="min-w-0">
                <h2 className="text-lg font-bold text-text-primary sm:text-xl">Merge materials</h2>
                <p className="text-sm text-text-secondary">
                  Pick {MIN_DOCS}–{MAX_DOCS} materials of one subject and one kind. They are combined in the
                  order shown below.
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={onClose}
              disabled={busy}
              aria-label="Close"
              className="shrink-0 rounded-xl p-2 text-text-muted transition hover:bg-surface/80 hover:text-text-primary"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
        </div>

        {/* ── Body ───────────────────────────────────────────────────────── */}
        <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-5 py-5 sm:px-8 sm:py-6">
          {busy ? (
            <GenerationProgressCard
              progress={progress}
              stages={STAGES}
              idleMessage="Merging with AI..."
              footnote="Longer materials take the most time. This can take a minute or two."
            />
          ) : rows === null ? (
            <div className="flex justify-center py-10">
              <Spinner size="lg" className="text-primary" />
            </div>
          ) : rows.length < MIN_DOCS ? (
            <p className="rounded-2xl border border-dashed border-border px-4 py-10 text-center text-sm text-text-secondary">
              You need at least {MIN_DOCS} materials to merge. Generate one chapter at a time with the
              assistant, then come back here.
            </p>
          ) : (
            <>
              {/* Subject first — materials of different subjects never merge. */}
              <div className="space-y-2">
                <span className={label}>Subject</span>
                <div className="flex flex-wrap gap-2">
                  {subjects.map((sub) => (
                    <button
                      key={sub.key}
                      type="button"
                      onClick={() => pickSubject(sub.key)}
                      aria-pressed={subject === sub.key}
                      className={cn(
                        "rounded-full border px-3 py-1.5 text-sm font-semibold transition",
                        subject === sub.key
                          ? "border-primary bg-primary/10 text-primary"
                          : "border-border bg-background text-text-secondary hover:border-primary/40",
                      )}
                    >
                      {sub.label} <span className="font-normal opacity-70">({sub.count})</span>
                    </button>
                  ))}
                </div>
              </div>

              {/* Then the kind — a worksheet never merges with board notes. */}
              <div className="space-y-2">
                <span className={label}>Kind</span>
                <div className="flex flex-wrap gap-2">
                  {kinds.map((k) => (
                    <button
                      key={k.key}
                      type="button"
                      onClick={() => pickKind(k.key)}
                      aria-pressed={kind === k.key}
                      className={cn(
                        "rounded-full border px-3 py-1.5 text-sm font-semibold transition",
                        kind === k.key
                          ? "border-primary bg-primary/10 text-primary"
                          : "border-border bg-background text-text-secondary hover:border-primary/40",
                      )}
                    >
                      {TASK_LABEL[k.key] ?? k.key} <span className="font-normal opacity-70">({k.count})</span>
                    </button>
                  ))}
                </div>
              </div>

              {/* Browse */}
              <div className="space-y-2">
                <span className={label}>Your materials</span>
                <div className="relative">
                  <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-muted" />
                  <input
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder="Search by title or chapter"
                    aria-label="Search your materials"
                    className={cn(fieldClass, "pl-9")}
                  />
                </div>

                {shown.length === 0 ? (
                  <p className="py-6 text-center text-sm text-text-muted">Nothing matches.</p>
                ) : (
                  <ul className="divide-y divide-border rounded-xl border border-border">
                    {shown.map((r) => {
                      const order = picked.indexOf(r.id);
                      const on = order !== -1;
                      return (
                        <li key={r.id} className={cn(on && "bg-primary/[0.04]")}>
                          <div className="flex items-center gap-3 px-3 py-2.5">
                            <label className="flex min-w-0 flex-1 cursor-pointer items-center gap-3">
                              <input
                                type="checkbox"
                                checked={on}
                                onChange={() => toggle(r.id)}
                                className="h-4 w-4 shrink-0 accent-[var(--color-primary)]"
                              />
                              <span className="min-w-0">
                                <span className="block truncate text-sm font-medium text-text-primary">
                                  {on && (
                                    <span className="mr-1.5 inline-flex h-5 w-5 items-center justify-center rounded-full bg-primary text-[11px] font-bold text-white">
                                      {order + 1}
                                    </span>
                                  )}
                                  {r.title}
                                </span>
                                <span className="block truncate text-xs text-text-muted">
                                  {TASK_LABEL[r.task] ?? r.task}
                                  {r.subject ? ` · ${displaySubject(r.subject)}` : ""}
                                  {r.grade ? ` · Grade ${r.grade}` : ""}
                                  {r.chapterTitle ? ` · ${displayChapterTitle(r.chapterTitle)}` : ""} ·{" "}
                                  {new Date(r.createdAt).toLocaleDateString()}
                                </span>
                              </span>
                            </label>
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              onClick={() => void togglePreview(r.id)}
                              aria-expanded={previewId === r.id}
                            >
                              {previewId === r.id ? "Hide" : "Preview"}
                            </Button>
                          </div>
                          {previewId === r.id && (
                            <div className="mx-3 mb-3 max-h-72 overflow-y-auto rounded-xl border border-border bg-background p-4">
                              {previews[r.id] === undefined ? (
                                <div className="flex justify-center py-6">
                                  <Spinner className="text-primary" />
                                </div>
                              ) : (
                                <TeacherDocument markdown={previews[r.id]} />
                              )}
                            </div>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>

              {/* The merge order, editable. Below the list, so ticking never shifts the rows being ticked. */}
              {picked.length > 0 && (
                <div className="space-y-2">
                  <span className={label}>Merge order</span>
                  <ol className="space-y-1.5">
                    {picked.map((id, i) => {
                      const r = byId.get(id);
                      if (!r) return null;
                      return (
                        <li
                          key={id}
                          className="flex items-center gap-2 rounded-xl border border-primary/30 bg-primary/[0.05] px-3 py-2"
                        >
                          <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary text-xs font-bold text-white">
                            {i + 1}
                          </span>
                          <span className="min-w-0 flex-1 truncate text-sm font-medium text-text-primary">
                            {r.title}
                          </span>
                          <button
                            type="button"
                            onClick={() => move(id, -1)}
                            disabled={i === 0}
                            aria-label={`Move ${r.title} up`}
                            className="rounded-lg p-1 text-text-muted hover:bg-border/40 disabled:opacity-30"
                          >
                            <ChevronUp className="h-4 w-4" />
                          </button>
                          <button
                            type="button"
                            onClick={() => move(id, 1)}
                            disabled={i === picked.length - 1}
                            aria-label={`Move ${r.title} down`}
                            className="rounded-lg p-1 text-text-muted hover:bg-border/40 disabled:opacity-30"
                          >
                            <ChevronDown className="h-4 w-4" />
                          </button>
                          <button
                            type="button"
                            onClick={() => toggle(id)}
                            aria-label={`Remove ${r.title}`}
                            className="rounded-lg p-1 text-text-muted hover:bg-border/40"
                          >
                            <X className="h-4 w-4" />
                          </button>
                        </li>
                      );
                    })}
                  </ol>
                </div>
              )}

              <div className="space-y-1.5">
                <label htmlFor="merge-instructions" className={label}>
                  Instructions <span className="normal-case tracking-normal">(optional)</span>
                </label>
                <textarea
                  id="merge-instructions"
                  rows={2}
                  value={instructions}
                  onChange={(e) => setInstructions(e.target.value)}
                  maxLength={1000}
                  placeholder="e.g. one section per chapter, total out of 50 marks, put the hardest problems last"
                  className={fieldClass}
                />
              </div>
            </>
          )}
        </div>

        {/* ── Footer ─────────────────────────────────────────────────────── */}
        <div className="flex shrink-0 items-center justify-between gap-3 border-t border-border px-5 py-4 sm:px-8">
          <p className="min-w-0 text-sm text-text-muted">
            {inKind.length < MIN_DOCS
                ? `Only ${inKind.length} of this kind in this subject — generate another chapter to merge.`
                : picked.length < MIN_DOCS
                  ? `Tick at least ${MIN_DOCS}.`
                  : "Saved as a new item — the originals stay as they are."}
          </p>
          <div className="flex shrink-0 gap-2">
            <Button type="button" variant="outline" onClick={onClose} disabled={busy}>
              Cancel
            </Button>
            <Button type="button" onClick={() => void merge()} disabled={busy || picked.length < MIN_DOCS}>
              <Merge className="mr-1.5 h-4 w-4" />
              Merge{picked.length >= MIN_DOCS ? ` ${picked.length}` : ""}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
