"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import {
  ArrowUp,
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  Play,
  Trash2,
  Home,
  RotateCcw,
  Bot,
  ChevronRight,
  Maximize2,
  Minimize2,
  Trophy,
  Clock,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useSound, useBackgroundMusic } from "@/hooks/use-sound";

/**
 * Routing Algorithm — a single-screen logic game (grades 1–6).
 *
 * Queue a sequence of direction moves (↑ ↓ ← →) to drive the mover to its goal
 * on a 4×4 grid, then press Launch to run the program. Reaching the goal scores
 * a point and spawns a new puzzle; the shortest-path hint teaches efficiency.
 * Play solo (with a best-score record) or two players side-by-side racing one
 * clock. All local state — no backend, no student logins.
 */

type Dir = "up" | "down" | "left" | "right";
const N = 4;
const RECORD_KEY = "ethiolearn.routing.record";

const CHARACTERS = [
  { key: "robot", mover: "🤖", goal: "⭐" },
  { key: "rabbit", mover: "🐰", goal: "🥕" },
  { key: "wolf", mover: "🐺", goal: "🐇" },
  { key: "cat", mover: "🐱", goal: "🐭" },
] as const;
const TIMES = [1, 3, 5, 10] as const;

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const rc = (i: number) => ({ r: Math.floor(i / N), c: i % N });
const manhattan = (a: number, b: number) => {
  const x = rc(a), y = rc(b);
  return Math.abs(x.r - y.r) + Math.abs(x.c - y.c);
};
function step(i: number, dir: Dir): number {
  let { r, c } = rc(i);
  if (dir === "up") r = Math.max(0, r - 1);
  if (dir === "down") r = Math.min(N - 1, r + 1);
  if (dir === "left") c = Math.max(0, c - 1);
  if (dir === "right") c = Math.min(N - 1, c + 1);
  return r * N + c;
}
function newPuzzle(): { start: number; goal: number } {
  const start = Math.floor(Math.random() * N * N);
  let goal = start;
  while (goal === start) goal = Math.floor(Math.random() * N * N);
  return { start, goal };
}

const ARROW: Record<Dir, typeof ArrowUp> = { up: ArrowUp, down: ArrowDown, left: ArrowLeft, right: ArrowRight };

// ─── One player's board ───────────────────────────────────────

