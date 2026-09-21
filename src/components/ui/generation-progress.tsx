"use client";

import { Sparkles } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";

/**
 * Live progress for a long AI generation.
 *
 * The stages are the real ones the pipeline runs, and every percentage comes
 * from the server as it passes one — this never animates progress that has
 * not happened. That is the whole point of it over a spinner: a spinner says
 * "wait", this says what is being waited on.
 *
 * Defaults describe the question pipeline, which is where it started. Pass
 * `stages` and `footnote` for a different one.
 */

export interface GenerationProgressState {
  message: string;
  percent: number;
}

export interface ProgressStage {
  /** Percent at which this stage is considered reached. */
  at: number;
  label: string;
}

const QUESTION_STAGES: ProgressStage[] = [
  { at: 10, label: "1. Curriculum" },
  { at: 35, label: "2. Draft Questions" },
  { at: 75, label: "3. AI Solver Check" },
  { at: 90, label: "4. Finalize" },
];

const QUESTION_FOOTNOTE =
  "Every question is cross-checked blind by a secondary AI solver before serving.";

export function GenerationProgressCard({
  progress,
  className,
  stages = QUESTION_STAGES,
  footnote = QUESTION_FOOTNOTE,
  idleMessage = "Drafting questions with AI...",
}: {
  progress: GenerationProgressState | null;
  className?: string;
  stages?: ProgressStage[];
  footnote?: string;
  idleMessage?: string;
}) {
  const percent = progress?.percent ?? stages[0]?.at ?? 5;

  return (
    <Card
      className={cn(
        "overflow-hidden border-primary/30 bg-gradient-to-br from-primary/5 via-purple-500/5 to-transparent shadow-md",
        className,
      )}
    >
      <CardContent className="space-y-4 py-5">
        <div className="flex items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-2">
            <Sparkles className="h-5 w-5 shrink-0 animate-spin text-primary" />
            <span className="truncate text-sm font-semibold text-text-primary">
              {progress?.message || idleMessage}
            </span>
          </div>
          <span className="shrink-0 text-sm font-bold text-primary">{percent}%</span>
        </div>

        <div className="h-2 w-full overflow-hidden rounded-full bg-primary/10">
          <div
            className="h-full bg-primary transition-all duration-500 ease-out"
            style={{ width: `${percent}%` }}
          />
        </div>

        <div
          className="grid gap-1.5 text-center text-[10px] text-text-secondary"
          style={{ gridTemplateColumns: `repeat(${stages.length}, minmax(0, 1fr))` }}
        >
          {stages.map((stage) => (
            <div
              key={stage.at}
              className={cn(
                "rounded border px-1 py-1 transition-colors",
                percent >= stage.at
                  ? "border-primary/30 bg-primary/10 font-semibold text-primary"
                  : "border-transparent opacity-40",
              )}
            >
              {stage.label}
            </div>
          ))}
        </div>

        {footnote && (
          <p className="text-center text-[11px] text-text-secondary">{footnote}</p>
        )}
      </CardContent>
    </Card>
  );
}
