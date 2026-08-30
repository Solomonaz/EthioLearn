"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { Plus, Trash2, Pencil, Play, ArrowLeft, Save, Sparkles } from "lucide-react";
import Link from "next/link";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";

/**
 * Create & manage MCQ question sets (the "Teacher's Questions" that feed Tug of
 * War). Backed by GameContent(MCQ) via /api/teacher/games. Kept intentionally
 * simple and text-light for classroom teachers.
 */

interface McqQ {
  text: string;
  options: string[];
  correctIndex: number;
}

interface SetSummary {
  id: string;
  title: string;
  subject: string;
  grade: number;
  language: string;
  questionCount: number;
}

interface Editing {
  id?: string;
  title: string;
  subject: string;
  grade: number;
  language: "en" | "am";
  questions: McqQ[];
}

interface Assignment {
  id: string;
  subject: string;
  grade: number;
}

const DEFAULT_GRADES = [1, 2, 3, 4, 5, 6];

const emptyDraft: McqQ = { text: "", options: ["", ""], correctIndex: 0 };

function blankEditing(): Editing {
  return { title: "", subject: "", grade: 1, language: "en", questions: [] };
}

export function McqBuilder({ initialEditId }: { initialEditId?: string } = {}) {
  const t = useTranslations("teacher");
  const g = useTranslations("games");
  const c = useTranslations("common");

  const [sets, setSets] = useState<SetSummary[] | null>(null);
  const [editing, setEditing] = useState<Editing | null>(null);
  const [draft, setDraft] = useState<McqQ>(emptyDraft);
  const [saving, setSaving] = useState(false);
  const [assignments, setAssignments] = useState<Assignment[]>([]);

  const load = () =>
    fetch("/api/teacher/games")
      .then((r) => (r.ok ? r.json() : { games: [] }))
      .then((d) => setSets(d.games ?? []))
      .catch(() => setSets([]));

  useEffect(() => {
    load();
    // The teacher's (subject, grade) pairs, used to pre-fill & suggest below.
    fetch("/api/teacher/me/assignments")
      .then((r) => (r.ok ? r.json() : { assignments: [] }))
      .then((d) => setAssignments(d.assignments ?? []))
      .catch(() => {});
    // Deep-link: open a specific set straight into the editor (from the dashboard).
    if (initialEditId) openEdit(initialEditId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Distinct subjects / grades the teacher teaches, for suggestions + defaults.
  const teachSubjects = [...new Set(assignments.map((a) => a.subject))];
  const teachGrades = [...new Set(assignments.map((a) => a.grade))].sort((a, b) => a - b);

  const openNew = () => {
    setDraft(emptyDraft);
    const base = blankEditing();
    // Default a new set to the teacher's first teaching pair, if any.
    if (assignments.length > 0) {
      base.subject = assignments[0].subject;
      base.grade = assignments[0].grade;
    }
    setEditing(base);
  };

  const openEdit = async (id: string) => {
    const res = await fetch(`/api/teacher/games/${id}`);
    if (!res.ok) {
      toast.error(c("error"));
      return;
    }
    const { game } = await res.json();
    setDraft(emptyDraft);
    setEditing({
      id: game.id,
      title: game.title,
      subject: game.subject,
      grade: game.grade,
      language: game.language === "am" ? "am" : "en",
      questions: (game.questions ?? []).map((q: any) => {
        const options: string[] = (q.options ?? []).map(String);
        return {
          text: String(q.question ?? ""),
          options,
          correctIndex: Math.max(0, options.indexOf(String(q.correctAnswer))),
        };
      }),
    });
  };

  const del = async (id: string) => {
    if (!confirm(t("confirmDelete"))) return;
    const res = await fetch(`/api/teacher/games/${id}`, { method: "DELETE" });
    if (res.ok) {
      toast.success(c("delete"));
      load();
    } else {
      toast.error(c("error"));
    }
  };

  // ── question draft helpers ────────────────────────────────
  const addQuestion = () => {
    const text = draft.text.trim();
    const opts = draft.options.map((o) => o.trim()).filter(Boolean);
    if (!text || opts.length < 2 || !draft.options[draft.correctIndex]?.trim()) {
      toast.error(g("mtManInvalid"));
      return;
    }
    setEditing((e) => (e ? { ...e, questions: [...e.questions, { text, options: opts, correctIndex: draft.correctIndex }] } : e));
    setDraft(emptyDraft);
  };

  const save = async () => {
    if (!editing) return;
    if (!editing.title.trim()) {
      toast.error(g("mtManTitlePh"));
      return;
    }
    if (editing.questions.length < 1) {
      toast.error(g("mtManNeed"));
      return;
    }
    setSaving(true);
    const body = {
      title: editing.title.trim(),
      subject: editing.subject.trim() || "General",
      grade: editing.grade,
      language: editing.language,
      questions: editing.questions.map((q) => ({
        question: q.text,
        options: q.options,
        correctAnswer: q.options[q.correctIndex],
      })),
    };
    const res = await fetch(editing.id ? `/api/teacher/games/${editing.id}` : "/api/teacher/games", {
      method: editing.id ? "PUT" : "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    setSaving(false);
    if (res.ok) {
      toast.success(t("savedNote"));
      setEditing(null);
      load();
    } else {
      const d = await res.json().catch(() => null);
      toast.error(d?.error ?? c("error"));
    }
  };

  // ── List view ─────────────────────────────────────────────
  if (!editing) {
    return (
      <div className="mx-auto max-w-3xl space-y-5">
        <div
          className="relative overflow-hidden rounded-3xl p-6 shadow-md"
          style={{ backgroundImage: "linear-gradient(135deg,#1B5E20,#43A047)" }}
        >
          <div className="pointer-events-none absolute -right-8 -top-8 h-32 w-32 rounded-full bg-white/15" />
          <div className="pointer-events-none absolute -bottom-10 left-24 h-28 w-28 rounded-full bg-black/10" />
          <div className="relative flex flex-wrap items-center justify-between gap-4">
            <div className="flex items-center gap-4">
              <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-white/25 backdrop-blur-sm">
                <Sparkles className="h-8 w-8 text-white" />
              </div>
              <div>
                <h1 className="text-2xl font-extrabold text-white sm:text-3xl">{t("createTitle")} ✨</h1>
                <p className="mt-0.5 text-sm font-medium text-white/85">{t("genSub")}</p>
              </div>
            </div>
            <button
              onClick={openNew}
              className="inline-flex items-center gap-2 rounded-full bg-white px-5 py-2.5 text-sm font-bold text-primary shadow-sm transition hover:bg-white/90 active:scale-95"
            >
              <Plus className="h-4 w-4" /> {c("create")}
            </button>
          </div>
        </div>

        {sets === null ? (
          <p className="text-text-muted">{c("loading")}</p>
        ) : sets.length === 0 ? (
          <Card className="p-8 text-center text-text-muted">{t("noSaved")}</Card>
        ) : (
          <div className="space-y-2">
            {sets.map((s) => (
              <Card key={s.id} className="flex items-center justify-between gap-3 p-4">
                <div className="min-w-0">
                  <p className="truncate font-semibold text-text-primary">{s.title}</p>
                  <p className="text-sm text-text-muted">
                    {s.subject} · {t("gradeOption", { grade: s.grade })} · {g("itemsCount", { count: s.questionCount })}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  <Link
                    href={`/teacher/games/tug?set=${s.id}`}
                    className="rounded-lg p-2 text-text-muted hover:bg-border/50 hover:text-primary"
                    title={g("play")}
                  >
                    <Play className="h-4 w-4" />
                  </Link>
                  <button onClick={() => openEdit(s.id)} className="rounded-lg p-2 text-text-muted hover:bg-border/50 hover:text-text-primary" title={c("edit")}>
                    <Pencil className="h-4 w-4" />
                  </button>
                  <button onClick={() => del(s.id)} className="rounded-lg p-2 text-text-muted hover:bg-border/50 hover:text-error" title={c("delete")}>
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              </Card>
            ))}
          </div>
        )}
      </div>
    );
  }

  // ── Editor view ───────────────────────────────────────────
  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <button onClick={() => setEditing(null)} className="inline-flex items-center gap-1.5 text-sm font-medium text-text-secondary hover:text-text-primary">
        <ArrowLeft className="h-4 w-4" /> {c("back")}
      </button>

      {/* Quick-pick from what the teacher teaches — fills subject + grade together */}
      {assignments.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-medium text-text-secondary">{t("teachTitle")}:</span>
          {assignments.map((a) => {
            const active = editing.subject === a.subject && editing.grade === a.grade;
            return (
              <button
                key={a.id}
                type="button"
                onClick={() => setEditing({ ...editing, subject: a.subject, grade: a.grade })}
                className={cn(
                  "rounded-full px-3 py-1 text-xs font-semibold transition",
                  active
                    ? "bg-primary text-white shadow-sm"
                    : "bg-primary/10 text-primary hover:bg-primary/20",
                )}
              >
                {a.subject} · {t("gradeOption", { grade: a.grade })}
              </button>
            );
          })}
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <Input
            label={t("createTitle")}
            placeholder={g("mtManTitlePh")}
            value={editing.title}
            onChange={(e) => setEditing({ ...editing, title: e.target.value })}
          />
        </div>
        <div>
          <Input
            label={t("subjectLabel")}
            placeholder={t("subjectPlaceholder")}
            value={editing.subject}
            onChange={(e) => setEditing({ ...editing, subject: e.target.value })}
            list={teachSubjects.length > 0 ? "mcq-subject-options" : undefined}
          />
          {teachSubjects.length > 0 && (
            <datalist id="mcq-subject-options">
              {teachSubjects.map((s) => (
                <option key={s} value={s} />
              ))}
            </datalist>
          )}
        </div>
        <div>
          <label className="mb-2 block text-sm font-medium text-text-primary">{t("gradeLabel")}</label>
          <select
            value={editing.grade}
            onChange={(e) => setEditing({ ...editing, grade: Number(e.target.value) })}
            className="w-full rounded-lg border border-border bg-surface px-4 py-3 text-text-primary"
          >
            {/* Prefer the grades the teacher teaches; always include the set's
                current grade so an existing set stays selectable. */}
            {[...new Set([...(teachGrades.length ? teachGrades : DEFAULT_GRADES), editing.grade])]
              .sort((a, b) => a - b)
              .map((gr) => (
                <option key={gr} value={gr}>
                  {t("gradeOption", { grade: gr })}
                </option>
              ))}
          </select>
        </div>
      </div>

      {/* existing questions */}
      {editing.questions.length > 0 && (
        <ul className="divide-y divide-border rounded-lg border border-border">
          {editing.questions.map((q, i) => (
            <li key={i} className="flex items-center justify-between gap-2 px-4 py-2.5 text-sm">
              <span className="min-w-0 truncate text-text-primary">
                <span className="font-medium">{i + 1}.</span> {q.text}{" "}
                <span className="text-text-muted">— {q.options[q.correctIndex]}</span>
              </span>
              <button
                onClick={() => setEditing({ ...editing, questions: editing.questions.filter((_, j) => j !== i) })}
                className="shrink-0 text-text-muted hover:text-error"
              >
                <Trash2 className="h-4 w-4" />
              </button>
            </li>
          ))}
        </ul>
      )}

      {/* draft question */}
      <Card className="space-y-3 p-4">
        <Input placeholder={g("mtManQuestionPh")} value={draft.text} onChange={(e) => setDraft({ ...draft, text: e.target.value })} />
        <div className="space-y-2">
          {draft.options.map((opt, i) => (
            <div key={i} className="flex items-center gap-2">
              <input
                type="radio"
                name="mcq-correct"
                title={g("mtManCorrect")}
                checked={draft.correctIndex === i}
                onChange={() => setDraft({ ...draft, correctIndex: i })}
                className="accent-primary"
              />
              <Input placeholder={g("mtManOptionPh", { n: i + 1 })} value={opt} onChange={(e) => setDraft({ ...draft, options: draft.options.map((o, j) => (j === i ? e.target.value : o)) })} />
              {draft.options.length > 2 && (
                <button
                  onClick={() =>
                    setDraft({
                      ...draft,
                      options: draft.options.filter((_, j) => j !== i),
                      correctIndex: Math.min(draft.correctIndex, draft.options.length - 2),
                    })
                  }
                  className="text-text-muted hover:text-error"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              )}
            </div>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {draft.options.length < 4 && (
            <Button variant="outline" size="sm" onClick={() => setDraft({ ...draft, options: [...draft.options, ""] })}>
              <Plus className="h-4 w-4" /> {g("mtManOptionPh", { n: draft.options.length + 1 })}
            </Button>
          )}
          <Button size="sm" onClick={addQuestion}>
            <Plus className="h-4 w-4" /> {g("mtManAdd")}
          </Button>
          <span className="text-sm text-text-muted">{g("mtManList", { n: editing.questions.length })}</span>
        </div>
      </Card>

      <Button size="lg" className="w-full" onClick={save} isLoading={saving}>
        <Save className="h-5 w-5" /> {c("save")}
      </Button>
    </div>
  );
}
