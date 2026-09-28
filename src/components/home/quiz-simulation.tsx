"use client";

import { useEffect, useRef, useState } from "react";
import {
  BookOpen,
  Check,
  CheckCircle2,
  Loader2,
  MousePointer2,
  Sparkles,
  Zap,
} from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Animated walkthrough of how a practice quiz is made, for the landing page.
 * The four scenes follow the real pipeline: read the chapter, write the
 * question, check it (answer, repeat check against the bank, difficulty),
 * then a student answers it. Sample content stays English — the medium of
 * instruction — while the step titles come in translated.
 *
 * Auto-advances only while on screen, and not at all under reduced motion:
 * then every scene renders in its finished state and the steps are buttons.
 */

export type SimStep = { title: string; desc: string };

type Props = {
  steps: SimStep[]; // exactly four, in scene order
  caption: string;
};

/** How long each scene plays before the next one, in ms. */
const DURATIONS = [4800, 5200, 5200, 5600];

const QUESTION = "Which organelle carries out photosynthesis?";
const OPTIONS = ["Mitochondrion", "Chloroplast", "Ribosome", "Nucleus"];
const CORRECT = 1;

export function QuizSimulation({ steps, caption }: Props) {
  const [step, setStep] = useState(0);
  const [inView, setInView] = useState(false);
  const [reduced, setReduced] = useState(false);
  // Bumped on every (re)start so the active scene and its progress bar replay.
  const [run, setRun] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const sync = () => setReduced(mq.matches);
    sync();
    mq.addEventListener("change", sync);
    return () => mq.removeEventListener("change", sync);
  }, []);

  // Only play while the stage is actually visible.
  useEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    const io = new IntersectionObserver(
      ([entry]) => {
        setInView(entry.isIntersecting);
        if (entry.isIntersecting) setRun((r) => r + 1);
      },
      { threshold: 0.35 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  useEffect(() => {
    if (!inView || reduced) return;
    const id = window.setTimeout(() => {
      setStep((s) => (s + 1) % steps.length);
      setRun((r) => r + 1);
    }, DURATIONS[step]);
    return () => window.clearTimeout(id);
  }, [step, inView, reduced, run, steps.length]);

  const goTo = (i: number) => {
    setStep(i);
    setRun((r) => r + 1);
  };

  const playing = inView && !reduced;
  const sceneKey = `${step}-${run}`;

  return (
    <div ref={rootRef} className="grid gap-8 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)] lg:gap-14">
      {/* ── Steps ── */}
      <ol className="grid grid-cols-4 gap-2 lg:grid-cols-1 lg:gap-3">
        {steps.map((s, i) => {
          const active = i === step;
          return (
            <li key={s.title}>
              <button
                type="button"
                onClick={() => goTo(i)}
                aria-current={active ? "step" : undefined}
                className={cn(
                  "group relative w-full overflow-hidden rounded-2xl border text-left transition-colors",
                  "px-3 py-3 lg:px-5 lg:py-4",
                  active
                    ? "border-[var(--lp-green)] bg-[var(--lp-surface)]"
                    : "border-[var(--lp-rule)] hover:border-[var(--lp-faint)]",
                )}
              >
                <div className="flex items-center gap-3">
                  <span
                    className={cn(
                      "lp-display flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-sm font-semibold transition-colors",
                      active
                        ? "bg-[var(--lp-green)] text-white"
                        : "bg-[var(--lp-sunk)] text-[var(--lp-muted)]",
                    )}
                  >
                    {i + 1}
                  </span>
                  <span
                    className={cn(
                      "hidden text-[15px] font-semibold sm:block",
                      !active && "text-[var(--lp-muted)]",
                    )}
                  >
                    {s.title}
                  </span>
                </div>
                <p
                  className={cn(
                    "mt-2 hidden text-sm leading-relaxed text-[var(--lp-muted)] lg:block",
                    !active && "lg:hidden",
                  )}
                >
                  {s.desc}
                </p>
                {/* Progress for the playing step */}
                {active && playing && (
                  <span
                    key={sceneKey}
                    aria-hidden
                    className="lp-bar absolute inset-x-0 bottom-0 h-0.5 bg-[var(--lp-green)]"
                    style={{ animationDuration: `${DURATIONS[step]}ms` }}
                  />
                )}
              </button>
            </li>
          );
        })}
      </ol>

      {/* ── Stage ── */}
      <div>
        {/* Small screens: the active step's words, since the buttons only show numbers */}
        <div className="mb-4 sm:hidden">
          <p className="font-semibold">{steps[step].title}</p>
          <p className="mt-1 text-sm text-[var(--lp-muted)]">{steps[step].desc}</p>
        </div>

        <div
          className="relative min-h-[460px] overflow-hidden rounded-3xl sm:min-h-[380px] border border-[var(--lp-rule)] bg-[var(--lp-surface)] p-5 shadow-[0_24px_50px_-32px_rgba(19,32,26,0.45)] sm:p-7"
          aria-live="polite"
        >
          <div key={sceneKey}>
            {step === 0 && <ReadScene done={reduced} />}
            {step === 1 && <WriteScene done={reduced} />}
            {step === 2 && <CheckScene done={reduced} />}
            {step === 3 && <PractiseScene done={reduced} />}
          </div>
        </div>
        <p className="mt-3 text-xs text-[var(--lp-faint)]">{caption}</p>
      </div>
    </div>
  );
}

/* ─────────────────────────── Scenes ─────────────────────────── */

type SceneProps = { done: boolean };

/** Small per-scene clock: which timed beats have been reached. */
function useBeats(times: number[], done: boolean): number {
  const [reached, setReached] = useState(done ? times.length : 0);
  useEffect(() => {
    if (done) return;
    const ids = times.map((t, i) => window.setTimeout(() => setReached(i + 1), t));
    return () => ids.forEach((id) => window.clearTimeout(id));
    // `times` is a module constant per scene.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [done]);
  return reached;
}

function SceneLabel({ icon: Icon, children }: { icon: typeof BookOpen; children: React.ReactNode }) {
  return (
    <div className="lp-in flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.1em] text-[var(--lp-faint)]">
      <Icon className="h-3.5 w-3.5" aria-hidden />
      {children}
    </div>
  );
}

/* 1 — Read the chapter */

const READ_BEATS = [2300];

function ReadScene({ done }: SceneProps) {
  const beat = useBeats(READ_BEATS, done);
  return (
    <div>
      <SceneLabel icon={BookOpen}>Biology · Grade 9 · Unit 3 · p. 47</SceneLabel>
      <div className="relative mt-4 overflow-hidden rounded-2xl border border-[var(--lp-rule)] bg-[var(--lp-bg)] p-5">
        {!done && <span aria-hidden className="lp-scan pointer-events-none absolute inset-x-0 h-10" />}
        <h4 className="lp-display text-xl font-semibold">3.2 Photosynthesis</h4>
        <p className="mt-3 text-sm leading-7 text-[var(--lp-muted)]">
          Green plants make their own food using light energy.{" "}
          <span
            className={cn("rounded-sm text-[var(--lp-ink)]", done ? "lp-hl-done" : "lp-hl")}
            style={{ animationDelay: "900ms" }}
          >
            Chloroplasts contain chlorophyll, which absorbs light energy
          </span>{" "}
          and uses it to turn carbon dioxide and water into glucose. Oxygen is
          released as a by-product.
        </p>
        <div className="mt-4 space-y-2" aria-hidden>
          <div className="h-2 w-11/12 rounded-full bg-[var(--lp-sunk)]" />
          <div className="h-2 w-4/5 rounded-full bg-[var(--lp-sunk)]" />
          <div className="h-2 w-2/3 rounded-full bg-[var(--lp-sunk)]" />
        </div>
      </div>
      {beat >= 1 && (
        <div className="lp-in mt-4 inline-flex items-center gap-2 rounded-full bg-[var(--lp-green-soft)] px-3 py-1.5 text-xs font-semibold text-[var(--lp-green-ink)]">
          <Sparkles className="h-3.5 w-3.5" aria-hidden />
          Key idea found: chloroplasts capture light energy
        </div>
      )}
    </div>
  );
}

/* 2 — Write the question */

const TYPE_MS = 38;

function WriteScene({ done }: SceneProps) {
  const [chars, setChars] = useState(done ? QUESTION.length : 0);
  useEffect(() => {
    if (done) return;
    let n = 0;
    let typing: number | undefined;
    const start = window.setTimeout(() => {
      typing = window.setInterval(() => {
        n += 1;
        setChars(n);
        if (n >= QUESTION.length) window.clearInterval(typing);
      }, TYPE_MS);
    }, 500);
    return () => {
      window.clearTimeout(start);
      window.clearInterval(typing);
    };
  }, [done]);

  const typed = chars >= QUESTION.length;

  return (
    <div>
      <SceneLabel icon={Sparkles}>Writing question 4 of 10</SceneLabel>
      <p className="mt-5 min-h-[3.5rem] text-lg font-semibold leading-snug sm:text-xl">
        {QUESTION.slice(0, chars)}
        {!typed && <span aria-hidden className="lp-caret ml-0.5 inline-block h-5 w-0.5 translate-y-1 bg-[var(--lp-green)]" />}
      </p>
      <ul className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-2">
        {typed &&
          OPTIONS.map((o, i) => (
            <li
              key={o}
              className="lp-in flex items-center gap-2.5 rounded-xl border border-[var(--lp-rule)] px-3.5 py-2.5 text-sm"
              style={{ animationDelay: done ? undefined : `${150 + i * 140}ms` }}
            >
              <span className="text-xs font-semibold text-[var(--lp-faint)]">
                {String.fromCharCode(65 + i)}
              </span>
              {o}
            </li>
          ))}
      </ul>
      {typed && (
        <p
          className="lp-in mt-4 text-xs text-[var(--lp-muted)]"
          style={{ animationDelay: done ? undefined : "800ms" }}
        >
          <span className="font-semibold text-[var(--lp-ink)]">Explanation drafted · </span>
          chloroplasts hold chlorophyll, which captures light to make glucose.
        </p>
      )}
    </div>
  );
}

/* 3 — Check it */

const CHECKS = [
  "Answer matches the textbook",
  "Not a repeat of an existing question",
  "Difficulty set: Medium",
  "Explanation checked",
];
const CHECK_BEATS = [300, 900, 1300, 1900, 2300, 2900, 3300, 3900, 4400];
// Beat 2k+1 shows check k spinning, beat 2k+2 ticks it; the ninth adds it to the bank.

function CheckScene({ done }: SceneProps) {
  const beat = useBeats(CHECK_BEATS, done);
  return (
    <div>
      <SceneLabel icon={CheckCircle2}>Quality check</SceneLabel>
      <p className="mt-4 text-sm font-semibold">{QUESTION}</p>
      <ul className="mt-5 space-y-3">
        {CHECKS.map((c, i) => {
          const shown = beat >= i * 2 + 1;
          const ticked = beat >= i * 2 + 2;
          if (!shown) return null;
          return (
            <li key={c} className="lp-in">
              <div className="flex items-center gap-3 text-sm">
                <span className="flex h-6 w-6 shrink-0 items-center justify-center">
                  {ticked ? (
                    <span className="lp-pop flex h-6 w-6 items-center justify-center rounded-full bg-[var(--lp-green)] text-white">
                      <Check className="h-3.5 w-3.5" strokeWidth={3} aria-hidden />
                    </span>
                  ) : (
                    <Loader2 className="h-5 w-5 animate-spin text-[var(--lp-faint)]" aria-hidden />
                  )}
                </span>
                <span className={ticked ? "" : "text-[var(--lp-muted)]"}>{c}</span>
              </div>
              {i === 1 && (
                <div className="ml-9 mt-2 max-w-xs">
                  <div className="flex justify-between text-[11px] text-[var(--lp-faint)]">
                    <span>Closest match in the bank: 41%</span>
                    <span>limit 90%</span>
                  </div>
                  <div className="relative mt-1 h-1.5 rounded-full bg-[var(--lp-sunk)]">
                    <div
                      className={cn("h-full rounded-full bg-[var(--lp-green)]", !done && "lp-grow")}
                      style={{ width: "41%" }}
                    />
                    <span aria-hidden className="absolute top-[-3px] h-3 w-px bg-[var(--lp-ink)]" style={{ left: "90%" }} />
                  </div>
                </div>
              )}
            </li>
          );
        })}
      </ul>
      {beat >= CHECK_BEATS.length && (
        <div className="lp-pop mt-6 inline-flex items-center gap-2 rounded-full bg-[var(--lp-yellow)] px-3.5 py-1.5 text-xs font-bold text-[#13201a]">
          <Check className="h-3.5 w-3.5" strokeWidth={3} aria-hidden />
          Added to the question bank
        </div>
      )}
    </div>
  );
}

/* 4 — A student practises */

const PRACTISE_BEATS = [1500, 2000, 2600];

function PractiseScene({ done }: SceneProps) {
  const beat = useBeats(PRACTISE_BEATS, done);
  const picked = beat >= 1;
  return (
    <div className="relative">
      <div className="flex items-center justify-between">
        <SceneLabel icon={Zap}>Hana · practice quiz</SceneLabel>
        <span className="lp-in text-xs font-semibold tabular-nums text-[var(--lp-muted)]">4 / 10</span>
      </div>
      <p className="mt-4 text-lg font-semibold leading-snug">{QUESTION}</p>
      <ul className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-2">
        {OPTIONS.map((o, i) => {
          const isRight = picked && i === CORRECT;
          return (
            <li
              key={o}
              className={cn(
                "relative flex items-center gap-2.5 rounded-xl border px-3.5 py-2.5 text-sm transition-colors duration-300",
                isRight
                  ? "border-[var(--lp-green)] bg-[var(--lp-green-soft)] font-semibold text-[var(--lp-green-ink)]"
                  : "border-[var(--lp-rule)]",
                picked && i !== CORRECT && "opacity-60",
              )}
            >
              <span className="text-xs font-semibold opacity-70">{String.fromCharCode(65 + i)}</span>
              <span className="flex-1">{o}</span>
              {isRight && <Check className="lp-pop h-4 w-4" aria-hidden />}
              {i === CORRECT && !done && (
                <MousePointer2
                  aria-hidden
                  className="lp-cursor pointer-events-none absolute right-6 top-5 h-5 w-5 fill-[var(--lp-ink)] text-[var(--lp-surface)]"
                />
              )}
              {isRight && beat >= 2 && (
                <span className="lp-xp absolute -top-3 right-2 rounded-full bg-[var(--lp-yellow)] px-2 py-0.5 text-[11px] font-bold text-[#13201a]">
                  +10 XP
                </span>
              )}
            </li>
          );
        })}
      </ul>
      {beat >= 3 && (
        <div className="lp-in mt-4 rounded-xl border border-dashed border-[var(--lp-rule)] p-3.5 text-sm leading-relaxed text-[var(--lp-muted)]">
          <span className="font-semibold text-[var(--lp-green-ink)]">Correct! </span>
          Chloroplasts hold chlorophyll, which captures light energy to make glucose.
        </div>
      )}
    </div>
  );
}
