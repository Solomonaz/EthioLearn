"use client";

import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { Caveat } from "next/font/google";
import { useTranslations } from "next-intl";
import {
  Atom, BookOpen, Zap, Bone, Box, Calculator, Check, Clock, Cog, Droplet, FlaskConical, Globe, Heart,
  CircleHelp, Leaf, Lightbulb, Magnet, Microscope, MoveRight, Ruler, Scale, Star, Sun, Target, Truck, X,
  Shield, Flame, Snowflake, Eye, Brain, Coins, Car, House, Sprout, Wind, Mountain, Users, Utensils, Music,
  Pause, Play, RotateCcw, SkipForward, Volume2, VolumeX, PenLine, MessageSquare, ArrowLeft,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { MathText } from "@/components/ui/math-text";
import { GuideMascot, type MascotExpression } from "@/components/student/guide-mascot";
import { primeSpeech, probeCloud, synth, VoiceTrack } from "@/components/student/voice-player";
import {
  lessonScript,
  type BoardColor,
  type BoardIcon,
  type LessonKind,
  type LessonPayload,
  type ScriptLine,
} from "@/lib/whiteboard-lesson";

export { primeSpeech };

const hand = Caveat({ subsets: ["latin"], weight: ["500", "700"], display: "swap" });

/**
 * Whiteboard Tutor: the Abugida guide reacts, then explains on a whiteboard —
 * the app writes the AI's short structured lesson line by line, draws a fixed
 * icon beside each line, and reads every line aloud under live subtitles.
 *
 * Two sources, same player:
 *  - a wrong quiz answer: POST /api/ai/why-wrong { format: "whiteboard" };
 *  - a photo or PDF the student sent: POST /api/ai/whiteboard-upload.
 * Both keep every AI-tutor rule (Pro, daily allowance, rate limit, CSRF).
 *
 * Voice: the service an admin picked (Azure / Gemini / ElevenLabs, via
 * POST /api/ai/tts with the server-signed line), else the browser's own voice
 * — one voice for the whole lesson (see voice-player).
 * Lessons are kept in this browser so reopening one never spends another
 * Whiteboard lesson from the daily allowance.
 */

const ICONS: Record<BoardIcon, LucideIcon> = {
  heart: Heart, bone: Bone, truck: Truck, box: Box, bulb: Lightbulb, atom: Atom, flask: FlaskConical,
  leaf: Leaf, cell: Microscope, sun: Sun, drop: Droplet, bolt: Zap, magnet: Magnet, globe: Globe,
  book: BookOpen, scale: Scale, clock: Clock, gear: Cog, ruler: Ruler, calculator: Calculator,
  target: Target, star: Star, check: Check, cross: X, question: CircleHelp, arrow: MoveRight,
  shield: Shield, flame: Flame, snowflake: Snowflake, eye: Eye, brain: Brain, coins: Coins, car: Car,
  house: House, sprout: Sprout, wind: Wind, mountain: Mountain, people: Users, food: Utensils, music: Music,
};

const INK: Record<BoardColor, string> = {
  red: "#D32F2F", green: "#2E7D32", blue: "#1565C0", orange: "#E65100", purple: "#6A1B9A", black: "#263238",
};

/* ── Lesson cache (this browser) ────────────────────────────────── */

const CACHE_INDEX = "wb-lessons";

/** What a lesson is about; the key identifies it in this browser. */
export type LessonRequest =
  | { kind: "mistake"; quizId: string; questionId: string }
  /** About a file the student uploaded (see /api/study-uploads/[id]/act). */
  | { kind: "study"; uploadId: string; action: "explain" | "summarize"; target: string | null }
  /** A practice question from that file the student just got wrong. */
  | { kind: "practice"; uploadId: string; set: string; index: number; picked: number };

export function requestKey(r: LessonRequest): string {
  if (r.kind === "mistake") return `wb-lesson-${r.quizId}-${r.questionId}`;
  if (r.kind === "practice") return `wb-practice-${r.uploadId}-${r.set}-${r.index}-${r.picked}`;
  return `wb-study-${r.uploadId}-${r.action}-${(r.target ?? "").trim().toLowerCase().slice(0, 200)}`;
}

interface Cached {
  payload: LessonPayload;
  /** The AI tutor chat on this question's chapter. */
  followUpHref?: string;
}

function readCached(key: string): Cached | null {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const c = JSON.parse(raw) as Partial<Cached> & { lesson?: LessonPayload["lesson"] };
    if (c.payload?.lesson?.steps) return c as Cached;
    // Saved before voices: browser voice only.
    if (c.lesson?.steps) return { payload: { lesson: c.lesson, kind: "mistake", seed: 0, tokens: [] }, followUpHref: c.followUpHref };
    return null;
  } catch {
    return null;
  }
}