function RoutingBoard({
  accent,
  mover,
  goal,
  disabled,
  onSolve,
  t,
}: {
  accent: "blue" | "red";
  mover: string;
  goal: string;
  disabled: boolean;
  onSolve: () => void;
  t: ReturnType<typeof useTranslations>;
}) {
  const { playSfx } = useSound();
  const [puzzle, setPuzzle] = useState(newPuzzle);
  const [robot, setRobot] = useState(puzzle.start);
  const [moves, setMoves] = useState<Dir[]>([]);
  const [animating, setAnimating] = useState(false);
  const [flash, setFlash] = useState<"win" | "fail" | null>(null);

  const reset = (p: { start: number; goal: number }) => {
    setPuzzle(p);
    setRobot(p.start);
    setMoves([]);
  };

  const addMove = (dir: Dir) => {
    if (disabled || animating || moves.length >= 24) return;
    playSfx("click");
    setMoves((m) => [...m, dir]);
  };
  const clean = () => {
    if (animating) return;
    setMoves([]);
    setRobot(puzzle.start);
    setFlash(null);
  };
  const launch = async () => {
    if (disabled || animating || moves.length === 0) return;
    setAnimating(true);
    setFlash(null);
    let pos = puzzle.start;
    setRobot(pos);
    for (const dir of moves) {
      pos = step(pos, dir);
      setRobot(pos);
      await sleep(260);
      if (pos === puzzle.goal) {
        setFlash("win");
        playSfx("correct");
        onSolve();
        await sleep(450);
        setFlash(null);
        reset(newPuzzle());
        setAnimating(false);
        return;
      }
    }
    setFlash("fail");
    playSfx("wrong");
    await sleep(500);
    setFlash(null);
    setRobot(puzzle.start);
    setMoves([]);
    setAnimating(false);
  };

  const tint = accent === "blue" ? "bg-info/10" : "bg-error/10";
  const robotCell = accent === "blue" ? "bg-info/15 ring-info/60" : "bg-error/15 ring-error/60";
  const shortest = manhattan(puzzle.start, puzzle.goal);

  return (
    <div className={cn("flex h-full min-h-0 flex-col items-center gap-2 rounded-2xl p-3", tint)}>
      {/* grid — a square that fills exactly the space left above the controls,
          so the pad and buttons are always visible; the squares stay as large
          as that space allows (container-query height drives the width). */}
      <div className="flex min-h-0 w-full flex-1 items-center justify-center" style={{ containerType: "size" }}>
        <div
          className="grid aspect-square gap-2"
          style={{
            width: "min(100%, 100cqh)",
            gridTemplateColumns: `repeat(${N}, minmax(0, 1fr))`,
            gridTemplateRows: `repeat(${N}, minmax(0, 1fr))`,
          }}
        >
          {Array.from({ length: N * N }, (_, i) => {
            const isRobot = i === robot;
            const isGoal = i === puzzle.goal;
            return (
              <div
                key={i}
                className={cn(
                  "flex items-center justify-center rounded-xl border bg-surface text-2xl shadow-sm transition-all sm:text-3xl",
                  isRobot && cn("ring-2", robotCell),
                  isGoal && !isRobot && "bg-secondary/20 ring-2 ring-secondary",
                  flash === "win" && isRobot && "scale-110 bg-success/15 ring-success",
                  flash === "fail" && isRobot && "bg-error/15 ring-error",
                )}
              >
                {isRobot ? mover : isGoal ? goal : ""}
              </div>
            );
          })}
        </div>
      </div>

      {/* queued directions + shortest hint (one compact row) */}
      <div className="flex w-full max-w-[340px] shrink-0 items-center gap-2">
        <div className="flex min-h-[2.25rem] flex-1 flex-wrap items-center gap-1.5 rounded-xl border border-border bg-surface px-3 py-1.5">
          {moves.length === 0 ? (
            <span className="inline-flex items-center gap-1 text-sm text-text-muted">
              {t("rtChooseDir")} <ChevronRight className="h-4 w-4" />
            </span>
          ) : (
            moves.map((d, i) => {
              const A = ARROW[d];
              return <A key={i} className="h-4 w-4 text-primary" />;
            })
          )}
        </div>
        <span className="shrink-0 whitespace-nowrap text-xs font-medium text-text-secondary">{t("rtShortest", { n: shortest })}</span>
      </div>

      {/* direction pad */}
      <div className="grid shrink-0 grid-cols-3 gap-1.5">
        <span />
        <PadBtn onClick={() => addMove("up")} disabled={disabled || animating}><ArrowUp className="h-5 w-5" /></PadBtn>
        <span />
        <PadBtn onClick={() => addMove("left")} disabled={disabled || animating}><ArrowLeft className="h-5 w-5" /></PadBtn>
        <PadBtn onClick={() => addMove("down")} disabled={disabled || animating}><ArrowDown className="h-5 w-5" /></PadBtn>
        <PadBtn onClick={() => addMove("right")} disabled={disabled || animating}><ArrowRight className="h-5 w-5" /></PadBtn>
      </div>

      {/* actions */}
      <div className="flex shrink-0 items-center gap-2">
        <button
          onClick={launch}
          disabled={disabled || animating || moves.length === 0}
          className="inline-flex items-center gap-2 rounded-xl bg-success px-5 py-2 font-bold text-white shadow-sm transition hover:bg-success disabled:opacity-40"
        >
          <Play className="h-4 w-4" /> {t("rtLaunch")}
        </button>
        <button
          onClick={clean}
          disabled={disabled || animating}
          className="inline-flex items-center gap-2 rounded-xl bg-border px-5 py-2 font-bold text-text-primary transition hover:bg-text-muted/40 disabled:opacity-40"
        >
          <Trash2 className="h-4 w-4" /> {t("rtClean")}
        </button>
      </div>
    </div>
  );
}

