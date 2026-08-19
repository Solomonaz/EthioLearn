"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { Maximize2, Minimize2, Check, Play, RotateCcw, Trophy, Medal } from "lucide-react";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";

/**
 * Number Memory — a single-screen memory/attention trainer (grades 1–6).
 *
 * Each of 10 levels flashes numbered tiles on a grid for a few seconds, then
 * hides them; the player must tap the tiles back in order (1, 2, 3 …). Levels
 * grow the grid and the count while the memorise time tightens. Scoring rewards
 * speed. A local (per-device) leaderboard keeps names + best scores — right for
 * a shared classroom screen, no student logins or backend needed.
 */

type Phase = "intro" | "memorize" | "recall" | "pause" | "over";
type Tile = "blank" | "number" | "correct" | "wrong";

interface Board {
  cols: number;
  count: number;
  /** cellIndex → number (1..count) shown there. */
  numberAt: Record<number, number>;
}

interface Entry {
  name: string;
  score: number;
  at: number;
}

const LB_KEY = "ethiolearn.numbermemory.leaderboard";
const NAME_KEY = "ethiolearn.numbermemory.name";
const MAX_LEVEL = 10;

function levelConfig(level: number): { cols: number; count: number; seconds: number } {
  const cols = level <= 3 ? 4 : level <= 7 ? 5 : 6;
  const count = Math.min(cols * cols - 2, 3 + level); // L1: 4 … L10: 13
  const seconds = Math.min(12, count + 3);
  return { cols, count, seconds };
}

function makeBoard(level: number): Board {
  const { cols, count } = levelConfig(level);
  const cells = cols * cols;
  const pool = Array.from({ length: cells }, (_, i) => i);
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  const numberAt: Record<number, number> = {};
  for (let n = 1; n <= count; n++) numberAt[pool[n - 1]] = n;
  return { cols, count, numberAt };
}