function writeCached(key: string, entry: Cached) {
  try {
    localStorage.setItem(key, JSON.stringify(entry));
    const index = (JSON.parse(localStorage.getItem(CACHE_INDEX) || "[]") as string[]).filter((k) => k !== key);
    index.push(key);
    while (index.length > 40) localStorage.removeItem(index.shift()!);
    localStorage.setItem(CACHE_INDEX, JSON.stringify(index));
  } catch {
    /* storage unavailable */
  }
}

/**
 * One request per lesson at a time: a second caller (React's dev double
 * mount, a double tap) shares the first request instead of spending another
 * Whiteboard lesson from the daily allowance.
 */
const inflight = new Map<string, Promise<{ ok: boolean; json: Record<string, unknown> }>>();
function requestLesson(r: LessonRequest) {
  const key = requestKey(r);
  let p = inflight.get(key);
  if (!p) {
    p = fetch(r.kind === "mistake" ? "/api/ai/why-wrong" : `/api/study-uploads/${encodeURIComponent(r.uploadId)}/act`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(
        r.kind === "mistake"
          ? { quizId: r.quizId, questionId: r.questionId, format: "whiteboard" }
          : r.kind === "practice"
            ? { action: "explainPractice", set: r.set, index: r.index, picked: r.picked }
            : { action: r.action, target: r.target },
      ),
    })
      .then(async (res) => ({ ok: res.ok, json: await res.json().catch(() => ({})) }))
      .finally(() => inflight.delete(key));
    inflight.set(key, p);
  }
  return p;
}

const LESSON_KINDS: LessonKind[] = ["mistake", "upload", "practice"];

function toPayload(r: LessonRequest, json: Record<string, unknown>): LessonPayload {
  const kind = LESSON_KINDS.includes(json.kind as LessonKind)
    ? (json.kind as LessonKind)
    : r.kind === "study"
      ? "upload"
      : r.kind === "practice"
        ? "practice"
        : "mistake";
  return {
    lesson: json.lesson as LessonPayload["lesson"],
    kind,
    style: json.style as LessonPayload["style"],
    seed: typeof json.seed === "number" ? json.seed : 0,
    tokens: Array.isArray(json.tokens) ? (json.tokens as string[]) : [],
  };
}

/* ── Board pieces ───────────────────────────────────────────────── */

/** Words appear one after another, as if written. Lines with maths fade in whole. */
function Written({ text, delay = 0 }: { text: string; delay?: number }) {
  if (text.includes("$") || text.includes("\\(")) {
    return (
      <span className="wb-word" style={{ animationDelay: `${delay}ms` }}>
        <MathText text={text} />
      </span>
    );
  }
  const words = text.split(/(\s+)/);
  let n = 0;
  return (
    <>
      {words.map((w, i) =>
        /^\s+$/.test(w) ? (
          <Fragment key={i}>{w}</Fragment>
        ) : (
          <span key={i} className="wb-word" style={{ animationDelay: `${delay + n++ * 110}ms` }}>
            {w}
          </span>
        ),
      )}
    </>
  );
}

