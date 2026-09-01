"use client";

import { useEffect, useRef, useState } from "react";
import { Sparkles, Check, Wand2 } from "lucide-react";

const PROMPT = "5 questions on Photosynthesis · Grade 9 Biology";
const QUESTION = "Which pigment captures light energy during photosynthesis?";
const OPTIONS = ["Chlorophyll", "Hemoglobin", "Melanin", "Keratin"];
const CORRECT = 0;
const EXPLANATION =
  "Chlorophyll absorbs mainly red and blue light to power the light-dependent reactions.";

type Phase = "typing" | "generating" | "reveal" | "done";

/**
 * A self-contained, looping showcase of EthioLearn's AI quiz generator:
 * a prompt is typed, the AI "generates", and a graded question is revealed.
 * Purely decorative — respects prefers-reduced-motion.
 */
export function AiQuizDemo() {
  const [typed, setTyped] = useState("");
  const [phase, setPhase] = useState<Phase>("typing");
  const timers = useRef<number[]>([]);

  useEffect(() => {
    const reduce =
      typeof window !== "undefined" &&
      window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    if (reduce) {
      setTyped(PROMPT);
      setPhase("done");
      return;
    }

    let cancelled = false;
    const wait = (ms: number) =>
      new Promise<void>((res) => {
        const id = window.setTimeout(res, ms);
        timers.current.push(id);
      });

    async function run() {
      while (!cancelled) {
        setPhase("typing");
        setTyped("");
        for (let i = 1; i <= PROMPT.length && !cancelled; i++) {
          setTyped(PROMPT.slice(0, i));
          await wait(26);
        }
        if (cancelled) return;
        await wait(480);
        setPhase("generating");
        await wait(1350);
        if (cancelled) return;
        setPhase("reveal");
        await wait(1500);
        if (cancelled) return;
        setPhase("done");
        await wait(3800);
      }
    }
    run();

    return () => {
      cancelled = true;
      timers.current.forEach((id) => clearTimeout(id));
      timers.current = [];
    };
  }, []);

  const showQuestion = phase === "reveal" || phase === "done";

  return (
    <div className="lp-ring w-full max-w-md rounded-2xl border border-white/10 bg-[#0b1310] p-3 shadow-2xl">
      {/* Window chrome */}
      <div className="flex items-center gap-2 px-1.5 pb-3">
        <span className="h-2.5 w-2.5 rounded-full bg-[#ff5f57]" />
        <span className="h-2.5 w-2.5 rounded-full bg-[#febc2e]" />
        <span className="h-2.5 w-2.5 rounded-full bg-[#28c840]" />
        <div className="ml-2 flex items-center gap-1.5 text-xs font-medium text-white/50">
          <Sparkles className="h-3.5 w-3.5 text-emerald-300" />
          EthioLearn AI · Quiz Generator
        </div>
      </div>

      {/* Prompt bar */}
      <div className="flex items-center gap-2 rounded-xl border border-white/10 bg-black/30 px-3 py-2.5">
        <Wand2 className="h-4 w-4 shrink-0 text-emerald-300" />
        <div className="min-h-5 flex-1 text-sm text-white/90">
          {typed}
          {phase === "typing" && (
            <span className="lp-blink ml-0.5 inline-block h-4 w-[2px] -translate-y-[1px] bg-emerald-300 align-middle" />
          )}
        </div>
        <span
          className={
            "shrink-0 rounded-lg px-2.5 py-1 text-xs font-bold text-white transition-all " +
            (phase === "generating"
              ? "bg-emerald-500/80"
              : "bg-gradient-to-r from-emerald-500 to-green-600 shadow-[0_0_18px_-2px_rgba(16,185,129,0.7)]")
          }
        >
          {phase === "generating" ? "Generating…" : "Generate"}
        </span>
      </div>

      {/* Output */}
      <div className="mt-3 rounded-xl border border-white/10 bg-black/20 p-3">
        {phase === "generating" && (
          <div className="space-y-2.5 py-1">
            {[0, 1, 2].map((i) => (
              <div
                key={i}
                className="relative overflow-hidden rounded-md bg-white/[0.06]"
                style={{ height: 12, width: `${[92, 76, 84][i]}%` }}
              >
                <div className="lp-shimmer-track absolute inset-0" />
              </div>
            ))}
            <div className="flex items-center gap-1.5 pt-1 text-[11px] font-medium text-emerald-300/90">
              <Sparkles className="h-3 w-3" />
              Writing curriculum-aligned questions…
            </div>
          </div>
        )}

        {showQuestion && (
          <div className="lp-pop">
            <div className="mb-2 flex items-center justify-between">
              <span className="rounded-md bg-emerald-400/15 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-emerald-300">
                Question 1 / 5
              </span>
              <span className="text-[10px] font-medium text-white/40">Grade 9 · Biology</span>
            </div>
            <p className="text-sm font-semibold text-white">{QUESTION}</p>
            <div className="mt-2.5 space-y-1.5">
              {OPTIONS.map((opt, i) => {
                const isCorrect = i === CORRECT;
                const graded = phase === "done";
                return (
                  <div
                    key={opt}
                    className={
                      "lp-pop flex items-center gap-2 rounded-lg border px-2.5 py-2 text-xs font-medium transition-colors " +
                      (graded && isCorrect
                        ? "border-emerald-400/50 bg-emerald-400/15 text-emerald-100"
                        : graded
                          ? "border-white/5 bg-white/[0.02] text-white/40"
                          : "border-white/10 bg-white/[0.03] text-white/80")
                    }
                    style={{ animationDelay: `${0.08 * i}s` }}
                  >
                    <span
                      className={
                        "flex h-4 w-4 shrink-0 items-center justify-center rounded-full border text-[9px] font-bold " +
                        (graded && isCorrect
                          ? "border-emerald-400 bg-emerald-400 text-black"
                          : "border-white/30 text-white/60")
                      }
                    >
                      {graded && isCorrect ? <Check className="h-3 w-3" /> : String.fromCharCode(65 + i)}
                    </span>
                    {opt}
                  </div>
                );
              })}
            </div>

            {phase === "done" && (
              <div className="lp-fade-up mt-2.5 flex items-start gap-1.5 rounded-lg border border-emerald-400/20 bg-emerald-400/[0.07] px-2.5 py-2 text-[11px] leading-snug text-emerald-100/90">
                <Sparkles className="mt-0.5 h-3 w-3 shrink-0 text-emerald-300" />
                <span>
                  <span className="font-semibold">AI explanation · </span>
                  {EXPLANATION}
                </span>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
