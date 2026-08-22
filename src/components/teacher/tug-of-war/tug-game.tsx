"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { Maximize2, Minimize2, X, RotateCcw, Delete, Check, Trophy } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  correctValue,
  drawFromDeck,
  finishByPosition,
  initialTugState,
  makeMathQuestion,
  registerPull,
  type TugMatch,
  type TugQuestion,
  type TugState,
  type Team,
} from "@/lib/games/tug-of-war";
import { TugScene } from "./tug-scene";

interface TugGameProps {
  match: TugMatch;
  onExit: () => void;
}

/** brief per-side feedback flash. */
type Flash = "correct" | "wrong" | null;

const KEYS = ["7", "8", "9", "4", "5", "6", "1", "2", "3"];

function mmss(total: number): string {
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

/**
 * Tug of War — real-time, single-screen match. Both teams play at once, each on
 * their half of the screen with their own question and answer pad. Answering
 * pulls the rope and loads the next question automatically (no turns, no manual
 * advance). The rope reflects the running difference in correct answers.
 */
export function TugGame({ match, onExit }: TugGameProps) {
  const t = useTranslations("games");
  const { config, mode, band, deck } = match;
  const wrapRef = useRef<HTMLDivElement>(null);

  // Draw a question, avoiding `avoid` so the two teams never show the same
  // question at the same moment (both teams pull from one shared pool).
  const draw = useCallback(
    (avoid?: TugQuestion): TugQuestion => {
      const clashes = (q: TugQuestion) => !!avoid && q.text === avoid.text;
      if (band) {
        let q = makeMathQuestion(band);
        for (let i = 0; i < 8 && clashes(q); i++) q = makeMathQuestion(band);
        return q;
      }
      if (deck!.length <= 1) return deck![0];
      let q = drawFromDeck(deck!);
      for (let i = 0; i < 12 && clashes(q); i++) q = drawFromDeck(deck!);
      return q;
    },
    [band, deck],
  );

  const [state, setState] = useState<TugState>(initialTugState);
  const [q, setQ] = useState<Record<Team, TugQuestion>>(() => {
    const first = draw();
    return { 1: first, 2: draw(first) };
  });
  const [input, setInput] = useState<Record<Team, string>>({ 1: "", 2: "" });
  const [flash, setFlash] = useState<Record<Team, Flash>>({ 1: null, 2: null });
  const [pulling, setPulling] = useState<Team | null>(null);
  const [superFlash, setSuperFlash] = useState<Team | null>(null);
  const [secondsLeft, setSecondsLeft] = useState(config.matchSeconds);
  const [isFull, setIsFull] = useState(false);

  const over = state.winner !== null;
  const flashTimers = useRef<Record<Team, ReturnType<typeof setTimeout> | null>>({ 1: null, 2: null });
  const pullTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const superTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const teamName = (team: Team) => (team === 1 ? config.team1Name : config.team2Name);

  // ── Answer resolution (shared by keypad + options) ────────────────────
  const answer = useCallback(
    (team: Team, correct: boolean) => {
      if (state.winner !== null) return;
      const { state: nextState, superPull } = registerPull(state, team, correct, config.target);
      setState(nextState);

      // lean toward the pulling side (only correct answers move the rope)
      if (correct) {
        setPulling(team);
        if (pullTimer.current) clearTimeout(pullTimer.current);
        pullTimer.current = setTimeout(() => setPulling(null), 450);
      }
      if (superPull) {
        setSuperFlash(team);
        if (superTimer.current) clearTimeout(superTimer.current);
        superTimer.current = setTimeout(() => setSuperFlash(null), 700);
      }

      // per-side flash
      setFlash((f) => ({ ...f, [team]: correct ? "correct" : "wrong" }));
      if (flashTimers.current[team]) clearTimeout(flashTimers.current[team]!);
      flashTimers.current[team] = setTimeout(
        () => setFlash((f) => ({ ...f, [team]: null })),
        450,
      );

      // auto-advance this team to a fresh question that isn't the one the
      // other team is currently showing.
      setQ((prev) => ({ ...prev, [team]: draw(prev[team === 1 ? 2 : 1]) }));
      setInput((prev) => ({ ...prev, [team]: "" }));
    },
    [state, config.target, draw],
  );

  const submitKeypad = (team: Team) => {
    const val = input[team].trim();
    if (val === "") return;
    answer(team, Number(val) === Number(correctValue(q[team])));
  };

  const pressKey = (team: Team, key: string) => {
    if (over) return;
    if (key === "back") {
      setInput((p) => ({ ...p, [team]: p[team].slice(0, -1) }));
    } else if (key === "ok") {
      submitKeypad(team);
    } else {
      setInput((p) => ({ ...p, [team]: (p[team] + key).slice(0, 5) }));
    }
  };

  const pickOption = (team: Team, idx: number) => {
    if (over) return;
    answer(team, idx === q[team].correctIndex);
  };

  // ── Match clock ───────────────────────────────────────────────────────
  useEffect(() => {
    if (config.matchSeconds <= 0 || over) return;
    const started = Date.now();
    const id = setInterval(() => {
      const left = config.matchSeconds - Math.floor((Date.now() - started) / 1000);
      if (left <= 0) {
        clearInterval(id);
        setSecondsLeft(0);
        setState((s) => finishByPosition(s));
      } else {
        setSecondsLeft(left);
      }
    }, 250);
    return () => clearInterval(id);
  }, [config.matchSeconds, over]);

  useEffect(() => () => {
    // cleanup timers on unmount
    Object.values(flashTimers.current).forEach((x) => x && clearTimeout(x));
    if (pullTimer.current) clearTimeout(pullTimer.current);
    if (superTimer.current) clearTimeout(superTimer.current);
  }, []);

  const restart = () => {
    setState(initialTugState());
    const first = draw();
    setQ({ 1: first, 2: draw(first) });
    setInput({ 1: "", 2: "" });
    setFlash({ 1: null, 2: null });
    setSecondsLeft(config.matchSeconds);
    setPulling(null);
    setSuperFlash(null);
  };

  const toggleFull = () => {
    const el = wrapRef.current;
    if (!el) return;
    if (!document.fullscreenElement) el.requestFullscreen?.().catch(() => {});
    else document.exitFullscreen?.().catch(() => {});
  };
  useEffect(() => {
    const onChange = () => setIsFull(!!document.fullscreenElement);
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, []);

  let winText = "";
  if (over) {
    if (state.winner === 0) winText = t("mtDraw");
    else if (state.endReason === "knockout") winText = t("mtKnockout", { team: teamName(state.winner as Team) });
    else winText = t("mtTimeUp", { team: teamName(state.winner as Team) });
  }

  return (
    <div
      ref={wrapRef}
      className="flex h-full flex-col overflow-hidden rounded-2xl bg-surface"
    >
      {/* top bar */}
      <div className="flex items-center justify-between gap-2 bg-surface px-4 py-2">
        <button
          onClick={onExit}
          className="inline-flex items-center gap-1.5 rounded-full border border-border bg-surface px-4 py-2 text-sm font-semibold text-text-primary hover:bg-border"
        >
          <X className="h-4 w-4" /> {t("exit")}
        </button>
        {config.matchSeconds > 0 && (
          <span
            className={cn(
              "rounded-full px-4 py-1 text-lg font-extrabold tabular-nums",
              secondsLeft <= 10 ? "bg-accent/15 text-accent" : "bg-border text-text-primary",
            )}
          >
            {mmss(secondsLeft)}
          </span>
        )}
        <button
          onClick={toggleFull}
          className="inline-flex items-center gap-1.5 rounded-full border border-border bg-surface px-4 py-2 text-sm font-semibold text-text-primary hover:bg-border"
        >
          {isFull ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
          {isFull ? t("minimize") : t("maximize")}
        </button>
      </div>

      {/* stage */}
      <div className="relative min-h-0 flex-1 bg-[#e3f4ff]">
        <TugScene
          offset={state.offset}
          target={config.target}
          team1Name={config.team1Name}
          team2Name={config.team2Name}
          pullingTeam={pulling}
          superPull={superFlash !== null}
          winner={over ? (state.winner as 1 | 2 | 0) : null}
        />

        {over && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-5 bg-black/50 p-4 backdrop-blur-sm">
            <div className="flex w-full max-w-sm flex-col items-center gap-4 rounded-3xl bg-surface p-8 text-center shadow-2xl">
              <div className="flex h-16 w-16 items-center justify-center rounded-full bg-secondary-dark text-white shadow-md">
                <Trophy className="h-8 w-8" />
              </div>
              <div className="text-2xl font-extrabold text-text-primary sm:text-3xl">{winText}</div>
              <div className="flex w-full items-center justify-center gap-3">
                <span className="flex-1 rounded-2xl bg-accent/10 py-2 text-base font-bold text-accent">
                  {config.team1Name} · {state.correct[1]}
                </span>
                <span className="flex-1 rounded-2xl bg-info/10 py-2 text-base font-bold text-info">
                  {config.team2Name} · {state.correct[2]}
                </span>
              </div>
              <div className="mt-1 flex w-full flex-col gap-2.5">
                <button
                  onClick={restart}
                  className="inline-flex w-full items-center justify-center gap-2 rounded-2xl bg-primary px-6 py-3.5 text-base font-bold text-white shadow-sm hover:bg-primary-dark"
                >
                  <RotateCcw className="h-5 w-5" /> {t("playAgain")}
                </button>
                <button
                  onClick={onExit}
                  className="inline-flex w-full items-center justify-center gap-2 rounded-2xl border border-border bg-background px-6 py-3.5 text-base font-bold text-text-primary hover:bg-border"
                >
                  <X className="h-5 w-5" /> {t("exit")}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* dual answer panels */}
      {!over && (
        <div className="grid shrink-0 grid-cols-2 gap-px bg-border">
          <TeamPanel
            side={1}
            name={config.team1Name}
            question={q[1].text}
            options={q[1].options}
            input={input[1]}
            flash={flash[1]}
            superFlash={superFlash === 1}
            streak={state.streak[1]}
            mode={mode}
            onKey={(k) => pressKey(1, k)}
            onPick={(i) => pickOption(1, i)}
            t={t}
          />
          <TeamPanel
            side={2}
            name={config.team2Name}
            question={q[2].text}
            options={q[2].options}
            input={input[2]}
            flash={flash[2]}
            superFlash={superFlash === 2}
            streak={state.streak[2]}
            mode={mode}
            onKey={(k) => pressKey(2, k)}
            onPick={(i) => pickOption(2, i)}
            t={t}
          />
        </div>
      )}
    </div>
  );
}

// ─── One team's half: question + keypad or option buttons ─────────────────

function TeamPanel({
  side,
  name,
  question,
  options,
  input,
  flash,
  superFlash,
  streak,
  mode,
  onKey,
  onPick,
  t,
}: {
  side: Team;
  name: string;
  question: string;
  options: string[];
  input: string;
  flash: Flash;
  superFlash: boolean;
  streak: number;
  mode: TugMatch["mode"];
  onKey: (key: string) => void;
  onPick: (idx: number) => void;
  t: ReturnType<typeof useTranslations>;
}) {
  const tint = side === 1 ? "bg-accent/10" : "bg-info/10";
  const accent = side === 1 ? "text-accent" : "text-info";
  const header = side === 1 ? "bg-accent" : "bg-info";

  return (
    <div
      className={cn(
        "relative flex flex-col gap-2 p-3 transition-colors sm:p-4",
        tint,
        flash === "correct" && "bg-success/15",
        flash === "wrong" && "bg-accent/15",
      )}
    >
      {/* header: name + streak */}
      <div className="flex items-center justify-between">
        <span className={cn("rounded-lg px-3 py-1 text-sm font-bold text-white", header)}>{name}</span>
        <div className="flex items-center gap-2">
          {streak >= 2 && (
            <span className="rounded-full bg-secondary/20 px-2.5 py-0.5 text-xs font-bold text-secondary-dark">
              🔥 {t("mtStreak", { n: streak })}
            </span>
          )}
          {superFlash && (
            <span className="animate-pulse rounded-full bg-secondary px-2.5 py-0.5 text-xs font-extrabold text-white">
              {t("mtSuper")}
            </span>
          )}
        </div>
      </div>

      {/* question */}
      <p className="text-center text-2xl font-extrabold text-text-primary sm:text-3xl">{question}</p>

      {mode === "keypad" ? (
        <>
          {/* input display */}
          <div
            className={cn(
              "mx-auto flex h-11 w-40 items-center justify-center rounded-lg border-2 bg-surface text-2xl font-bold tabular-nums",
              flash === "wrong" ? "border-accent text-accent" : "border-border text-text-primary",
            )}
          >
            {input || <span className="text-text-muted">·</span>}
          </div>
          {/* keypad */}
          <div className="mx-auto grid w-full max-w-[15rem] grid-cols-3 gap-1.5">
            {KEYS.map((k) => (
              <KeyBtn key={k} onClick={() => onKey(k)}>{k}</KeyBtn>
            ))}
            <KeyBtn onClick={() => onKey("back")} className="text-text-secondary">
              <Delete className="h-5 w-5" />
            </KeyBtn>
            <KeyBtn onClick={() => onKey("0")}>0</KeyBtn>
            <KeyBtn
              onClick={() => onKey("ok")}
              className={cn("text-white", side === 1 ? "!bg-accent hover:!bg-accent" : "!bg-info hover:!bg-info")}
            >
              <Check className="h-6 w-6" />
            </KeyBtn>
          </div>
        </>
      ) : (
        <div className="mx-auto grid w-full max-w-md flex-1 grid-cols-2 gap-2">
          {options.map((opt, i) => (
            <button
              key={i}
              onClick={() => onPick(i)}
              className={cn(
                "flex items-center justify-center rounded-xl border-2 border-border bg-surface px-3 py-3 text-lg font-bold text-text-primary shadow-sm transition active:scale-95",
                accent,
                "hover:border-border",
              )}
            >
              {opt}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function KeyBtn({
  children,
  onClick,
  className,
}: {
  children: React.ReactNode;
  onClick: () => void;
  className?: string;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "flex h-12 items-center justify-center rounded-lg bg-surface text-xl font-bold text-text-primary shadow-sm transition active:scale-90 hover:bg-background",
        className,
      )}
    >
      {children}
    </button>
  );
}
