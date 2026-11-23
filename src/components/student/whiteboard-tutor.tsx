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
  Pause, Play, RotateCcw, SkipForward, Volume2, VolumeX, PenLine, MessageSquare,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { MathText } from "@/components/ui/math-text";
import { GuideMascot, type MascotExpression } from "@/components/student/guide-mascot";
import {
  lessonScript,
  type BoardColor,
  type BoardIcon,
  type LessonPayload,
  type ScriptLine,
} from "@/lib/whiteboard-lesson";

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
 * POST /api/ai/tts with the server-signed line), else the browser's own voice.
 * Lessons are kept in this browser so reopening one never spends another
 * tutor message.
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

const MAX_TTS_CHARS = 320; // matches lib/tts

/* ── Browser speech ─────────────────────────────────────────────── */

function synth(): SpeechSynthesis | null {
  return typeof window !== "undefined" && "speechSynthesis" in window ? window.speechSynthesis : null;
}

function pickVoice(): SpeechSynthesisVoice | null {
  const s = synth();
  if (!s) return null;
  const en = s.getVoices().filter((v) => /^en[-_]/i.test(v.lang) || v.lang === "en");
  // A friendly, clear voice first; device voices vary a lot.
  const prefer = [
    /natural/i, /google us english/i, /samantha/i, /aria|jenny|zira/i, /google uk english female/i,
    /hazel|susan|libby|sonia|karen|moira|tessa|female/i, /en[-_]us/i,
  ];
  for (const re of prefer) {
    const v = en.find((x) => re.test(x.name) || re.test(x.lang));
    if (v) return v;
  }
  return en[0] ?? null;
}

/* Cloud-voice audio plays through Web Audio, not an <audio> element: it
   decodes MP3 and WAV everywhere (some embedded browsers can't play <audio>
   at all), and phones allow it once the context is resumed inside a tap. */
let ctxSingleton: AudioContext | null = null;
function audioCtx(): AudioContext | null {
  if (typeof window === "undefined") return null;
  if (!ctxSingleton) {
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return null;
    ctxSingleton = new AC();
  }
  return ctxSingleton;
}

/**
 * Call from the click that opens the whiteboard: mobile browsers only let a
 * page speak or play sound after it has done so once inside a tap.
 */
export function primeSpeech() {
  try {
    const s = synth();
    if (s) {
      const u = new SpeechSynthesisUtterance(" ");
      u.volume = 0;
      s.speak(u);
    }
    audioCtx()?.resume().catch(() => {});
  } catch {
    /* ignore */
  }
}

/** Read a line with the browser voice (or just wait as long as it would take). */
function browserLine(text: string, voiceOn: boolean, onDone: () => void): () => void {
  const words = text.split(/\s+/).filter(Boolean).length;
  const estimate = Math.max(1700, words * 390);
  let finished = false;
  const timers: ReturnType<typeof setTimeout>[] = [];
  const finish = () => {
    if (finished) return;
    finished = true;
    timers.forEach(clearTimeout);
    onDone();
  };
  const s = synth();
  if (!voiceOn || !s || !text.trim()) {
    timers.push(setTimeout(finish, estimate));
  } else {
    s.cancel();
    const u = new SpeechSynthesisUtterance(text);
    const v = pickVoice();
    if (v) u.voice = v;
    u.lang = v?.lang ?? "en-US";
    u.rate = 1;
    u.pitch = 1.15;
    u.onend = finish;
    u.onerror = finish;
    // Chrome sometimes drops an utterance queued right after cancel().
    timers.push(setTimeout(() => !finished && s.speak(u), 60));
    // Some engines never fire onend; never get stuck on a line.
    timers.push(setTimeout(finish, estimate * 2.5 + 3000));
  }
  return () => {
    finished = true;
    timers.forEach(clearTimeout);
    if (voiceOn) synth()?.cancel();
  };
}

/* ── Cloud voice (admin-chosen service) ─────────────────────────── */

/** Audio for each line of the current lesson, fetched (and decoded) ahead of time. */
type AudioCache = Map<number, Promise<AudioBuffer | null>>;

/** Lines already fetched this visit (by token), so a replay doesn't ask again. */
const lineAudio = new Map<string, Promise<AudioBuffer | null>>();

