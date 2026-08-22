"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import {
  Maximize2,
  Minimize2,
  RotateCcw,
  Home,
  X,
  Clock,
  Sparkles,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  FP,
  boardSizeForRound,
  buildColumns,
  buildFlipCards,
  drawRoundPairs,
  roundSecondsForRound,
  type Card,
  type Column,
  type Pair,
  type PairMatch,
} from "@/lib/games/find-pair";

type Phase = "playing" | "roundclear" | "over";

function formatTime(secs: number): string {
  const s = Math.max(0, Math.round(secs));
  const m = Math.floor(s / 60);
  return m > 0 ? `${m}m ${s % 60}s` : `${s}s`;
}

export function FindPairGame({ match, onExit }: { match: PairMatch; onExit?: () => void }) {
  const t = useTranslations("games");
  const { config } = match;
  const wrapRef = useRef<HTMLDivElement>(null);

  const maxBoard = config.perRound;
  const firstPairs = useMemo(
    () => drawRoundPairs(match.pairs, boardSizeForRound(1, match.pairs.length, maxBoard)),
    // deck is stable for the life of a match; deal round 1 once
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  // Round is 1-based and unbounded — the game is endless and gets harder each
  // round (bigger board, and, when timed, a shorter clock).
  const [round, setRound] = useState(1);
  const [boardPairs, setBoardPairs] = useState<Pair[]>(firstPairs);

  const [phase, setPhase] = useState<Phase>("playing");

  // Flip-mode board
  const [cards, setCards] = useState<Card[]>(() => buildFlipCards(firstPairs));
  const [flipped, setFlipped] = useState<string[]>([]);
  const [lock, setLock] = useState(false);

  // Match-mode board
  const [columns, setColumns] = useState<Column>(() => buildColumns(firstPairs));
  const [pickedLeft, setPickedLeft] = useState<string | null>(null);
  const [wrong, setWrong] = useState<string | null>(null);

  // Shared
  const [matched, setMatched] = useState<Set<string>>(new Set());
  const [score, setScore] = useState(0);
  const [found, setFound] = useState(0); // pairs matched across all rounds
  const [moves, setMoves] = useState(0);
  const [elapsed, setElapsed] = useState(0);
  const [timeLeft, setTimeLeft] = useState(roundSecondsForRound(1, config.roundSeconds));
  const [isFull, setIsFull] = useState(false);

  const startedRef = useRef(Date.now());
  // Round 1 is dealt via initial state (not dealRound), so seed its deadline
  // here — otherwise the countdown would see an already-expired clock.
  const deadlineRef = useRef(
    config.roundSeconds > 0
      ? Date.now() + roundSecondsForRound(1, config.roundSeconds) * 1000
      : 0,
  );
  const cardById = useMemo(() => {
    const m = new Map<string, Card>();
    cards.forEach((c) => m.set(c.id, c));
    return m;
  }, [cards]);

  // ── Deal a round ──────────────────────────────────────────
  const dealRound = useCallback(
    (roundNo: number) => {
      const size = boardSizeForRound(roundNo, match.pairs.length, maxBoard);
      const pairs = drawRoundPairs(match.pairs, size);
      const secs = roundSecondsForRound(roundNo, config.roundSeconds);
      setBoardPairs(pairs);
      setCards(buildFlipCards(pairs));
      setColumns(buildColumns(pairs));
      setMatched(new Set());
      setFlipped([]);
      setPickedLeft(null);
      setWrong(null);
      setLock(false);
      deadlineRef.current = secs > 0 ? Date.now() + secs * 1000 : 0;
      setTimeLeft(secs);
    },
    [match.pairs, maxBoard, config.roundSeconds],
  );

  const finish = useCallback(() => setPhase("over"), []);

  // ── Round cleared → advance to the next, harder round ─────
  // Advancing lives in its own effect so the flash timer is not cancelled by
  // the re-render that enters the "roundclear" phase.
  useEffect(() => {
    if (phase !== "playing") return;
    if (boardPairs.length > 0 && matched.size === boardPairs.length) {
      setScore((s) => s + FP.ROUND_BONUS * round);
      setPhase("roundclear");
    }
  }, [matched, phase, boardPairs.length, round]);

  useEffect(() => {
    if (phase !== "roundclear") return;
    const next = round + 1;
    const id = window.setTimeout(() => {
      setRound(next);
      dealRound(next);
      setPhase("playing");
    }, 900);
    return () => window.clearTimeout(id);
  }, [phase, round, dealRound]);

  // ── Round countdown (timed play) / elapsed clock ─────────
  useEffect(() => {
    if (phase !== "playing") return;
    if (config.roundSeconds <= 0) {
      const id = setInterval(() => setElapsed((Date.now() - startedRef.current) / 1000), 250);
      return () => clearInterval(id);
    }
    const id = setInterval(() => {
      const now = Date.now();
      setElapsed((now - startedRef.current) / 1000);
      const left = (deadlineRef.current - now) / 1000;
      if (left <= 0) {
        clearInterval(id);
        setTimeLeft(0);
        finish();
      } else {
        setTimeLeft(left);
      }
    }, 100);
    return () => clearInterval(id);
  }, [phase, config.roundSeconds, finish]);

  // ── Flip-mode interaction ─────────────────────────────────
  const flipClick = (cardId: string) => {
    if (phase !== "playing" || lock) return;
    const card = cardById.get(cardId);
    if (!card || matched.has(card.pairId) || flipped.includes(cardId)) return;
    const next = [...flipped, cardId];
    setFlipped(next);
    if (next.length < 2) return;

    setMoves((m) => m + 1);
    const [a, b] = next.map((id) => cardById.get(id)!);
    if (a.pairId === b.pairId) {
      setMatched((prev) => new Set(prev).add(a.pairId));
      setScore((s) => s + FP.MATCH_POINTS);
      setFound((f) => f + 1);
      setFlipped([]);
    } else {
      setLock(true);
      window.setTimeout(() => {
        setFlipped([]);
        setLock(false);
      }, 850);
    }
  };

  // ── Match-mode interaction ────────────────────────────────
  const matchClick = (side: "left" | "right", card: Card) => {
    if (phase !== "playing" || matched.has(card.pairId)) return;
    if (side === "left") {
      setPickedLeft((cur) => (cur === card.id ? null : card.id));
      setWrong(null);
      return;
    }
    // right side tapped — need a left selection
    if (!pickedLeft) return;
    const left = cardById.get(pickedLeft) ?? columns.left.find((c) => c.id === pickedLeft);
    setMoves((m) => m + 1);
    if (left && left.pairId === card.pairId) {
      setMatched((prev) => new Set(prev).add(card.pairId));
      setScore((s) => s + FP.MATCH_POINTS);
      setFound((f) => f + 1);
      setPickedLeft(null);
    } else {
      setWrong(card.id);
      window.setTimeout(() => setWrong((w) => (w === card.id ? null : w)), 500);
    }
  };

  // ── Restart ───────────────────────────────────────────────
  const restart = () => {
    setRound(1);
    setScore(0);
    setFound(0);
    setMoves(0);
    startedRef.current = Date.now();
    setElapsed(0);
    dealRound(1);
    setPhase("playing");
  };

  const goHome = () => onExit?.();

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

  // Measure the play area so the flip board always fits — no page scroll, no
  // matter how many cards a round has or how large the screen is. We track the
  // element size from every angle that can change it: a ResizeObserver, window
  // resizes, and entering/leaving fullscreen.
  const boardRef = useRef<HTMLDivElement | null>(null);
  const [area, setArea] = useState({ w: 0, h: 0 });
  const measureBoard = useCallback(() => {
    const el = boardRef.current;
    if (el) setArea({ w: el.clientWidth, h: el.clientHeight });
  }, []);
  useEffect(() => {
    measureBoard();
    const el = boardRef.current;
    const ro = new ResizeObserver(measureBoard);
    if (el) ro.observe(el);
    window.addEventListener("resize", measureBoard);
    document.addEventListener("fullscreenchange", measureBoard);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", measureBoard);
      document.removeEventListener("fullscreenchange", measureBoard);
    };
  }, [measureBoard]);

  // Pick the column count + card size that fills the measured area best while
  // fitting both its width and its height (cards keep a ~3:2 landscape ratio).
  const flipLayout = useMemo(() => {
    const n = cards.length;
    const { w: W, h: H } = area;
    const GAP = 12;
    const ASPECT = 1.5;
    if (!W || !H || !n) return null;
    let best = { cols: 2, cardW: 0, cardH: 0, gap: GAP, area: -1 };
    for (let cols = 1; cols <= n; cols++) {
      const rows = Math.ceil(n / cols);
      const cw = (W - (cols - 1) * GAP) / cols;
      const ch = (H - (rows - 1) * GAP) / rows;
      if (cw <= 0 || ch <= 0) continue;
      let cardW = cw;
      let cardH = cw / ASPECT;
      if (cardH > ch) {
        cardH = ch;
        cardW = ch * ASPECT;
      }
      const a = cardW * cardH;
      if (a > best.area) best = { cols, cardW, cardH, gap: GAP, area: a };
    }
    return best;
  }, [cards.length, area]);

  const timerLow = config.roundSeconds > 0 && timeLeft <= 8;

  return (
    <div
      ref={wrapRef}
      className="flex h-full flex-col items-center gap-3 overflow-y-auto rounded-2xl bg-background p-3 sm:p-4"
    >
      {/* toolbar */}
      <div className="flex w-full max-w-4xl items-center justify-between">
        {onExit ? (
          <button
            onClick={onExit}
            className="rounded-full border border-border bg-surface px-4 py-2 text-sm font-semibold text-text-secondary shadow-sm hover:bg-border"
          >
            {t("exit")}
          </button>
        ) : (
          <span />
        )}
        <button
          onClick={toggleFull}
          className="inline-flex items-center gap-1.5 rounded-full border border-border bg-surface px-4 py-2 text-sm font-semibold text-text-secondary shadow-sm hover:bg-border"
        >
          {isFull ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
          {isFull ? t("minimize") : t("maximize")}
        </button>
      </div>

      {/* scoreboard */}
      <div className="flex w-full max-w-4xl items-center justify-around rounded-2xl bg-surface px-6 py-3 shadow-sm">
        <Stat label={t("score")} value={String(score)} tone="primary" />
        <div className="h-8 w-px bg-border" />
        <Stat label={t("fpRound")} value={String(round)} />
        <div className="h-8 w-px bg-border" />
        <Stat label={t("matches")} value={String(found)} />
        <div className="hidden h-8 w-px bg-border sm:block" />
        <Stat label={t("moves")} value={String(moves)} className="hidden sm:block" />
        {config.roundSeconds > 0 && (
          <>
            <div className="h-8 w-px bg-border" />
            <Stat
              label={t("time")}
              value={`${Math.ceil(timeLeft)}s`}
              tone={timerLow ? "error" : "default"}
            />
          </>
        )}
      </div>

      {/* prompt / round bar */}
      <div className="flex w-full max-w-4xl items-center justify-between gap-3 rounded-xl bg-surface px-4 py-2.5 shadow-sm">
        <span className="text-sm font-semibold text-text-primary">
          {config.mode === "flip" ? t("matchHint") : t("findHint")}
        </span>
        <span className="shrink-0 rounded-full bg-primary/10 px-2.5 py-0.5 text-xs font-bold text-primary">
          {t("fpRoundN", { n: round })} · {boardPairs.length} {t("fpPairsShort")}
        </span>
      </div>

      {/* board */}
      <div
        ref={boardRef}
        className="relative flex min-h-0 w-full max-w-4xl flex-1 items-center justify-center overflow-hidden"
      >
        {config.mode === "flip" ? (
          <div
            className="grid"
            style={{
              gap: flipLayout?.gap ?? 12,
              gridTemplateColumns: `repeat(${flipLayout?.cols ?? 2}, ${flipLayout?.cardW ?? 0}px)`,
              gridAutoRows: `${flipLayout?.cardH ?? 0}px`,
            }}
          >
            {cards.map((card) => {
              const isUp = flipped.includes(card.id) || matched.has(card.pairId);
              const isMatched = matched.has(card.pairId);
              const fontSize = Math.max(11, Math.min(22, (flipLayout?.cardH ?? 60) * 0.16));
              return (
                <button
                  key={card.id}
                  disabled={phase !== "playing" || isMatched}
                  onClick={() => flipClick(card.id)}
                  style={{ fontSize }}
                  className={cn(
                    "relative flex items-center justify-center overflow-hidden rounded-xl p-2 text-center font-semibold leading-tight shadow-sm transition",
                    isMatched
                      ? "bg-success/15 text-success ring-2 ring-success"
                      : isUp
                        ? "border-2 border-primary bg-primary/10 text-text-primary"
                        : "bg-gradient-to-br from-primary to-primary-dark text-white hover:brightness-110 active:scale-95",
                  )}
                >
                  {isUp ? (
                    <span className="line-clamp-4">{card.text}</span>
                  ) : (
                    <Sparkles className="h-1/3 max-h-8 w-1/3 max-w-8 text-white/70" />
                  )}
                </button>
              );
            })}
          </div>
        ) : (
          <div className="grid h-full w-full grid-cols-2 gap-3 overflow-y-auto pb-2 pr-1 sm:gap-5">
            <Column
              title={config.leftLabel}
              cards={columns.left}
              side="left"
              matched={matched}
              picked={pickedLeft}
              wrong={null}
              onPick={matchClick}
            />
            <Column
              title={config.rightLabel}
              cards={columns.right}
              side="right"
              matched={matched}
              picked={null}
              wrong={wrong}
              onPick={matchClick}
            />
          </div>
        )}

        {/* round-clear flash */}
        {phase === "roundclear" && (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
            <div className="rounded-2xl bg-success px-6 py-3 text-lg font-extrabold text-white shadow-lg">
              {t("fpComplete")}
            </div>
          </div>
        )}

        {/* end modal (time is up) */}
        {phase === "over" && (
          <div className="absolute inset-0 z-10 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm">
            <div className="relative flex w-full max-w-sm flex-col items-center gap-4 rounded-3xl bg-surface p-7 text-center shadow-2xl">
              {onExit && (
                <button
                  onClick={goHome}
                  className="absolute right-4 top-4 rounded-full bg-background p-1.5 text-text-muted hover:bg-border"
                  aria-label={t("exit")}
                >
                  <X className="h-4 w-4" />
                </button>
              )}
              <div className="flex h-16 w-16 items-center justify-center rounded-full bg-secondary-dark text-white shadow-md">
                <Clock className="h-8 w-8" />
              </div>
              <h2 className="text-2xl font-extrabold text-text-primary">{t("colorTimeUp")}</h2>
              <div className="text-5xl font-extrabold text-primary tabular-nums">{score}</div>

              <div className="flex w-full items-center justify-around rounded-2xl bg-background px-4 py-4">
                <Stat label={t("fpRound")} value={String(round)} tone="primary" />
                <Stat label={t("matches")} value={String(found)} tone="primary" />
                <Stat label={t("time")} value={formatTime(elapsed)} tone="primary" />
              </div>

              <div className="flex w-full flex-col gap-2.5">
                <button
                  onClick={restart}
                  className="inline-flex w-full items-center justify-center gap-2 rounded-2xl bg-primary px-5 py-3.5 font-bold text-white shadow-sm hover:bg-primary-dark"
                >
                  <RotateCcw className="h-5 w-5" /> {t("playAgain")}
                </button>
                {onExit && (
                  <button
                    onClick={goHome}
                    className="inline-flex w-full items-center justify-center gap-2 rounded-2xl bg-background px-5 py-3.5 font-bold text-text-primary hover:bg-border"
                  >
                    <Home className="h-5 w-5" /> {t("colorHome")}
                  </button>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function Stat({
  label,
  value,
  tone = "default",
  className,
}: {
  label: string;
  value: string;
  tone?: "default" | "primary" | "error";
  className?: string;
}) {
  return (
    <div className={cn("text-center", className)}>
      <div
        className={cn(
          "text-lg font-extrabold tabular-nums",
          tone === "primary" && "text-primary",
          tone === "error" && "text-error",
          tone === "default" && "text-text-primary",
        )}
      >
        {value}
      </div>
      <div className="text-xs font-medium uppercase tracking-wide text-text-muted">{label}</div>
    </div>
  );
}

function Column({
  title,
  cards,
  side,
  matched,
  picked,
  wrong,
  onPick,
}: {
  title: string;
  cards: Card[];
  side: "left" | "right";
  matched: Set<string>;
  picked: string | null;
  wrong: string | null;
  onPick: (side: "left" | "right", card: Card) => void;
}) {
  return (
    <div className="space-y-2">
      <p className="mb-1 text-center text-xs font-bold uppercase tracking-wide text-text-muted">
        {title}
      </p>
      {cards.map((card) => {
        const isMatched = matched.has(card.pairId);
        const isPicked = picked === card.id;
        const isWrong = wrong === card.id;
        return (
          <button
            key={card.id}
            disabled={isMatched}
            onClick={() => onPick(side, card)}
            className={cn(
              "flex w-full items-center justify-center rounded-xl px-3 py-3 text-center text-sm font-semibold shadow-sm transition",
              isMatched
                ? "bg-success/15 text-success ring-1 ring-success"
                : isWrong
                  ? "bg-error/15 text-error ring-2 ring-error"
                  : isPicked
                    ? "bg-primary text-white ring-2 ring-primary"
                    : "bg-surface text-text-primary ring-1 ring-border hover:ring-primary/50 active:scale-[0.98]",
            )}
          >
            <span className="line-clamp-3">{card.text}</span>
          </button>
        );
      })}
    </div>
  );
}
