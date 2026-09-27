"use client";

import {
  BarChart3,
  Library,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Clock,
  Layers,
  Pencil,
  Target,
  Trash2,
  X,
  ZapOff,
} from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { MathText } from "@/components/ui/math-text";
import { cn } from "@/lib/utils";

// ─── Shared types ─────────────────────────────────────────

export type Difficulty = "EASY" | "MEDIUM" | "HARD";
export type QuestionType = "MCQ" | "TRUE_FALSE" | "FILL_IN_BLANK" | "MATCH_PAIRS" | "ORDERING";

export interface QuestionStats {
  total: number;
  byDifficulty: Record<Difficulty, number>;
  unused: number;
  answered: number;
  avgAccuracy: number | null;
}

export interface QuestionRowData {
  id: string;
  type: QuestionType;
  difficulty: Difficulty;
  questionText: string;
  options: string[];
  correctAnswer: string;
  explanation: string | null;
  answerCount: number;
  accuracy: number | null;
  createdAt: string;
  /** False for national-library questions viewed by a school admin. */
  canManage?: boolean;
  chapter: {
    title: string;
    chapterNumber: number;
    textbook: { title: string; subject: string; grade: number };
  };
}

export const DIFFICULTY_STYLE: Record<Difficulty, { label: string; chip: string; bar: string; dot: string }> = {
  EASY: { label: "Easy", chip: "bg-success/10 text-success", bar: "bg-success", dot: "bg-success" },
  MEDIUM: { label: "Medium", chip: "bg-warning/10 text-warning", bar: "bg-warning", dot: "bg-warning" },
  HARD: { label: "Hard", chip: "bg-error/10 text-error", bar: "bg-error", dot: "bg-error" },
};

export const TYPE_SHORT: Record<QuestionType, string> = {
  MCQ: "MCQ",
  TRUE_FALSE: "True/False",
  FILL_IN_BLANK: "Fill blank",
  MATCH_PAIRS: "Match",
  ORDERING: "Ordering",
};

function pct(n: number) {
  return `${Math.round(n * 100)}%`;
}

function accuracyTone(a: number) {
  return a >= 0.75 ? "text-success" : a >= 0.5 ? "text-warning" : "text-error";
}

function accuracyBar(a: number) {
  return a >= 0.75 ? "bg-success" : a >= 0.5 ? "bg-warning" : "bg-error";
}

function relativeDate(iso: string) {
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
  if (days <= 0) return "Today";
  if (days === 1) return "Yesterday";
  if (days < 30) return `${days}d ago`;
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

// ─── Stats strip ──────────────────────────────────────────

function StatTile({
  icon: Icon,
  label,
  children,
  hint,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  children: React.ReactNode;
  hint?: React.ReactNode;
}) {
  return (
    <div className="rounded-xl border border-border bg-surface p-4 shadow-sm">
      <div className="flex items-center gap-2 text-xs font-medium text-text-secondary">
        <Icon className="h-4 w-4 text-primary" />
        {label}
      </div>
      <div className="mt-2">{children}</div>
      {hint && <div className="mt-1 text-xs text-text-muted">{hint}</div>}
    </div>
  );
}

export function StatsStrip({ stats }: { stats: QuestionStats | null }) {
  if (!stats) {
    return (
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="rounded-xl border border-border bg-surface p-4 shadow-sm">
            <Skeleton className="h-3 w-24" />
            <Skeleton className="mt-3 h-7 w-16" />
            <Skeleton className="mt-2 h-3 w-28" />
          </div>
        ))}
      </div>
    );
  }

  const { total, byDifficulty, unused, answered, avgAccuracy } = stats;

  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      <StatTile icon={Layers} label="Questions in view" hint="Matching current filters">
        <p className="text-2xl font-bold tabular-nums text-text-primary">{total.toLocaleString()}</p>
      </StatTile>

      <StatTile icon={BarChart3} label="Difficulty mix">
        <div className="flex h-2.5 overflow-hidden rounded-full bg-border/60">
          {total > 0 &&
            (Object.keys(byDifficulty) as Difficulty[]).map((d) =>
              byDifficulty[d] > 0 ? (
                <div
                  key={d}
                  className={DIFFICULTY_STYLE[d].bar}
                  style={{ width: `${(byDifficulty[d] / total) * 100}%` }}
                  title={`${DIFFICULTY_STYLE[d].label}: ${byDifficulty[d]}`}
                />
              ) : null,
            )}
        </div>
        <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs text-text-secondary">
          {(Object.keys(byDifficulty) as Difficulty[]).map((d) => (
            <span key={d} className="inline-flex items-center gap-1 tabular-nums">
              <span className={cn("h-2 w-2 rounded-full", DIFFICULTY_STYLE[d].dot)} />
              {byDifficulty[d]}
            </span>
          ))}
        </div>
      </StatTile>

      <StatTile
        icon={ZapOff}
        label="Never answered"
        hint={total > 0 ? `${pct(unused / total)} of questions` : "—"}
      >
        <p className="text-2xl font-bold tabular-nums text-text-primary">{unused.toLocaleString()}</p>
      </StatTile>

      <StatTile
        icon={Target}
        label="Student accuracy"
        hint={answered > 0 ? `Across ${answered.toLocaleString()} answers` : "No answers yet"}
      >
        <p
          className={cn(
            "text-2xl font-bold tabular-nums",
            avgAccuracy == null ? "text-text-muted" : accuracyTone(avgAccuracy),
          )}
        >
          {avgAccuracy == null ? "—" : pct(avgAccuracy)}
        </p>
      </StatTile>
    </div>
  );
}

