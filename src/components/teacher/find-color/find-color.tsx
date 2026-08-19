"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import {
  Maximize2,
  Minimize2,
  Play,
  RotateCcw,
  Trophy,
  Medal,
  Clock,
  Home,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";

/**
 * Find the Different Color — a single-screen focus/attention trainer.
 *
 * A grid of identically-coloured tiles hides one tile of a slightly different
 * shade. Tap the odd one out to advance: each correct answer grows the grid
 * (more tiles) and shrinks the colour difference, so it gets harder as you go.
 * A live countdown runs the whole game — correct taps add a little time, wrong
 * taps cost time — and when it hits zero the "Time is up!" modal appears.
 *
 * No backend or student logins: a local (per-device) leaderboard keeps names +
 * best scores, right for a shared classroom screen.
 */

type Phase = "intro" | "playing" | "over";

interface Board {
  cols: number;
  /** cell index (0..cols*cols-1) holding the odd-coloured tile. */
  oddCell: number;
  base: string;
  odd: string;
}

interface Entry {
  name: string;
  score: number;
  level: number;
  time: number;
  at: number;
}

const LB_KEY = "ethiolearn.findcolor.leaderboard";
const NAME_KEY = "ethiolearn.findcolor.name";

const START_TIME = 15; // seconds on the clock at kickoff
const TIME_CAP = 20; // clock never climbs past this
const BONUS_TIME = 4; // added per correct tap
const PENALTY_TIME = 3; // removed per wrong tap
const POINTS = 10; // score per correct tap

/** Grid width for a level: 2×2 → grows to 8×8, one step every two levels. */
function colsFor(level: number): number {
  return Math.min(8, 1 + Math.ceil((level + 1) / 2));
}

/** Lightness gap between the odd tile and the rest — subtler each level. */
function deltaFor(level: number): number {
  return Math.max(4, 26 - level * 1.3);
}

