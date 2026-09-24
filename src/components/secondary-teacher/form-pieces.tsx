"use client";

import { Check, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Building blocks shared by the teachers' creation dialogs ("Set an activity",
 * "Give to a class"), so both look and behave the same.
 */

/** A big, tappable choice with an icon — for decisions that matter. */
export function OptionCard({
  selected,
  onSelect,
  icon: Icon,
  label,
  hint,
  tag,
  prompting,
  tone = "primary",
}: {
  selected: boolean;
  onSelect: () => void;
  icon: LucideIcon;
  label: string;
  hint: string;
  tag?: string;
  /** Nothing chosen yet and a choice is required: outline to invite one. */
  prompting?: boolean;
  tone?: "primary" | "amber";
}) {
  const amber = tone === "amber";
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      className={cn(
        "relative flex items-start gap-3 rounded-2xl border-2 p-4 text-left transition",
        selected
          ? amber
            ? "border-amber-500 bg-amber-50 shadow-sm"
            : "border-primary bg-primary/[0.06] shadow-sm"
          : prompting
            ? "border-dashed border-primary/40 hover:border-primary hover:bg-primary/[0.03]"
            : "border-border hover:border-primary/40 hover:bg-border/20",
      )}
    >
      <span
        className={cn(
          "flex h-10 w-10 shrink-0 items-center justify-center rounded-xl transition",
          selected
            ? amber
              ? "bg-amber-500 text-white"
              : "bg-primary text-white"
            : "bg-border/50 text-text-secondary",
        )}
      >
        <Icon className="h-5 w-5" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-bold text-text-primary">{label}</span>
          {tag && (
            <span className="rounded-full bg-border/60 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-text-secondary">
              {tag}
            </span>
          )}
        </span>
        <span className="mt-0.5 block text-xs leading-relaxed text-text-muted">{hint}</span>
      </span>
      {selected && (
        <span
          className={cn(
            "absolute right-3 top-3 flex h-5 w-5 items-center justify-center rounded-full text-white",
            amber ? "bg-amber-500" : "bg-primary",
          )}
        >
          <Check className="h-3 w-3" />
        </span>
      )}
    </button>
  );
}

/** A row of mutually exclusive pills — quicker than a dropdown for a few values. */
export function Segmented({
  options,
  value,
  onChange,
}: {
  options: { value: string; label: string; dot?: string }[];
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div className="flex flex-wrap gap-1 rounded-2xl bg-border/40 p-1">
      {options.map((o) => {
        const on = o.value === value;
        return (
          <button
            key={o.value || "_"}
            type="button"
            aria-pressed={on}
            onClick={() => onChange(o.value)}
            className={cn(
              "inline-flex flex-1 items-center justify-center gap-1.5 whitespace-nowrap rounded-xl px-3 py-2 text-sm font-semibold transition",
              on ? "bg-surface text-text-primary shadow-sm" : "text-text-secondary hover:text-text-primary",
            )}
          >
            {o.dot && <span className={cn("h-2 w-2 rounded-full", o.dot)} />}
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

export function ReviewRow({
  icon: Icon,
  label,
  children,
  onEdit,
}: {
  icon: LucideIcon;
  label: string;
  children: React.ReactNode;
  onEdit?: () => void;
}) {
  return (
    <div className="flex min-w-0 items-start gap-2.5">
      <Icon className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
      <div className="min-w-0 flex-1">
        <dt className="text-xs text-text-muted">{label}</dt>
        <dd className="truncate font-semibold text-text-primary">{children}</dd>
      </div>
      {onEdit && (
        <button type="button" onClick={onEdit} className="shrink-0 text-xs font-semibold text-primary hover:underline">
          Edit
        </button>
      )}
    </div>
  );
}