function BoardIconDrawn({ icon, color, size = 40 }: { icon: BoardIcon | null; color: string; size?: number }) {
  if (!icon) return null;
  const Icon = ICONS[icon];
  return (
    <span className="wb-draw inline-flex shrink-0" style={{ color }}>
      <Icon width={size} height={size} strokeWidth={2.2} absoluteStrokeWidth={false} />
    </span>
  );
}

function Mark({ kind }: { kind: "wrong" | "right" | "note" }) {
  if (kind === "note") return null;
  return (
    <svg viewBox="0 0 32 32" className="wb-draw ml-1 inline-block h-7 w-7 shrink-0 align-middle" aria-hidden>
      {kind === "wrong" ? (
        <g stroke={INK.red} strokeWidth={3.5} strokeLinecap="round" fill="none">
          <path d="M7 7 Q16 15 25 25" style={{ animationDelay: "0.5s" }} />
          <path d="M25 7 Q15 16 7 25" style={{ animationDelay: "0.8s" }} />
        </g>
      ) : (
        <path d="M5 17 Q10 21 13 26 Q19 13 28 6" stroke={INK.green} strokeWidth={3.5} strokeLinecap="round" fill="none" style={{ animationDelay: "0.5s" }} />
      )}
    </svg>
  );
}

/* ── The overlay ────────────────────────────────────────────────── */