function loadLeaderboard(): Entry[] {
  try {
    const raw = localStorage.getItem(LB_KEY);
    const arr = raw ? (JSON.parse(raw) as Entry[]) : [];
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

export function NumberMemory({ onExit }: { onExit?: () => void }) {
  const t = useTranslations("games");
  const wrapRef = useRef<HTMLDivElement>(null);

  const [phase, setPhase] = useState<Phase>("intro");
  const [name, setName] = useState("");
  const [level, setLevel] = useState(1);
  const [score, setScore] = useState(0);
  const [board, setBoard] = useState<Board>(() => makeBoard(1));
  const [expected, setExpected] = useState(1);
  const [revealed, setRevealed] = useState<Set<number>>(new Set());
  const [wrongCell, setWrongCell] = useState<number | null>(null);
  const [secondsLeft, setSecondsLeft] = useState(0);
  const [memoTotal, setMemoTotal] = useState(1);
  const [result, setResult] = useState<"over" | "won" | null>(null);
  const [newRecord, setNewRecord] = useState(false);
  const [leaderboard, setLeaderboard] = useState<Entry[]>([]);
  const [isFull, setIsFull] = useState(false);

  const levelStart = useRef(0);
  const record = leaderboard[0]?.score ?? 0;

  useEffect(() => {
    setLeaderboard(loadLeaderboard());
    try {
      const n = localStorage.getItem(NAME_KEY);
      if (n) setName(n);
    } catch {}
  }, []);

  // ── Level lifecycle ───────────────────────────────────────
  const beginLevel = useCallback((lvl: number) => {
    const b = makeBoard(lvl);
    const { seconds } = levelConfig(lvl);
    setBoard(b);
    setExpected(1);
    setRevealed(new Set());
    setWrongCell(null);
    setMemoTotal(seconds);
    setSecondsLeft(seconds);
    setPhase("memorize");
  }, []);

  const startGame = () => {
    const nm = name.trim() || "Player";
    setName(nm);
    try {
      localStorage.setItem(NAME_KEY, nm);
    } catch {}
    setScore(0);
    setLevel(1);
    setResult(null);
    setNewRecord(false);
    beginLevel(1);
  };

  const startRecall = useCallback(() => {
    levelStart.current = Date.now();
    setPhase("recall");
  }, []);

  // memorize countdown → auto reveal
  useEffect(() => {
    if (phase !== "memorize") return;
    const started = Date.now();
    const id = setInterval(() => {
      const left = memoTotal - (Date.now() - started) / 1000;
      if (left <= 0) {
        clearInterval(id);
        setSecondsLeft(0);
        startRecall();
      } else {
        setSecondsLeft(left);
      }
    }, 100);
    return () => clearInterval(id);
  }, [phase, memoTotal, startRecall]);

  const finish = useCallback(
    (outcome: "over" | "won", finalScore: number) => {
      const entry: Entry = { name: name.trim() || "Player", score: finalScore, at: Date.now() };
      const next = [...loadLeaderboard(), entry].sort((a, b) => b.score - a.score).slice(0, 10);
      const isRecord = finalScore > 0 && next[0]?.at === entry.at && next[0]?.score === finalScore;
      try {
        localStorage.setItem(LB_KEY, JSON.stringify(next));
      } catch {}
      setLeaderboard(next);
      setNewRecord(isRecord);
      setResult(outcome);
      setPhase("over");
    },
    [name],
  );

  const clickCell = (cell: number) => {
    if (phase !== "recall") return;
    const num = board.numberAt[cell];
    if (num === expected) {
      const nextRevealed = new Set(revealed);
      nextRevealed.add(cell);
      setRevealed(nextRevealed);
      if (expected === board.count) {
        // level cleared — award points (speed bonus)
        const elapsed = (Date.now() - levelStart.current) / 1000;
        const speed = Math.max(0, Math.round(120 - elapsed * 8));
        const gained = board.count * 20 + speed;
        const total = score + gained;
        setScore(total);
        setExpected(board.count + 1); // block further taps this level
        if (level >= MAX_LEVEL) {
          finish("won", total);
        } else {
          const nextLevel = level + 1;
          setLevel(nextLevel);
          setPhase("pause"); // brief lock so a stray tap can't advance/end
          setTimeout(() => beginLevel(nextLevel), 550);
        }
      } else {
        setExpected(expected + 1);
      }
    } else {
      // wrong tap — reveal the tile that was correct, end the run
      setWrongCell(cell);
      setPhase("over"); // freeze board immediately
      setTimeout(() => finish("over", score), 700);
    }
  };

  // ── Fullscreen ────────────────────────────────────────────
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

  // Size the square board to the available area — fits both width and height,
  // and scales up in fullscreen. A ResizeObserver (attached via callback ref)
  // re-measures on mount, window resize, and entering/exiting fullscreen.
  const [boardSize, setBoardSize] = useState(0);
  const roRef = useRef<ResizeObserver | null>(null);
  const attachBoardArea = useCallback((el: HTMLDivElement | null) => {
    roRef.current?.disconnect();
    if (!el) return;
    const measure = () => setBoardSize(Math.floor(Math.min(el.clientWidth, el.clientHeight)));
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    roRef.current = ro;
  }, []);

  // ── Tile appearance ───────────────────────────────────────
  const tileState = (cell: number): Tile => {
    if (wrongCell === cell) return "wrong";
    if (revealed.has(cell)) return "correct";
    if (phase === "memorize" && board.numberAt[cell]) return "number";
    if (phase === "over" && result === "over" && board.numberAt[cell]) return "number"; // reveal answer on loss
    return "blank";
  };

  const showControls = phase !== "intro";

  return (
    <div ref={wrapRef} className="flex h-full flex-col items-center gap-3 overflow-y-auto rounded-2xl bg-background p-3 sm:p-4">
      {/* top toolbar */}
      <div className="flex w-full max-w-2xl items-center justify-between">
        {onExit ? (
          <button onClick={onExit} className="rounded-lg bg-surface px-3 py-1.5 text-sm font-semibold text-text-secondary shadow-sm hover:bg-border">
            {t("exit")}
          </button>
        ) : (
          <span />
        )}
        <button onClick={toggleFull} className="inline-flex items-center gap-1.5 rounded-lg bg-surface px-3 py-1.5 text-sm font-semibold text-text-secondary shadow-sm hover:bg-border">
          {isFull ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
          {isFull ? t("minimize") : t("maximize")}
        </button>
      </div>

      {/* scoreboard */}
      <div className="flex w-full max-w-2xl items-center justify-around rounded-2xl bg-surface px-6 py-4 shadow-sm">
        <div className="text-center">
          <span className="text-sm text-text-secondary">{t("level")}</span>{" "}
          <span className="text-lg font-bold text-primary">{level}</span>
          <span className="text-sm text-text-muted"> / {MAX_LEVEL}</span>
        </div>
        <div className="h-8 w-px bg-border" />
        <div className="text-center">
          <span className="text-sm text-text-secondary">{t("score")}</span>{" "}
          <span className="text-lg font-bold text-text-primary tabular-nums">{score}</span>
        </div>
        <div className="h-8 w-px bg-border" />
        <div className="text-center">
          <span className="text-sm text-text-secondary">{t("record")}</span>{" "}
          <span className="text-lg font-bold text-secondary-dark tabular-nums">{record}</span>
        </div>
      </div>

      {/* status / prompt bar */}
      {showControls && phase !== "over" && (
        <div className="flex w-full max-w-2xl items-center gap-3">
          <div className="flex flex-1 flex-col gap-1.5 rounded-xl bg-surface px-4 py-3 shadow-sm">
            <div className="flex items-center justify-between">
              <span className="text-sm font-semibold text-text-primary">
                {phase === "memorize" ? t("numRemember") : t("numOrder")}
              </span>
              <span className="rounded-full bg-primary px-2.5 py-0.5 text-xs font-bold text-white tabular-nums">
                {phase === "memorize" ? Math.ceil(secondsLeft) : `${expected - 1}/${board.count}`}
              </span>
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-border">
              <div
                className={cn("h-full rounded-full transition-all", phase === "memorize" ? "bg-primary" : "bg-success")}
                style={{
                  width:
                    phase === "memorize"
                      ? `${(secondsLeft / memoTotal) * 100}%`
                      : `${((expected - 1) / board.count) * 100}%`,
                }}
              />
            </div>
          </div>
          {phase === "memorize" && (
            <button
              onClick={startRecall}
              className="inline-flex items-center gap-2 rounded-xl bg-primary px-5 py-3 font-bold text-white shadow-sm hover:bg-primary-dark"
            >
              <Check className="h-5 w-5" /> {t("numReady")}
            </button>
          )}
        </div>
      )}

      {/* board / intro / result */}
      {phase === "intro" ? (
        <div className="w-full max-w-2xl">
          <IntroPanel name={name} setName={setName} onStart={startGame} leaderboard={leaderboard} t={t} />
        </div>
      ) : (
        <div ref={attachBoardArea} className="relative flex min-h-0 w-full flex-1 items-center justify-center">
          <div
            className="grid"
            style={{
              width: boardSize || undefined,
              height: boardSize || undefined,
              gap: Math.max(6, Math.round((boardSize || 0) / board.cols / 9)),
              gridTemplateColumns: `repeat(${board.cols}, minmax(0, 1fr))`,
              gridTemplateRows: `repeat(${board.cols}, minmax(0, 1fr))`,
            }}
          >
            {Array.from({ length: board.cols * board.cols }, (_, cell) => {
              const state = tileState(cell);
              const num = board.numberAt[cell];
              const clickable = phase === "recall";
              return (
                <button
                  key={cell}
                  disabled={!clickable}
                  onClick={() => clickCell(cell)}
                  style={{ fontSize: boardSize ? Math.max(16, Math.round((boardSize / board.cols) * 0.4)) : undefined }}
                  className={cn(
                    "flex items-center justify-center rounded-xl font-extrabold text-white shadow-sm transition sm:rounded-2xl",
                    state === "blank" && "bg-gradient-to-br from-secondary to-secondary-dark",
                    state === "number" && "bg-gradient-to-br from-primary-light to-primary",
                    state === "correct" && "bg-gradient-to-br from-success to-success",
                    state === "wrong" && "bg-gradient-to-br from-error to-error",
                    clickable && "hover:brightness-105 active:scale-95",
                  )}
                >
                  {(state === "number" || state === "correct" || state === "wrong") && num ? num : ""}
                </button>
              );
            })}
          </div>

          {/* result — centered overlay so it's always visible, any screen size */}
          {phase === "over" && result && (
            <div className="absolute inset-0 flex items-center justify-center p-4">
              <div className="flex max-w-sm flex-col items-center gap-3 rounded-2xl bg-surface/95 p-6 text-center shadow-2xl backdrop-blur-sm">
                <div className="text-2xl font-extrabold text-text-primary">
                  {result === "won" ? t("numAllDone") : t("gameOver")}
                </div>
                <div className="text-lg font-bold text-text-secondary">{t("scoreN", { n: score })}</div>
                {newRecord && <div className="text-sm font-bold text-secondary-dark">{t("numNewRecord")}</div>}
                <div className="mt-1 flex items-center gap-2">
                  <button onClick={startGame} className="inline-flex items-center gap-2 rounded-xl bg-primary px-5 py-2.5 font-bold text-white hover:bg-primary-dark">
                    <RotateCcw className="h-4 w-4" /> {t("playAgain")}
                  </button>
                  <button onClick={() => setPhase("intro")} className="rounded-xl bg-border px-5 py-2.5 font-bold text-text-primary hover:bg-text-muted/40">
                    {t("numLeaderboard")}
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Intro: name + start + leaderboard ────────────────────────

function IntroPanel({
  name,
  setName,
  onStart,
  leaderboard,
  t,
}: {
  name: string;
  setName: (v: string) => void;
  onStart: () => void;
  leaderboard: Entry[];
  t: ReturnType<typeof useTranslations>;
}) {
  const medal = ["text-secondary-dark", "text-text-muted", "text-warning"];
  return (
    <div className="grid w-full max-w-xl gap-4 sm:grid-cols-2">
      <div className="flex flex-col gap-3 rounded-2xl bg-surface p-5 shadow-sm">
        <div>
          <h2 className="text-lg font-bold text-text-primary">{t("numTitle")}</h2>
          <p className="mt-1 text-sm text-text-secondary">{t("numWatchSub")}</p>
        </div>
        <Input
          label={t("numName")}
          placeholder={t("numNamePh")}
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && onStart()}
          maxLength={20}
        />
        <button
          onClick={onStart}
          className="inline-flex items-center justify-center gap-2 rounded-xl bg-primary px-5 py-3 text-base font-bold text-white shadow-sm hover:bg-primary-dark"
        >
          <Play className="h-5 w-5" /> {t("numStart")}
        </button>
      </div>

      <div className="rounded-2xl bg-surface p-5 shadow-sm">
        <h3 className="mb-3 flex items-center gap-2 font-bold text-text-primary">
          <Trophy className="h-5 w-5 text-secondary-dark" /> {t("numLeaderboard")}
        </h3>
        {leaderboard.length === 0 ? (
          <p className="text-sm text-text-muted">{t("numNoScores")}</p>
        ) : (
          <ol className="space-y-1.5">
            {leaderboard.slice(0, 6).map((e, i) => (
              <li key={e.at} className="flex items-center justify-between text-sm">
                <span className="flex items-center gap-2">
                  {i < 3 ? <Medal className={cn("h-4 w-4", medal[i])} /> : <span className="w-4 text-center text-xs text-text-muted">{i + 1}</span>}
                  <span className="font-medium text-text-primary">{e.name}</span>
                </span>
                <span className="font-bold tabular-nums text-text-primary">{e.score}</span>
              </li>
            ))}
          </ol>
        )}
      </div>
    </div>
  );
}