function fetchLineAudio(text: string, token: string): Promise<AudioBuffer | null> {
  const ctx = audioCtx();
  if (!ctx) return Promise.resolve(null);
  const hit = lineAudio.get(token);
  if (hit) return hit;
  const p = fetch("/api/ai/tts", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text: text.slice(0, MAX_TTS_CHARS), token }),
  })
    .then(async (res) => (res.status === 200 ? ctx.decodeAudioData(await res.arrayBuffer()) : null))
    .catch(() => null)
    .then((buf) => {
      if (!buf) lineAudio.delete(token); // let a later play try again
      return buf;
    });
  lineAudio.set(token, p);
  // Keep memory bounded: forget the oldest lines.
  while (lineAudio.size > 80) lineAudio.delete(lineAudio.keys().next().value!);
  return p;
}

/**
 * Play a line with the cloud voice when its audio arrived, else hand over to
 * the browser voice (`onFallback`). Returns a cancel.
 */
function cloudLine(
  audioP: Promise<AudioBuffer | null>,
  onDone: () => void,
  onFallback: () => () => void,
): () => void {
  let cancelled = false;
  let fallbackCancel: (() => void) | null = null;
  let safety: ReturnType<typeof setTimeout> | undefined;
  let node: AudioBufferSourceNode | null = null;
  const finish = () => {
    if (cancelled) return;
    cancelled = true;
    if (safety) clearTimeout(safety);
    onDone();
  };
  audioP.then(async (buf) => {
    if (cancelled) return;
    const ctx = audioCtx();
    if (ctx && ctx.state !== "running") await ctx.resume().catch(() => {});
    if (cancelled) return;
    if (!buf || !ctx || ctx.state !== "running") {
      fallbackCancel = onFallback();
      return;
    }
    node = ctx.createBufferSource();
    node.buffer = buf;
    node.connect(ctx.destination);
    node.onended = finish;
    node.start();
    // Never get stuck on a line if "ended" doesn't arrive.
    safety = setTimeout(finish, buf.duration * 1000 + 3000);
  });
  return () => {
    cancelled = true;
    if (safety) clearTimeout(safety);
    if (node) {
      node.onended = null;
      try {
        node.stop();
      } catch {
        /* already stopped */
      }
    }
    fallbackCancel?.();
  };
}

/* ── Lesson cache (this browser) ────────────────────────────────── */

const CACHE_INDEX = "wb-lessons";
const UPLOADS_INDEX = "wb-uploads";

/** What a lesson is about; the key identifies it in this browser. */
export type LessonRequest =
  | { kind: "mistake"; quizId: string; questionId: string }
  | { kind: "upload"; key: string; file: string; mimeType: string; note: string }
  /** A lesson already in this browser (e.g. a past upload). */
  | { kind: "saved"; key: string };