function PadBtn({ children, onClick, disabled }: { children: React.ReactNode; onClick: () => void; disabled: boolean }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary text-white shadow-sm transition hover:bg-primary-dark active:scale-90 disabled:opacity-40 sm:h-11 sm:w-11"
    >
      {children}
    </button>
  );
}

// ─── Setup wizard card ────────────────────────────────────────

function SetupCard({
  subtitle,
  children,
}: {
  subtitle: string;
  children: React.ReactNode;
}) {
  const t = useTranslations("games");
  return (
    <div className="mx-auto flex w-full max-w-lg flex-col items-center gap-5 rounded-3xl bg-surface p-8 shadow-sm">
      <div
        className="flex h-16 w-16 items-center justify-center rounded-2xl text-white shadow-lg"
        style={{ backgroundImage: "linear-gradient(135deg,#0891B2,#22D3EE)" }}
      >
        <Bot className="h-8 w-8" />
      </div>
      <div className="text-center">
        <h1 className="text-2xl font-extrabold text-text-primary">{t("rtTitle")}</h1>
        <p className="mt-1 text-text-secondary">{subtitle}</p>
      </div>
      {children}
    </div>
  );
}

// ─── Main ─────────────────────────────────────────────────────

type Step = "players" | "character" | "time" | "play";