export function WhiteboardTutor({
  request,
  questionNumber,
  studentAnswer,
  onClose,
  followUpHref: followUpHrefProp,
  inline = false,
  closeLabel,
}: {
  /** Inline: the label of the way back (defaults to "Back to options" / "Something else"). */
  closeLabel?: string;
  request: LessonRequest;
  /** Render inside the page (the two-pane study view) instead of as an overlay. */
  inline?: boolean;
  /** Shown as "Question N" in the header when known. */
  questionNumber?: number;
  studentAnswer?: string;
  onClose: () => void;
  followUpHref?: string;
}) {
  const t = useTranslations("whiteboard");
  const [mounted, setMounted] = useState(false);
  const [payload, setPayload] = useState<LessonPayload | null>(null);
  const [followUpHref, setFollowUpHref] = useState<string | undefined>(followUpHrefProp);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [bi, setBi] = useState(0);
  const [playing, setPlaying] = useState(true);
  const [speaking, setSpeaking] = useState(false);
  const [voiceOn, setVoiceOn] = useState(true);
  const [cloud, setCloud] = useState<boolean | null>(null);
  /** This lesson's one voice (settled by its first line). */
  const track = useRef(new VoiceTrack());
  const boardEnd = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const key = requestKey(request);

  useEffect(() => {
    setMounted(true);
    // Voices load asynchronously in Chrome.
    synth()?.getVoices();
    probeCloud().then(setCloud);
    const prev = document.body.style.overflow;
    if (!inline) document.body.style.overflow = "hidden";
    return () => {
      if (!inline) document.body.style.overflow = prev;
      synth()?.cancel();
    };
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const cached = readCached(key);
    if (cached) {
      setPayload(cached.payload);
      if (!followUpHrefProp && cached.followUpHref) setFollowUpHref(cached.followUpHref);
      setLoading(false);
      return;
    }
    try {
      const { ok, json } = (await requestLesson(request)) as {
        ok: boolean;
        json: Partial<LessonPayload> & { error?: string; textbookId?: string; chapterId?: string };
      };
      if (!ok || !json.lesson) {
        setError(json.error || t("error"));
        return;
      }
      const p = toPayload(request, json as Record<string, unknown>);
      const chat =
        json.textbookId && json.chapterId
          ? `/student/tutor?book=${encodeURIComponent(json.textbookId)}&chapter=${encodeURIComponent(json.chapterId)}`
          : undefined;
      writeCached(key, { payload: p, followUpHref: chat });
      setPayload(p);
      if (!followUpHrefProp && chat) setFollowUpHref(chat);
    } catch {
      setError(t("error"));
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, followUpHrefProp, t]);

  useEffect(() => {
    load();
  }, [load]);

  const lesson = payload?.lesson ?? null;
  const beats = useMemo<ScriptLine[]>(
    () => (payload ? lessonScript(payload.lesson, payload.seed, payload.kind, payload.style) : []),
    [payload],
  );
  const beat = beats[bi];
  const atEnd = beats.length > 0 && bi === beats.length - 1 && !playing;

  // With a voice service, settle the lesson's voice on its first line, then
  // fetch every other line in that voice: each takes a few seconds to make,
  // so lines then follow without pauses.
  useEffect(() => {
    if (!cloud || !voiceOn || !payload || beats.length === 0) return;
    track.current.start(beats[0].say, payload.tokens[0]);
    beats.forEach((b, i) => track.current.prefetch(b.say, payload.tokens[i]));
  }, [cloud, voiceOn, beats, payload]);

  // The runner: speak the current line, then move on.
  useEffect(() => {
    if (!beat || !playing) return;
    if (voiceOn && cloud === null) return; // still asking whether a voice service is set up
    setSpeaking(true);
    let gap: ReturnType<typeof setTimeout> | undefined;
    const done = () => {
      setSpeaking(false);
      gap = setTimeout(() => {
        if (bi < beats.length - 1) setBi(bi + 1);
        else setPlaying(false);
      }, beat.kind === "react" ? 300 : 550);
    };
    // The lesson's voice settles on its FIRST line, even when playback starts later on.
    if (voiceOn && cloud && payload) track.current.start(beats[0].say, payload.tokens[0]);
    const cancel = track.current.say(beat.say, payload?.tokens[bi], voiceOn, done);
    return () => {
      cancel();
      if (gap) clearTimeout(gap);
      setSpeaking(false);
    };
  }, [beat, bi, beats, playing, voiceOn, cloud, payload]);

  // Keep the newest line in view.
  useEffect(() => {
    boardEnd.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [bi]);
  // When the lesson ends, show the whole board from the top for review.
  const boardScroll = useRef<HTMLDivElement>(null);
  const finished = beats.length > 0 && bi === beats.length - 1 && !playing;
  useEffect(() => {
    if (finished) boardScroll.current?.scrollTo({ top: 0, behavior: "smooth" });
  }, [finished]);

  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onCloseRef.current();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  useEffect(() => {
    if (mounted && !inline) closeRef.current?.focus();
  }, [mounted, inline]);

  if (!mounted) return null;

  const hasVoice = !!synth() || !!cloud;

  // What the board shows so far.
  const beatIndexOf = (pred: (b: ScriptLine) => boolean) => beats.findIndex(pred);
  const titleAt = beatIndexOf((b) => b.kind === "title");
  const analogyAt = beatIndexOf((b) => b.kind === "analogy");
  const tipAt = beatIndexOf((b) => b.kind === "tip");
  const stepAt = (i: number) => beatIndexOf((b) => b.kind === "step" && b.index === i);
  const onBoard = titleAt >= 0 && bi >= titleAt;
  const expr: MascotExpression = loading ? "thinking" : error ? "concerned" : beat?.expr ?? "happy";

  const replay = () => {
    setBi(0);
    setPlaying(true);
  };
  const next = () => {
    if (bi < beats.length - 1) {
      setBi(bi + 1);
      setPlaying(true);
    }
  };

  const iconBtn = cn(
    "flex shrink-0 items-center justify-center rounded-full border border-border text-text-secondary hover:bg-border/40 disabled:opacity-40",
    inline ? "h-8 w-8" : "h-10 w-10",
  );
  const playback = (
    <>
      <button type="button" onClick={replay} className={iconBtn} aria-label={t("replay")}>
        <RotateCcw className="h-4 w-4" />
      </button>
      <button
        type="button"
        onClick={() => setPlaying((p) => !p)}
        className={cn("flex shrink-0 items-center justify-center rounded-full bg-primary text-white shadow hover:bg-primary-dark", inline ? "h-9 w-9" : "h-12 w-12")}
        aria-label={playing ? t("pause") : t("play")}
        data-testid="wb-playpause"
      >
        {playing ? <Pause className="h-5 w-5" /> : <Play className="h-5 w-5" />}
      </button>
      <button type="button" onClick={next} className={iconBtn} aria-label={t("next")} data-testid="wb-next">
        <SkipForward className="h-4 w-4" />
      </button>
      <button
        type="button"
        onClick={() => setVoiceOn((v) => !v)}
        disabled={!hasVoice}
        className={iconBtn}
        aria-label={voiceOn ? t("voiceOff") : t("voiceOn")}
        title={hasVoice ? undefined : t("noVoice")}
        data-testid="wb-voice"
      >
        {voiceOn ? <Volume2 className="h-4 w-4" /> : <VolumeX className="h-4 w-4" />}
      </button>
    </>
  );
  const endButtons = (
    <>
      <button
        type="button"
        onClick={replay}
        className={cn("inline-flex items-center gap-1.5 rounded-full border border-border font-semibold text-text-secondary hover:bg-border/40", inline ? "px-3 py-1.5 text-xs" : "px-4 py-2 text-sm")}
      >
        <RotateCcw className="h-4 w-4" /> {t("replay")}
      </button>
      {followUpHref && (
        <Link
          href={followUpHref}
          className={cn("inline-flex items-center gap-1.5 rounded-full border border-primary/40 font-semibold text-primary hover:bg-primary/5", inline ? "px-3 py-1.5 text-xs" : "px-4 py-2 text-sm")}
        >
          <MessageSquare className="h-4 w-4" /> {t("askMore")}
        </Link>
      )}
      <button
        type="button"
        onClick={onClose}
        className={cn("rounded-full bg-primary font-bold text-white hover:bg-primary-dark", inline ? "px-3 py-1.5 text-xs" : "px-5 py-2 text-sm")}
        data-testid="wb-done"
      >
        {inline ? closeLabel ?? t("somethingElse") : t("gotIt")}
      </button>
    </>
  );
  const subtitle = (
    <div
      className={cn(
        "flex items-center justify-center text-center font-medium leading-snug text-white",
        inline
          ? "pointer-events-none absolute bottom-2 left-2 right-[92px] min-h-[2.75rem] rounded-xl bg-black/75 px-3 py-1.5 text-sm backdrop-blur-sm sm:right-[100px]"
          : "min-h-[3.25rem] rounded-xl bg-black/85 px-4 py-2 text-[15px]",
      )}
      aria-live="polite"
      data-testid="wb-subtitle"
    >
      {beat?.say}
    </div>
  );

  const header = (
    <div className={cn("flex items-center gap-2 border-b border-border", inline ? "px-3 py-1.5" : "px-4 py-3")}>
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
        <PenLine className="h-4 w-4" />
      </span>
      <p className={cn("min-w-0 flex-1 truncate text-sm font-bold text-text-primary", inline && "hidden sm:block")}>
        {t("title")}
        {questionNumber ? (
          <span className="font-medium text-text-secondary"> · {t("questionN", { n: questionNumber })}</span>
        ) : request.kind === "practice" ? (
          <span className="font-medium text-text-secondary"> · {t("practiceQuestionN", { n: request.index + 1 })}</span>
        ) : request.kind !== "mistake" ? (
          <span className="font-medium text-text-secondary"> · {t("yourUpload")}</span>
        ) : null}
      </p>
      {speaking && voiceOn && (
        <span className="wb-talkbars flex h-4 items-center gap-0.5 text-primary" aria-label={t("speaking")}>
          <span /><span /><span /><span />
        </span>
      )}
      {/* Inline: the controls live in this one slim bar, leaving the pane to the board. */}
      {inline && lesson && !error && (
        <div className="ml-auto flex items-center gap-1.5 sm:ml-0">{finished ? endButtons : playback}</div>
      )}
      <button
        ref={closeRef}
        type="button"
        onClick={onClose}
        className="flex h-9 items-center justify-center gap-1 rounded-full px-2 text-sm font-semibold text-text-secondary hover:bg-border/50"
        aria-label={inline ? closeLabel ?? t("backToOptions") : t("close")}
        data-testid="wb-close"
      >
        {inline ? (
          <>
            <ArrowLeft className="h-4 w-4" /> <span className="hidden sm:inline">{closeLabel ?? t("backToOptions")}</span>
          </>
        ) : (
          <X className="h-5 w-5" />
        )}
      </button>
    </div>
  );

  let body: React.ReactNode;
  if (loading || error || !lesson) {
    body = (
      <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-4 overflow-y-auto px-6 py-6 text-center">
        <GuideMascot expression={expr} size={140} className="h-[clamp(90px,22dvh,140px)] w-auto" />
        <p className="max-w-xs text-base font-medium text-text-primary">{error ?? t("loading")}</p>
        {error && (
          <div className="flex gap-2">
            <button type="button" onClick={load} className="rounded-full bg-primary px-4 py-2 text-sm font-semibold text-white hover:bg-primary-dark">
              {t("tryAgain")}
            </button>
            <button type="button" onClick={onClose} className="rounded-full border border-border px-4 py-2 text-sm font-semibold text-text-secondary hover:bg-border/40">
              {t("close")}
            </button>
          </div>
        )}
      </div>
    );
  } else if (!onBoard) {
    // The reaction: the guide, big, with a speech bubble.
    body = (
      <div className={cn("flex min-h-0 flex-1 flex-col items-center justify-center gap-3 overflow-y-auto px-6 py-4 text-center", inline && "pb-16")} data-testid="wb-reaction">
        <div key={bi} className="wb-pop relative max-w-xs rounded-2xl border-2 border-text-primary/80 bg-surface px-5 py-3 shadow-md">
          <p className={cn(hand.className, "text-3xl font-bold leading-tight text-text-primary")}>{beat?.say}</p>
          <span className="absolute -bottom-2.5 left-1/2 h-4 w-4 -translate-x-1/2 rotate-45 border-b-2 border-r-2 border-text-primary/80 bg-surface" />
        </div>
        <GuideMascot
          expression={expr}
          talking={speaking && beat?.expr !== "shocked"}
          size={170}
          className="h-[clamp(96px,26dvh,170px)] w-auto shrink-0"
        />
        {studentAnswer && payload?.kind !== "upload" && (
          <p className="max-w-full truncate text-sm text-text-secondary">
            {t("youAnswered")}{" "}
            <span className="font-semibold text-error line-through">
              <MathText text={studentAnswer} />
            </span>
          </p>
        )}
      </div>
    );
  } else {
    body = (
      <div className={cn("relative flex min-h-0 flex-1 flex-col", inline ? "p-2" : "px-3 pt-3")}>
        {/* the whiteboard: stays a light board in dark mode, like a real one */}
        <div className={cn("relative min-h-0 flex-1 overflow-hidden rounded-2xl bg-[#FBFBF7] shadow-inner", inline ? "border-4" : "border-[6px]", "border-[#C5CAD3] dark:border-[#59616E]")}>
          <div ref={boardScroll} className={cn(hand.className, "h-full overflow-y-auto px-4 pb-4 pt-4 text-[1.55rem] leading-snug text-[#263238] sm:px-6 sm:text-[1.8rem]")} data-testid="wb-board">
            <h3 className="mb-3 inline-block text-[2rem] font-bold sm:text-[2.3rem]">
              <Written text={lesson.title} />
              <svg viewBox="0 0 200 10" preserveAspectRatio="none" className="wb-draw block h-2.5 w-full" aria-hidden>
                <path d="M2 6 Q50 1 100 6 T198 5" stroke={INK.blue} strokeWidth={3} fill="none" strokeLinecap="round" style={{ animationDelay: "0.4s" }} />
              </svg>
            </h3>
            <div className="space-y-3">
              {lesson.steps.map((s, i) =>
                bi >= stepAt(i) ? (
                  <div key={i} className="flex items-start gap-3" style={{ color: INK[s.color] }} data-testid="wb-step">
                    <BoardIconDrawn icon={s.icon} color={INK[s.color]} />
                    <p className="min-w-0 flex-1 font-bold">
                      <Written text={s.board} />
                      {s.emoji && <span className="wb-word ml-1" style={{ animationDelay: "0.9s" }}>{s.emoji}</span>}
                      <Mark kind={s.mark} />
                    </p>
                  </div>
                ) : null,
              )}
              {analogyAt >= 0 && bi >= analogyAt && (
                <div className="wb-pop mt-4 flex items-center gap-3 rounded-xl border-[3px] border-dashed border-[#E65100]/70 px-3 py-2 text-[#E65100]" data-testid="wb-analogy">
                  <BoardIconDrawn icon={lesson.analogy.icon} color={INK.orange} size={44} />
                  <p className="min-w-0 flex-1 font-bold">
                    <Written text={lesson.analogy.board} />
                    {lesson.analogy.emoji && <span className="wb-word ml-1" style={{ animationDelay: "0.8s" }}>{lesson.analogy.emoji}</span>}
                  </p>
                </div>
              )}
              {tipAt >= 0 && bi >= tipAt && (
                <p className="wb-pop mt-4 font-bold text-[#6A1B9A]">
                  <span className="rounded bg-[#FFF176]/80 px-1.5">★ <Written text={lesson.tip} /></span>
                </p>
              )}
            </div>
            {/* room under the last line, so it never hides behind the guide */}
            <div ref={boardEnd} className={inline ? "h-24" : "h-20"} />
          </div>
          {/* the guide keeps reacting from the corner */}
          <div className="pointer-events-none absolute bottom-1 right-1 sm:bottom-2 sm:right-2" data-testid="wb-mascot">
            <GuideMascot expression={expr} talking={speaking} size={84} />
          </div>
          {inline && subtitle}
        </div>
      </div>
    );
  }

  const controls = lesson && !error && (
    <div className="space-y-2 px-3 pb-3 pt-2">
      {subtitle}
      <div className="flex flex-wrap items-center justify-center gap-2">{atEnd ? endButtons : playback}</div>
    </div>
  );

  if (inline) {
    // Before the board appears (the reaction), subtitles float at the bottom too.
    return (
      <div className="flex h-full min-h-0 w-full flex-col overflow-hidden rounded-2xl border border-border bg-surface" data-testid="whiteboard-tutor">
        {header}
        <div className="relative flex min-h-0 flex-1 flex-col">
          {body}
          {lesson && !error && !onBoard && subtitle}
        </div>
      </div>
    );
  }

  return createPortal(
    <div
      className="fixed inset-0 z-[70] flex items-stretch justify-center bg-black/60 sm:items-center sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-label={t("title")}
      onClick={(e) => e.target === e.currentTarget && onClose()}
      data-testid="whiteboard-tutor"
    >
      <div className="flex h-[100dvh] w-full flex-col overflow-hidden bg-surface shadow-2xl sm:h-[min(44rem,92dvh)] sm:max-w-2xl sm:rounded-3xl">
        {header}
        {body}
        {controls}
      </div>
    </div>,
    document.body,
  );
}