function makeBoard(level: number): Board {
  const cols = colsFor(level);
  const cells = cols * cols;
  const oddCell = Math.floor(Math.random() * cells);

  const hue = Math.floor(Math.random() * 360);
  const sat = 45 + Math.floor(Math.random() * 30); // 45–75%
  const light = 38 + Math.floor(Math.random() * 22); // 38–60%
  const delta = deltaFor(level);
  // Nudge toward whichever direction keeps the odd tile in range.
  const sign = light + delta > 82 ? -1 : light - delta < 12 ? 1 : Math.random() < 0.5 ? 1 : -1;

  const base = `hsl(${hue}, ${sat}%, ${light}%)`;
  const odd = `hsl(${hue}, ${sat}%, ${light + sign * delta}%)`;
  return { cols, oddCell, base, odd };
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

function formatTime(secs: number): string {
  const s = Math.max(0, Math.round(secs));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  return `${m}m ${s % 60}s`;
}

export function FindColor({ onExit }: { onExit?: () => void }) {
  const t = useTranslations("games");
  const router = useRouter();
  const wrapRef = useRef<HTMLDivElement>(null);

  const [phase, setPhase] = useState<Phase>("intro");
  const [name, setName] = useState("");
  const [level, setLevel] = useState(1);
  const [score, setScore] = useState(0);
  const [board, setBoard] = useState<Board>(() => makeBoard(1));
  const [timeLeft, setTimeLeft] = useState(START_TIME);
  const [elapsed, setElapsed] = useState(0);
  const [wrongCell, setWrongCell] = useState<number | null>(null);
  const [newRecord, setNewRecord] = useState(false);
  const [leaderboard, setLeaderboard] = useState<Entry[]>([]);
  const [isFull, setIsFull] = useState(false);

  const deadlineRef = useRef(0);
  const startedRef = useRef(0);
  const scoreRef = useRef(0);
  const levelRef = useRef(1);
  const record = leaderboard[0]?.score ?? 0;

  useEffect(() => {
    setLeaderboard(loadLeaderboard());
    try {
      const n = localStorage.getItem(NAME_KEY);
      if (n) setName(n);
    } catch {}
  }, []);

  const finish = useCallback(
    (finalScore: number, finalLevel: number, finalElapsed: number) => {
      const entry: Entry = {
        name: name.trim() || "Player",
        score: finalScore,
        level: finalLevel,
        time: Math.round(finalElapsed),
        at: Date.now(),
      };
      const next = [...loadLeaderboard(), entry]
        .sort((a, b) => b.score - a.score || a.time - b.time)
        .slice(0, 10);
      const isRecord =
        finalScore > 0 && next[0]?.at === entry.at && next[0]?.score === finalScore;
      try {
        localStorage.setItem(LB_KEY, JSON.stringify(next));
      } catch {}
      setLeaderboard(next);
      setNewRecord(isRecord);
      setElapsed(finalElapsed);
      setPhase("over");
    },
    [name],
  );

  // ── Countdown clock ───────────────────────────────────────
  useEffect(() => {
    if (phase !== "playing") return;
    const id = setInterval(() => {
      const now = Date.now();
      const left = (deadlineRef.current - now) / 1000;
      const played = (now - startedRef.current) / 1000;
      if (left <= 0) {
        clearInterval(id);
        setTimeLeft(0);
        finish(scoreRef.current, levelRef.current, played);
      } else {
        setTimeLeft(left);
        setElapsed(played);
      }
    }, 100);
    return () => clearInterval(id);
  }, [phase, finish]);

  const startGame = () => {
    const nm = name.trim() || "Player";
    setName(nm);
    try {
      localStorage.setItem(NAME_KEY, nm);
    } catch {}
    scoreRef.current = 0;
    levelRef.current = 1;
    setScore(0);
    setLevel(1);
    setBoard(makeBoard(1));
    setWrongCell(null);
    setNewRecord(false);
    setElapsed(0);
    const now = Date.now();
    startedRef.current = now;
    deadlineRef.current = now + START_TIME * 1000;
    setTimeLeft(START_TIME);
    setPhase("playing");
  };

  const clickCell = (cell: number) => {
    if (phase !== "playing") return;
    const now = Date.now();
    if (cell === board.oddCell) {
      // correct — grow the grid, add points and a little time
      deadlineRef.current = Math.min(
        deadlineRef.current + BONUS_TIME * 1000,
        now + TIME_CAP * 1000,
      );
      scoreRef.current += POINTS;
      levelRef.current += 1;
      setScore(scoreRef.current);
      setLevel(levelRef.current);
      setBoard(makeBoard(levelRef.current));
      setWrongCell(null);
    } else {
      // wrong — dock time and flash the tile
      deadlineRef.current -= PENALTY_TIME * 1000;
      setWrongCell(cell);
      window.setTimeout(() => setWrongCell((c) => (c === cell ? null : c)), 350);
    }
  };

  const goHome = () => {
    if (onExit) onExit();
    else router.push("/teacher");
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

  // Size the square board to the available area (fits width & height, scales up
  // in fullscreen). A ResizeObserver re-measures on resize / fullscreen change.
  const [boardSize, setBoardSize] = useState(0);
  const roRef = useRef<ResizeObserver | null>(null);
  const attachBoardArea = useCallback((el: HTMLDivElement | null) => {
    roRef.current?.disconnect();
    if (!el) return;
    const measure = () =>
      setBoardSize(Math.floor(Math.min(el.clientWidth, el.clientHeight)));
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    roRef.current = ro;
  }, []);

  const timerPct = Math.max(0, Math.min(100, (timeLeft / TIME_CAP) * 100));
  const timerLow = timeLeft <= 5;

  return (
    <div
      ref={wrapRef}
      className="flex h-full flex-col items-center gap-3 overflow-y-auto rounded-2xl bg-background p-3 sm:p-4"
    >
      {/* top toolbar */}
      <div className="flex w-full max-w-2xl items-center justify-between">
        {onExit ? (
          <button
            onClick={onExit}
            className="rounded-lg bg-surface px-3 py-1.5 text-sm font-semibold text-text-secondary shadow-sm hover:bg-border"
          >
            {t("exit")}
          </button>
        ) : (
          <span />
        )}
        <button
          onClick={toggleFull}
          className="inline-flex items-center gap-1.5 rounded-lg bg-surface px-3 py-1.5 text-sm font-semibold text-text-secondary shadow-sm hover:bg-border"
        >
          {isFull ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
          {isFull ? t("minimize") : t("maximize")}
        </button>
      </div>

      {/* scoreboard */}
      <div className="flex w-full max-w-2xl items-center justify-around rounded-2xl bg-surface px-6 py-4 shadow-sm">
        <div className="text-center">
          <span className="text-sm text-text-secondary">{t("level")}</span>{" "}
          <span className="text-lg font-bold text-primary">{level}</span>
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

      {/* prompt + timer bar */}
      {phase === "playing" && (
        <div className="flex w-full max-w-2xl flex-col gap-1.5 rounded-xl bg-surface px-4 py-3 shadow-sm">
          <div className="flex items-center justify-between">
            <span className="text-sm font-semibold text-text-primary">{t("colorFind")}</span>
            <span
              className={cn(
                "inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-bold tabular-nums text-white",
                timerLow ? "bg-error" : "bg-primary",
              )}
            >
              <Clock className="h-3 w-3" />
              {Math.ceil(timeLeft)}
            </span>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-border">
            <div
              className={cn(
                "h-full rounded-full transition-all duration-100",
                timerLow ? "bg-error" : "bg-primary",
              )}
              style={{ width: `${timerPct}%` }}
            />
          </div>
        </div>
      )}

      {/* board / intro */}
      {phase === "intro" ? (
        <div className="w-full max-w-2xl">
          <IntroPanel
            name={name}
            setName={setName}
            onStart={startGame}
            leaderboard={leaderboard}
            t={t}
          />
        </div>
      ) : (
        <div
          ref={attachBoardArea}
          className="relative flex min-h-0 w-full flex-1 items-center justify-center"
        >
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
              const isOdd = cell === board.oddCell;
              return (
                <button
                  key={cell}
                  disabled={phase !== "playing"}
                  onClick={() => clickCell(cell)}
                  style={{ backgroundColor: isOdd ? board.odd : board.base }}
                  className={cn(
                    "rounded-xl shadow-sm transition sm:rounded-2xl",
                    phase === "playing" && "hover:brightness-110 active:scale-95",
                    wrongCell === cell &&
                      "ring-4 ring-error ring-offset-2 ring-offset-background",
                  )}
                  aria-label={t("colorFind")}
                />
              );
            })}
          </div>

          {/* Time-is-up modal */}
          {phase === "over" && (
            <div className="absolute inset-0 z-10 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm">
              <div className="relative flex w-full max-w-sm flex-col items-center gap-4 rounded-3xl bg-surface p-7 text-center shadow-2xl">
                <button
                  onClick={goHome}
                  className="absolute right-4 top-4 rounded-full bg-background p-1.5 text-text-muted hover:bg-border"
                  aria-label={t("exit")}
                >
                  <X className="h-4 w-4" />
                </button>

                <div className="flex h-16 w-16 items-center justify-center rounded-full bg-secondary-dark text-white shadow-md">
                  <Clock className="h-8 w-8" />
                </div>
                <h2 className="text-2xl font-extrabold text-text-primary">
                  {t("colorTimeUp")}
                </h2>
                <div className="text-5xl font-extrabold text-primary tabular-nums">
                  {score}
                </div>
                <p className="text-sm text-text-secondary">{t("colorTimeUpSub")}</p>

                {newRecord && (
                  <div className="text-sm font-bold text-secondary-dark">{t("numNewRecord")}</div>
                )}

                <div className="flex w-full items-center justify-around rounded-2xl bg-background px-4 py-4">
                  <Stat label={t("level")} value={String(level)} />
                  <Stat label={t("score")} value={String(score)} />
                  <Stat label={t("time")} value={formatTime(elapsed)} />
                </div>

                <div className="flex w-full flex-col gap-2.5">
                  <button
                    onClick={startGame}
                    className="inline-flex w-full items-center justify-center gap-2 rounded-2xl bg-primary px-5 py-3.5 font-bold text-white shadow-sm hover:bg-primary-dark"
                  >
                    <RotateCcw className="h-5 w-5" /> {t("colorStartOver")}
                  </button>
                  <button
                    onClick={goHome}
                    className="inline-flex w-full items-center justify-center gap-2 rounded-2xl bg-background px-5 py-3.5 font-bold text-text-primary hover:bg-border"
                  >
                    <Home className="h-5 w-5" /> {t("colorHome")}
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

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="text-center">
      <div className="text-lg font-extrabold text-primary tabular-nums">{value}</div>
      <div className="text-xs font-medium uppercase tracking-wide text-text-muted">
        {label}
      </div>
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
          <h2 className="text-lg font-bold text-text-primary">{t("colorTitle")}</h2>
          <p className="mt-1 text-sm text-text-secondary">{t("colorSub")}</p>
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
                  {i < 3 ? (
                    <Medal className={cn("h-4 w-4", medal[i])} />
                  ) : (
                    <span className="w-4 text-center text-xs text-text-muted">{i + 1}</span>
                  )}
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