export function RoutingAlgorithm() {
  const t = useTranslations("games");
  const c = useTranslations("common");
  const { playSfx } = useSound();
  useBackgroundMusic("routing");

  const [step, setStep] = useState<Step>("players");
  const [players, setPlayers] = useState<1 | 2>(1);
  const [charIdx, setCharIdx] = useState(0);
  const [minutes, setMinutes] = useState<number>(3);

  const [scores, setScores] = useState<Record<1 | 2, number>>({ 1: 0, 2: 0 });
  const [secondsLeft, setSecondsLeft] = useState(0);
  const [over, setOver] = useState(false);
  const [round, setRound] = useState(0); // bump to remount boards
  const [record, setRecord] = useState(0);

  const wrapRef = useRef<HTMLDivElement>(null);
  const [isFull, setIsFull] = useState(false);
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

  const character = CHARACTERS[charIdx];

  useEffect(() => {
    try {
      setRecord(Number(localStorage.getItem(RECORD_KEY)) || 0);
    } catch {}
  }, []);

  const beginPlay = () => {
    playSfx("click");
    setScores({ 1: 0, 2: 0 });
    setSecondsLeft(minutes * 60);
    setOver(false);
    setRound((r) => r + 1);
    setStep("play");
  };

  // match clock
  useEffect(() => {
    if (step !== "play" || over) return;
    const started = Date.now();
    const total = minutes * 60;
    const id = setInterval(() => {
      const left = total - Math.floor((Date.now() - started) / 1000);
      if (left <= 0) {
        clearInterval(id);
        setSecondsLeft(0);
        setOver(true);
      } else {
        setSecondsLeft(left);
      }
    }, 250);
    return () => clearInterval(id);
  }, [step, over, minutes, round]);

  // save record (solo) once, on game over
  useEffect(() => {
    if (!over || players !== 1) return;
    setScores((s) => {
      if (s[1] > record) {
        setRecord(s[1]);
        try {
          localStorage.setItem(RECORD_KEY, String(s[1]));
        } catch {}
      }
      return s;
    });
  }, [over, players, record]);

  const addScore = useCallback((p: 1 | 2) => {
    setScores((s) => ({ ...s, [p]: s[p] + 1 }));
  }, []);

  // Fanfare when the match clock runs out.
  useEffect(() => {
    if (over) playSfx("levelWin");
  }, [over, playSfx]);

  const mmss = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;

  // ── Setup steps ──────────────────────────────────────────
  if (step !== "play") {
    return (
      <div ref={wrapRef} className="mx-auto flex h-full max-w-3xl items-center justify-center overflow-y-auto bg-background p-4">
        {step === "players" && (
          <SetupCard subtitle={t("rtSelectPlayers")}>
            <div className="grid w-full grid-cols-2 gap-4">
              {([1, 2] as const).map((p) => (
                <button
                  key={p}
                  onClick={() => {
                    setPlayers(p);
                    setStep("character");
                  }}
                  className="flex flex-col items-center gap-2 rounded-2xl border-2 border-border py-8 text-lg font-bold text-text-primary transition hover:border-primary hover:bg-primary/10"
                >
                  <span className="text-4xl">{p === 1 ? "🧒" : "👥"}</span>
                  {p === 1 ? t("rtOnePlayer") : t("rtTwoPlayers")}
                </button>
              ))}
            </div>
          </SetupCard>
        )}

        {step === "character" && (
          <SetupCard subtitle={t("rtChooseChar")}>
            <div className="grid w-full grid-cols-2 gap-3">
              {CHARACTERS.map((ch, i) => (
                <button
                  key={ch.key}
                  onClick={() => setCharIdx(i)}
                  className={cn(
                    "flex flex-col items-center gap-1 rounded-2xl border-2 py-5 font-bold text-text-primary transition",
                    charIdx === i ? "border-primary bg-primary/10" : "border-border hover:border-primary/50",
                  )}
                >
                  <span className="text-3xl">{ch.mover} {ch.goal}</span>
                  <span className="text-sm">{t(`rtChar${ch.key}` as any)}</span>
                </button>
              ))}
            </div>
            <div className="flex w-full items-center justify-between">
              <button onClick={() => setStep("players")} className="inline-flex items-center gap-1.5 rounded-xl border border-border bg-surface px-5 py-2.5 font-bold text-text-secondary hover:bg-border">
                <ArrowLeft className="h-4 w-4" /> {c("back")}
              </button>
              <button onClick={() => setStep("time")} className="inline-flex items-center gap-1.5 rounded-xl bg-primary px-6 py-2.5 font-bold text-white hover:bg-primary">
                {c("next")} <ArrowRight className="h-4 w-4" />
              </button>
            </div>
          </SetupCard>
        )}

        {step === "time" && (
          <SetupCard subtitle={t("rtChooseTime")}>
            <div className="grid w-full grid-cols-4 gap-3">
              {TIMES.map((m) => (
                <button
                  key={m}
                  onClick={() => {
                    setMinutes(m);
                    beginPlay();
                  }}
                  className={cn(
                    "flex flex-col items-center gap-0.5 rounded-2xl border-2 py-6 transition",
                    minutes === m ? "border-primary bg-primary/10" : "border-border hover:border-primary/50",
                  )}
                >
                  <span className="text-3xl font-extrabold text-text-primary">{m}</span>
                  <span className="text-xs text-text-secondary">{t("rtMinuteN", { n: "" }).trim()}</span>
                </button>
              ))}
            </div>
            <button onClick={() => setStep("character")} className="inline-flex items-center gap-1.5 rounded-xl border border-border bg-surface px-5 py-2.5 font-bold text-text-secondary hover:bg-border">
              <ArrowLeft className="h-4 w-4" /> {c("back")}
            </button>
          </SetupCard>
        )}
      </div>
    );
  }

  // ── Play ─────────────────────────────────────────────────
  const winner = scores[1] === scores[2] ? 0 : scores[1] > scores[2] ? 1 : 2;

  return (
    <div ref={wrapRef} className="relative flex h-full flex-col gap-3 overflow-y-auto rounded-2xl bg-background p-3 sm:p-4">
      {/* top bar */}
      <div className="flex items-center justify-between gap-2">
        <button onClick={() => setStep("players")} className="inline-flex items-center gap-1.5 rounded-full bg-surface px-4 py-2 text-sm font-semibold text-text-secondary shadow-sm ring-1 ring-border hover:bg-border">
          <Home className="h-4 w-4" /> {t("rtHome")}
        </button>

        <div className="flex items-center gap-3">
          <ScorePlate label={players === 2 ? t("rtPlayerN", { n: 1 }) : t("score")} value={scores[1]} accent="blue" />
          <span className="rounded-xl bg-text-primary px-5 py-2 text-2xl font-extrabold text-white tabular-nums">{mmss(secondsLeft)}</span>
          {players === 2 ? (
            <ScorePlate label={t("rtPlayerN", { n: 2 })} value={scores[2]} accent="red" />
          ) : (
            <ScorePlate label={t("record")} value={record} accent="amber" />
          )}
        </div>
        <button onClick={toggleFull} title={isFull ? t("minimize") : t("maximize")} className="inline-flex items-center gap-1.5 rounded-full bg-surface px-4 py-2 text-sm font-semibold text-text-secondary shadow-sm ring-1 ring-border hover:bg-border">
          {isFull ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
        </button>
      </div>

      {/* boards */}
      <div className="flex min-h-0 flex-1 flex-col gap-4 md:flex-row md:justify-center">
        <div className={cn("h-full min-h-0 w-full max-w-md", players === 2 ? "md:flex-1" : "mx-auto")}>
          <RoutingBoard key={`p1-${round}`} accent="blue" mover={character.mover} goal={character.goal} disabled={over} onSolve={() => addScore(1)} t={t} />
        </div>
        {players === 2 && (
          <div className="h-full min-h-0 w-full max-w-md md:flex-1">
            <RoutingBoard key={`p2-${round}`} accent="red" mover={character.mover} goal={character.goal} disabled={over} onSolve={() => addScore(2)} t={t} />
          </div>
        )}
      </div>

      {/* game over */}
      {over && (
        <div className="absolute inset-0 z-10 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm">
          <div className="flex w-full max-w-sm flex-col items-center gap-4 rounded-3xl bg-surface p-8 text-center shadow-2xl">
            <div
              className={cn(
                "flex h-16 w-16 items-center justify-center rounded-full text-white shadow-md",
                players === 2 && winner !== 0 ? "bg-secondary-dark" : "bg-primary",
              )}
            >
              {players === 2 && winner !== 0 ? <Trophy className="h-8 w-8" /> : <Clock className="h-8 w-8" />}
            </div>
            <h2 className="text-2xl font-extrabold text-text-primary sm:text-3xl">
              {players === 2 ? (winner === 0 ? t("rtDraw") : t("rtWinnerN", { n: winner })) : t("rtTimeUp")}
            </h2>
            <div className="text-4xl font-extrabold text-primary tabular-nums">
              {players === 2 ? `${scores[1]} — ${scores[2]}` : scores[1]}
            </div>
            <div className="mt-1 flex w-full flex-col gap-2.5">
              <button
                onClick={beginPlay}
                className="inline-flex w-full items-center justify-center gap-2 rounded-2xl bg-primary px-5 py-3.5 font-bold text-white shadow-sm hover:bg-primary-dark"
              >
                <RotateCcw className="h-5 w-5" /> {t("playAgain")}
              </button>
              <button
                onClick={() => setStep("players")}
                className="inline-flex w-full items-center justify-center gap-2 rounded-2xl border border-border bg-background px-5 py-3.5 font-bold text-text-primary hover:bg-border"
              >
                <Home className="h-5 w-5" /> {t("rtHome")}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function ScorePlate({ label, value, accent }: { label: string; value: number; accent: "blue" | "red" | "amber" }) {
  const color = accent === "blue" ? "text-info" : accent === "red" ? "text-error" : "text-secondary-dark";
  return (
    <div className="rounded-xl bg-surface px-4 py-1.5 text-center shadow-sm">
      <div className={cn("text-[10px] font-bold uppercase tracking-wide", color)}>{label}</div>
      <div className="text-xl font-extrabold text-text-primary tabular-nums">{value}</div>
    </div>
  );
}