// ─── Question row ─────────────────────────────────────────

export function QuestionRow({
  q,
  expanded,
  isEditing,
  isConfirming,
  isDeleting,
  onToggle,
  onEdit,
  onAskDelete,
  onCancelDelete,
  onDelete,
}: {
  q: QuestionRowData;
  expanded: boolean;
  isEditing: boolean;
  isConfirming: boolean;
  isDeleting: boolean;
  onToggle: () => void;
  onEdit: () => void;
  onAskDelete: () => void;
  onCancelDelete: () => void;
  onDelete: () => void;
}) {
  const diff = DIFFICULTY_STYLE[q.difficulty];
  const readOnly = q.canManage === false;

  return (
    <div
      className={cn(
        "group relative transition-colors",
        isEditing ? "bg-primary/5" : expanded ? "bg-background" : "hover:bg-background",
      )}
    >
      {/* Difficulty accent */}
      <span className={cn("absolute inset-y-0 left-0 w-1", diff.bar, "opacity-70")} aria-hidden />

      <div className="flex items-start gap-3 py-3.5 pl-5 pr-3 sm:pr-4">
        <button
          type="button"
          onClick={onToggle}
          className="min-w-0 flex-1 text-left"
          aria-expanded={expanded}
        >
          {/* Meta line */}
          <div className="mb-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
            <span className="font-medium text-text-primary">
              {q.chapter.textbook.subject} · G{q.chapter.textbook.grade}
            </span>
            <span className="text-text-muted">•</span>
            <span className="min-w-0 max-w-[16rem] truncate text-text-secondary sm:max-w-xs">
              Ch {q.chapter.chapterNumber}: {q.chapter.title}
            </span>
            {readOnly && (
              <span
                className="inline-flex items-center gap-1 rounded-full bg-info/10 px-2 py-0.5 font-medium text-info"
                title="National library question — shared by every school, managed by the platform"
              >
                <Library className="h-3 w-3" />
                Library
              </span>
            )}
          </div>

          <p className={cn("text-sm leading-relaxed text-text-primary", !expanded && "line-clamp-2")}>
            <MathText text={q.questionText} />
          </p>

          {/* Chips */}
          <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
            <span className={cn("rounded-full px-2 py-0.5 font-semibold", diff.chip)}>{diff.label}</span>
            <span className="rounded-full border border-border px-2 py-0.5 text-text-secondary">
              {TYPE_SHORT[q.type] ?? q.type}
            </span>
            {q.answerCount > 0 && q.accuracy != null ? (
              <span className="inline-flex items-center gap-1.5 text-text-secondary">
                <span className="h-1.5 w-12 overflow-hidden rounded-full bg-border/70">
                  <span
                    className={cn("block h-full", accuracyBar(q.accuracy))}
                    style={{ width: pct(q.accuracy) }}
                  />
                </span>
                <span className={cn("font-medium tabular-nums", accuracyTone(q.accuracy))}>
                  {pct(q.accuracy)}
                </span>
                <span className="tabular-nums text-text-muted">of {q.answerCount}</span>
              </span>
            ) : (
              <span className="text-text-muted">Not answered yet</span>
            )}
            <span className="inline-flex items-center gap-1 text-text-muted">
              <Clock className="h-3 w-3" />
              {relativeDate(q.createdAt)}
            </span>
          </div>
        </button>

        {/* Actions */}
        <div className="flex shrink-0 items-center gap-1">
          {isConfirming ? (
            <div className="flex items-center gap-1.5 rounded-lg border border-error/30 bg-error/5 py-1 pl-2.5 pr-1">
              <span className="text-xs font-medium text-error">Delete?</span>
              <Button variant="outline" size="sm" onClick={onCancelDelete}>
                No
              </Button>
              <Button
                size="sm"
                isLoading={isDeleting}
                className="bg-red-600 text-white hover:bg-red-700"
                onClick={onDelete}
              >
                Yes
              </Button>
            </div>
          ) : (
            <>
              {!readOnly && (
              <>
              <button
                type="button"
                className={cn(
                  "rounded-lg p-2 transition-colors",
                  isEditing
                    ? "bg-primary/10 text-primary"
                    : "text-text-muted hover:bg-primary/10 hover:text-primary",
                )}
                title={isEditing ? "Cancel edit" : "Edit question"}
                onClick={onEdit}
              >
                {isEditing ? <X className="h-4 w-4" /> : <Pencil className="h-4 w-4" />}
              </button>
              <button
                type="button"
                className="rounded-lg p-2 text-text-muted transition-colors hover:bg-error/10 hover:text-error disabled:cursor-not-allowed disabled:opacity-50"
                title="Delete question"
                disabled={isDeleting}
                onClick={onAskDelete}
              >
                {isDeleting ? <Spinner size="sm" /> : <Trash2 className="h-4 w-4" />}
              </button>
              </>
              )}
              <button
                type="button"
                className="rounded-lg p-2 text-text-muted transition-colors hover:bg-border/50 hover:text-text-primary"
                title={expanded ? "Collapse" : "Show answers"}
                onClick={onToggle}
              >
                <ChevronDown className={cn("h-4 w-4 transition-transform", expanded && "rotate-180")} />
              </button>
            </>
          )}
        </div>
      </div>

      {/* Expanded: options + explanation */}
      {expanded && (
        <div className="space-y-3 pb-4 pl-5 pr-4">
          {q.options.length > 0 && (
            <div className="grid gap-2 sm:grid-cols-2">
              {q.options.map((opt, i) => {
                const correct = opt === q.correctAnswer;
                return (
                  <div
                    key={i}
                    className={cn(
                      "flex items-start gap-2.5 rounded-lg border px-3 py-2 text-sm",
                      correct
                        ? "border-success/40 bg-success/10 text-text-primary"
                        : "border-border bg-surface text-text-secondary",
                    )}
                  >
                    <span
                      className={cn(
                        "flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[11px] font-bold",
                        correct ? "bg-success text-white" : "bg-border/70 text-text-secondary",
                      )}
                    >
                      {correct ? <Check className="h-3 w-3" /> : String.fromCharCode(65 + i)}
                    </span>
                    <span className="min-w-0 flex-1">
                      <MathText text={opt} />
                    </span>
                  </div>
                );
              })}
            </div>
          )}
          {!q.options.includes(q.correctAnswer) && (
            <p className="text-sm">
              <span className="font-medium text-text-secondary">Answer: </span>
              <span className="text-success">
                <MathText text={q.correctAnswer} />
              </span>
            </p>
          )}
          {q.explanation && (
            <div className="rounded-lg border border-border bg-surface px-3 py-2.5 text-sm text-text-secondary">
              <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-text-muted">
                Explanation
              </span>
              <MathText text={q.explanation} />
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Skeletons ────────────────────────────────────────────

const SKELETON_WIDTHS = ["w-11/12", "w-4/5", "w-full", "w-3/4", "w-5/6", "w-2/3"];

export function QuestionListSkeleton({ rows = 8 }: { rows?: number }) {
  return (
    <div className="divide-y divide-border" aria-busy="true" aria-label="Loading questions">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="relative flex items-start gap-3 py-4 pl-5 pr-4">
          <span className="absolute inset-y-0 left-0 w-1 animate-pulse bg-border/60" />
          <div className="min-w-0 flex-1 space-y-2.5">
            <div className="flex gap-2">
              <Skeleton className="h-3 w-24" />
              <Skeleton className="h-3 w-40" />
            </div>
            <Skeleton className={cn("h-4", SKELETON_WIDTHS[i % SKELETON_WIDTHS.length])} />
            {i % 2 === 0 && <Skeleton className="h-4 w-1/2" />}
            <div className="flex gap-2 pt-0.5">
              <Skeleton className="h-5 w-16 rounded-full" />
              <Skeleton className="h-5 w-14 rounded-full" />
              <Skeleton className="h-5 w-24 rounded-full" />
            </div>
          </div>
          <div className="flex shrink-0 gap-1">
            <Skeleton className="h-8 w-8 rounded-lg" />
            <Skeleton className="h-8 w-8 rounded-lg" />
            <Skeleton className="h-8 w-8 rounded-lg" />
          </div>
        </div>
      ))}
    </div>
  );
}

// ─── Pagination ───────────────────────────────────────────

function pageList(page: number, totalPages: number): (number | "…")[] {
  if (totalPages <= 7) return Array.from({ length: totalPages }, (_, i) => i + 1);
  const pages = new Set([1, totalPages, page - 1, page, page + 1]);
  const sorted = [...pages].filter((p) => p >= 1 && p <= totalPages).sort((a, b) => a - b);
  const out: (number | "…")[] = [];
  sorted.forEach((p, i) => {
    if (i > 0 && p - sorted[i - 1] > 1) out.push("…");
    out.push(p);
  });
  return out;
}

export function Pagination({
  page,
  totalPages,
  total,
  pageSize,
  disabled,
  onPage,
}: {
  page: number;
  totalPages: number;
  total: number;
  pageSize: number;
  disabled?: boolean;
  onPage: (p: number) => void;
}) {
  const from = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const to = Math.min(total, page * pageSize);

  return (
    <div className="flex flex-col items-center justify-between gap-3 border-t border-border px-4 py-3 sm:flex-row">
      <p className="text-xs text-text-secondary">
        Showing <span className="font-medium tabular-nums text-text-primary">{from}–{to}</span> of{" "}
        <span className="font-medium tabular-nums text-text-primary">{total.toLocaleString()}</span>
      </p>
      {totalPages > 1 && (
        <div className="flex items-center gap-1">
          <button
            type="button"
            className="rounded-lg p-1.5 text-text-secondary transition-colors hover:bg-border/50 disabled:opacity-40"
            disabled={page <= 1 || disabled}
            onClick={() => onPage(page - 1)}
            aria-label="Previous page"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          {pageList(page, totalPages).map((p, i) =>
            p === "…" ? (
              <span key={`e${i}`} className="px-1 text-xs text-text-muted">
                …
              </span>
            ) : (
              <button
                key={p}
                type="button"
                disabled={disabled}
                onClick={() => onPage(p)}
                className={cn(
                  "min-w-8 rounded-lg px-2 py-1 text-xs font-medium tabular-nums transition-colors",
                  p === page
                    ? "bg-primary text-white"
                    : "text-text-secondary hover:bg-border/50 hover:text-text-primary",
                )}
              >
                {p}
              </button>
            ),
          )}
          <button
            type="button"
            className="rounded-lg p-1.5 text-text-secondary transition-colors hover:bg-border/50 disabled:opacity-40"
            disabled={page >= totalPages || disabled}
            onClick={() => onPage(page + 1)}
            aria-label="Next page"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>
      )}
    </div>
  );
}