export function requestKey(r: LessonRequest): string {
  return r.kind === "mistake" ? `wb-lesson-${r.quizId}-${r.questionId}` : `wb-lesson-${r.key}`;
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

/** Past uploads, newest first, for the "replay" list. */
export interface SavedUpload {
  key: string;
  title: string;
  at: number;
}
export function savedUploads(): SavedUpload[] {
  try {
    const list = JSON.parse(localStorage.getItem(UPLOADS_INDEX) || "[]") as SavedUpload[];
    return list.filter((u) => localStorage.getItem(`wb-lesson-${u.key}`));
  } catch {
    return [];
  }
}
function rememberUpload(u: SavedUpload) {
  try {
    const list = savedUploads().filter((x) => x.key !== u.key);
    list.unshift(u);
    localStorage.setItem(UPLOADS_INDEX, JSON.stringify(list.slice(0, 10)));
  } catch {
    /* storage unavailable */
  }
}

/**
 * One request per lesson at a time: a second caller (React's dev double
 * mount, a double tap) shares the first request instead of spending another
 * tutor message.
 */
const inflight = new Map<string, Promise<{ ok: boolean; json: Record<string, unknown> }>>();
function requestLesson(r: Exclude<LessonRequest, { kind: "saved" }>) {
  const key = requestKey(r);
  let p = inflight.get(key);
  if (!p) {
    p = fetch(r.kind === "mistake" ? "/api/ai/why-wrong" : "/api/ai/whiteboard-upload", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(
        r.kind === "mistake"
          ? { quizId: r.quizId, questionId: r.questionId, format: "whiteboard" }
          : { file: r.file, mimeType: r.mimeType, note: r.note },
      ),
    })
      .then(async (res) => ({ ok: res.ok, json: await res.json().catch(() => ({})) }))
      .finally(() => inflight.delete(key));
    inflight.set(key, p);
  }
  return p;
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

/** Whether the admin set up a voice service (asked once per page load). */
let cloudProbe: Promise<boolean> | null = null;
function probeCloud(): Promise<boolean> {
  cloudProbe ??= fetch("/api/ai/tts")
    .then((r) => (r.ok ? r.json() : { cloud: false }))
    .then((d) => !!d.cloud)
    .catch(() => false);
  return cloudProbe;
}

export function WhiteboardTutor({
  request,
  questionNumber,
  studentAnswer,
  onClose,
  followUpHref: followUpHrefProp,
}: {
  request: LessonRequest;
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
  const audioCache = useRef<AudioCache>(new Map());
  const boardEnd = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const key = requestKey(request);

  useEffect(() => {
    setMounted(true);
    // Voices load asynchronously in Chrome.
    synth()?.getVoices();
    probeCloud().then(setCloud);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const cache = audioCache.current;
    return () => {
      document.body.style.overflow = prev;
      synth()?.cancel();
      cache.clear();
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
    if (request.kind === "saved") {
      setError(t("error"));
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
      const p: LessonPayload = {
        lesson: json.lesson,
        kind: json.kind ?? (request.kind === "upload" ? "upload" : "mistake"),
        seed: json.seed ?? 0,
        tokens: Array.isArray(json.tokens) ? json.tokens : [],
      };
      const chat =
        json.textbookId && json.chapterId
          ? `/student/tutor?book=${encodeURIComponent(json.textbookId)}&chapter=${encodeURIComponent(json.chapterId)}`
          : undefined;
      writeCached(key, { payload: p, followUpHref: chat });
      if (request.kind === "upload") rememberUpload({ key: request.key, title: p.lesson.title, at: Date.now() });
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
    () => (payload ? lessonScript(payload.lesson, payload.seed, payload.kind) : []),
    [payload],
  );
  const beat = beats[bi];
  const atEnd = beats.length > 0 && bi === beats.length - 1 && !playing;

  // Fetch a line's audio ahead of time, so lines follow each other without a gap.
  const prefetch = useCallback(
    (i: number) => {
      const token = payload?.tokens[i];
      const line = beats[i];
      if (!token || !line || audioCache.current.has(i)) return;
      audioCache.current.set(i, fetchLineAudio(line.say, token));
    },
    [payload, beats],
  );

  // With a voice service, fetch every line as soon as the lesson arrives:
  // each takes a few seconds to make, so lines then follow without pauses.
  useEffect(() => {
    if (!cloud || !voiceOn) return;
    beats.forEach((_, i) => prefetch(i));
  }, [cloud, voiceOn, beats, prefetch]);

  // The runner: speak the current line, then move on.
  useEffect(() => {
    if (!beat || !playing) return;
    const useCloud = voiceOn && !!payload?.tokens[bi];
    if (useCloud && cloud === null) return; // still asking whether a voice service is set up
    setSpeaking(true);
    let gap: ReturnType<typeof setTimeout> | undefined;
    const done = () => {
      setSpeaking(false);
      gap = setTimeout(() => {
        if (bi < beats.length - 1) setBi(bi + 1);
        else setPlaying(false);
      }, beat.kind === "react" ? 300 : 550);
    };
    let cancel: () => void;
    if (useCloud && cloud) {
      prefetch(bi);
      prefetch(bi + 1);
      prefetch(bi + 2);
      cancel = cloudLine(audioCache.current.get(bi)!, done, () => browserLine(beat.say, true, done));
    } else {
      cancel = browserLine(beat.say, voiceOn, done);
    }
    return () => {
      cancel();
      if (gap) clearTimeout(gap);
      setSpeaking(false);
    };
  }, [beat, bi, beats.length, playing, voiceOn, cloud, payload, prefetch]);

  // Keep the newest line in view.
  useEffect(() => {
    boardEnd.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [bi]);

  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onCloseRef.current();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  useEffect(() => {
    if (mounted) closeRef.current?.focus();
  }, [mounted]);

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

  const header = (
    <div className="flex items-center gap-2 border-b border-border px-4 py-3">
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
        <PenLine className="h-4 w-4" />
      </span>
      <p className="min-w-0 flex-1 truncate text-sm font-bold text-text-primary">
        {t("title")}
        {questionNumber ? (
          <span className="font-medium text-text-secondary"> · {t("questionN", { n: questionNumber })}</span>
        ) : request.kind !== "mistake" ? (
          <span className="font-medium text-text-secondary"> · {t("yourUpload")}</span>
        ) : null}
      </p>
      {speaking && voiceOn && (
        <span className="wb-talkbars flex h-4 items-center gap-0.5 text-primary" aria-label={t("speaking")}>
          <span /><span /><span /><span />
        </span>
      )}
      <button
        ref={closeRef}
        type="button"
        onClick={onClose}
        className="flex h-9 w-9 items-center justify-center rounded-full text-text-secondary hover:bg-border/50"
        aria-label={t("close")}
        data-testid="wb-close"
      >
        <X className="h-5 w-5" />
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
      <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-3 overflow-y-auto px-6 py-4 text-center" data-testid="wb-reaction">
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
      <div className="relative flex min-h-0 flex-1 flex-col px-3 pt-3">
        {/* the whiteboard: stays a light board in dark mode, like a real one */}
        <div className="relative min-h-0 flex-1 overflow-hidden rounded-2xl border-[6px] border-[#C5CAD3] bg-[#FBFBF7] shadow-inner dark:border-[#59616E]">
          <div className={cn(hand.className, "h-full overflow-y-auto px-4 pb-4 pt-4 text-[1.55rem] leading-snug text-[#263238] sm:px-6 sm:text-[1.8rem]")} data-testid="wb-board">
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
            <div ref={boardEnd} className="h-20" />
          </div>
          {/* the guide keeps reacting from the corner */}
          <div className="pointer-events-none absolute bottom-1 right-1 sm:bottom-2 sm:right-2" data-testid="wb-mascot">
            <GuideMascot expression={expr} talking={speaking} size={84} />
          </div>
        </div>
      </div>
    );
  }

  const controls = lesson && !error && (
    <div className="space-y-2 px-3 pb-3 pt-2">
      {/* live subtitles */}
      <div className="flex min-h-[3.25rem] items-center justify-center rounded-xl bg-black/85 px-4 py-2 text-center text-[15px] font-medium leading-snug text-white" aria-live="polite" data-testid="wb-subtitle">
        {beat?.say}
      </div>
      {atEnd ? (
        <div className="flex flex-wrap items-center justify-center gap-2">
          <button type="button" onClick={replay} className="inline-flex items-center gap-1.5 rounded-full border border-border px-4 py-2 text-sm font-semibold text-text-secondary hover:bg-border/40">
            <RotateCcw className="h-4 w-4" /> {t("replay")}
          </button>
          {followUpHref && (
            <Link href={followUpHref} className="inline-flex items-center gap-1.5 rounded-full border border-primary/40 px-4 py-2 text-sm font-semibold text-primary hover:bg-primary/5">
              <MessageSquare className="h-4 w-4" /> {t("askMore")}
            </Link>
          )}
          <button type="button" onClick={onClose} className="rounded-full bg-primary px-5 py-2 text-sm font-bold text-white hover:bg-primary-dark" data-testid="wb-done">
            {t("gotIt")}
          </button>
        </div>
      ) : (
        <div className="flex items-center justify-center gap-2">
          <button type="button" onClick={replay} className="flex h-10 w-10 items-center justify-center rounded-full border border-border text-text-secondary hover:bg-border/40" aria-label={t("replay")}>
            <RotateCcw className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={() => setPlaying((p) => !p)}
            className="flex h-12 w-12 items-center justify-center rounded-full bg-primary text-white shadow hover:bg-primary-dark"
            aria-label={playing ? t("pause") : t("play")}
            data-testid="wb-playpause"
          >
            {playing ? <Pause className="h-5 w-5" /> : <Play className="h-5 w-5" />}
          </button>
          <button type="button" onClick={next} className="flex h-10 w-10 items-center justify-center rounded-full border border-border text-text-secondary hover:bg-border/40" aria-label={t("next")} data-testid="wb-next">
            <SkipForward className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={() => setVoiceOn((v) => !v)}
            disabled={!hasVoice}
            className="flex h-10 w-10 items-center justify-center rounded-full border border-border text-text-secondary hover:bg-border/40 disabled:opacity-40"
            aria-label={voiceOn ? t("voiceOff") : t("voiceOn")}
            title={hasVoice ? undefined : t("noVoice")}
            data-testid="wb-voice"
          >
            {voiceOn ? <Volume2 className="h-4 w-4" /> : <VolumeX className="h-4 w-4" />}
          </button>
        </div>
      )}
    </div>
  );

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
