"use client";

import { useTranslations } from "next-intl";
import { Check } from "lucide-react";

/**
 * The daily challenge's subject choice: one chip per subject of the student's
 * grade, any number selected. The challenge rotates among the selected ones
 * (none selected = any subject), so a natural-science student can pick
 * Physics, Chemistry, Biology and Maths and never get History.
 */
export function ChallengeSubjects({
  subjects,
  chosen,
  saving,
  onChange,
}: {
  subjects: string[];
  chosen: string[];
  saving: boolean;
  onChange: (next: string[]) => void;
}) {
  const t = useTranslations("student");
  if (subjects.length < 2) return null;
  const toggle = (s: string) => onChange(chosen.includes(s) ? chosen.filter((x) => x !== s) : [...chosen, s]);

  return (
    <div className="mt-3" data-testid="challenge-subjects">
      <p className="text-sm font-medium text-text-primary">{t("challengeSubjectsLabel")}</p>
      <p className="text-xs text-text-secondary">
        {chosen.length === 0 ? t("challengeSubjectsHint") : t("challengeSubjectsChosen")}
      </p>
      <div className="mt-2 flex flex-wrap gap-2">
        {subjects.map((s) => {
          const on = chosen.includes(s);
          return (
            <button
              key={s}
              type="button"
              onClick={() => toggle(s)}
              disabled={saving}
              aria-pressed={on}
              className={
                "inline-flex items-center gap-1 rounded-full border px-3 py-1 text-sm transition-colors disabled:opacity-60 " +
                (on
                  ? "border-green-600 bg-green-600 text-white"
                  : "border-border bg-surface text-text-secondary hover:border-green-600 hover:text-text-primary")
              }
            >
              {on && <Check className="h-3.5 w-3.5" />}
              {s}
            </button>
          );
        })}
      </div>
    </div>
  );
}
