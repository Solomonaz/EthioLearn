"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import {
  Play, Pause, SkipBack, SkipForward,
  Volume2, VolumeX, X, Clock,
} from "lucide-react";
import { cn } from "@/lib/utils";

// ─── Re-export types (mirrors gemini.ts) ─────────────────

export type TeacherEmotion = "explaining" | "pointing" | "excited" | "thinking" | "writing";
export type VisualType = "process" | "comparison" | "formula" | "timeline" | "highlight" | "diagram" | "list";

export interface VideoSlide {
  heading: string;
  narration: string;
  keyPoints: string[];
  teacherEmotion?: TeacherEmotion;
  visualType?: VisualType;
  visualData?: {
    steps?: string[];
    leftLabel?: string; leftItems?: string[];
    rightLabel?: string; rightItems?: string[];
    text?: string; subtext?: string;
    events?: { period: string; event: string }[];
  };
}

export interface VideoScript {
  title: string;
  estimatedMinutes: number;
  slides: VideoSlide[];
}

interface Props {
  script: VideoScript;
  subject: string;
  chapterTitle: string;
  onClose: () => void;
}

// ─── Accent palette (cycles per slide) ───────────────────

// Futuristic holographic palette: neon cyan, deep violet, gold
const ACCENTS = [
  { from: "from-cyan-400",   to: "to-violet-600", hex: "#22d3ee", light: "#a5f3fc" },
  { from: "from-violet-500", to: "to-fuchsia-600", hex: "#8b5cf6", light: "#ddd6fe" },
  { from: "from-amber-300",  to: "to-amber-500",  hex: "#fbbf24", light: "#fde68a" },
  { from: "from-cyan-300",   to: "to-blue-600",   hex: "#67e8f9", light: "#cffafe" },
  { from: "from-fuchsia-400",to: "to-violet-700", hex: "#e879f9", light: "#f5d0fe" },
  { from: "from-amber-400",  to: "to-orange-500", hex: "#f59e0b", light: "#fef3c7" },
];

// ─── Holographic AI Avatar ────────────────────────────────

const HOLO_COLORS = ["#22d3ee","#8b5cf6","#fbbf24","#67e8f9","#e879f9","#f59e0b"];

function TeacherCharacter({ emotion = "explaining", colorIdx = 0 }: {
  emotion?: TeacherEmotion;
  colorIdx?: number;
}) {
  const c = HOLO_COLORS[colorIdx % HOLO_COLORS.length];
  const accent = HOLO_COLORS[(colorIdx + 1) % HOLO_COLORS.length];

  // Pulse intensity per emotion
  const pulse = {
    explaining: 1,
    pointing:   1.1,
    excited:    1.4,
    thinking:   0.7,
    writing:    1.0,
  }[emotion] ?? 1;

  return (
    <div className="relative flex flex-col items-center select-none"
         style={{ width: 96, minHeight: 130 }}>

      {/* Outer rotating ring */}
      <div className="relative" style={{ width: 92, height: 92 }}>
        <div className="absolute inset-0 rounded-full border border-dashed opacity-60"
             style={{
               borderColor: c,
               animation: "holoSpin 9s linear infinite",
               boxShadow: `0 0 24px ${c}55, inset 0 0 18px ${c}33`,
             }} />
        {/* Mid ring (counter) */}
        <div className="absolute inset-2 rounded-full border opacity-40"
             style={{
               borderColor: accent,
               animation: "holoSpin 6s linear infinite reverse",
             }} />

        {/* Core orb */}
        <div className="absolute inset-4 rounded-full"
             style={{
               background: `radial-gradient(circle at 35% 30%, #ffffff 0%, ${c} 35%, ${accent} 75%, transparent 100%)`,
               boxShadow: `0 0 ${20 * pulse}px ${c}, 0 0 ${40 * pulse}px ${c}77`,
               animation: `holoPulse ${2.4 / pulse}s ease-in-out infinite`,
             }}>
          {/* Inner glint */}
          <div className="absolute rounded-full bg-white/70"
               style={{ width: 10, height: 10, top: "22%", left: "26%", filter: "blur(1px)" }} />
        </div>

        {/* Orbiting particles */}
        {[0, 1, 2].map((i) => (
          <div key={i} className="absolute inset-0"
               style={{ animation: `holoSpin ${4 + i}s linear infinite`, animationDelay: `${i * -1}s` }}>
            <div className="absolute rounded-full"
                 style={{
                   width: 5, height: 5,
                   left: "50%", top: i % 2 ? "8%" : "88%",
                   transform: "translateX(-50%)",
                   background: i === 1 ? "#fbbf24" : c,
                   boxShadow: `0 0 8px ${i === 1 ? "#fbbf24" : c}`,
                 }} />
          </div>
        ))}
      </div>

      {/* Holo-base pedestal */}
      <div className="mt-1 flex flex-col items-center gap-0.5">
        <div className="rounded-full"
             style={{
               width: 60, height: 4,
               background: `linear-gradient(90deg, transparent, ${c}, transparent)`,
               boxShadow: `0 0 12px ${c}`,
             }} />
        <div className="rounded-full opacity-60"
             style={{
               width: 44, height: 2,
               background: `linear-gradient(90deg, transparent, ${accent}, transparent)`,
             }} />
        <div className="rounded-full opacity-30"
             style={{ width: 28, height: 1.5, background: c }} />
      </div>

      {/* Status label */}
      <p className="mt-1 font-mono text-[8px] uppercase tracking-[0.18em]"
         style={{ color: c, textShadow: `0 0 6px ${c}99` }}>
        AI · {emotion}
      </p>
    </div>
  );
}


// ─── Motion helpers ──────────────────────────────────────
//
// Every visual below animates from the TEMPLATE's own timing, never from data
// the model produced. The AI writes text; the layout decides where that text
// travels from and when. That separation is deliberate — it means a thin or
// garbled generation can still only ever produce a well-composed slide, never
// a broken animation.

function prefersReducedMotion(): boolean {
  return typeof window !== "undefined" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/**
 * Reveal `count` items one at a time while the slide is on screen.
 *
 * Returns how many are currently shown. When the slide is not active — or the
 * viewer asked for reduced motion — everything shows at once, so nothing is
 * ever hidden from someone who cannot see the animation.
 */
function useStagger(active: boolean, count: number, startMs = 320, stepMs = 700): number {
  const [shown, setShown] = useState(active ? 0 : count);
  useEffect(() => {
    if (!active || prefersReducedMotion()) { setShown(count); return; }
    setShown(0);
    const timers = Array.from({ length: count }, (_, i) =>
      setTimeout(() => setShown(i + 1), startMs + i * stepMs)
    );
    return () => timers.forEach(clearTimeout);
  }, [active, count, startMs, stepMs]);
  return shown;
}

/** Overshoot-and-settle easing. Things that arrive this way feel placed, not faded. */
const SETTLE = "cubic-bezier(0.34, 1.42, 0.64, 1)";

// ─── Visual: Process ─────────────────────────────────────
//
// The chain BUILDS: each step drops in and settles, and the connector between
// two steps draws itself left-to-right instead of fading on.

function ProcessVisual({ steps = [], active }: { steps: string[]; active: boolean }) {
  const shown = useStagger(active, steps.length, 380, 820);

  return (
    <div className="flex flex-wrap items-center justify-center gap-2 p-2">
      {steps.map((step, i) => {
        const on = i < shown;
        return (
          <div key={i} className="flex items-center gap-2">
            {i > 0 && (
              <div className="relative h-0.5 w-7">
                {/* scaleX from the left edge = the connector draws toward the next step */}
                <div
                  className="h-full w-full origin-left rounded-full bg-white/40 transition-transform duration-500 ease-out"
                  style={{ transform: on ? "scaleX(1)" : "scaleX(0)" }}
                />
                <div
                  className="absolute -top-[5px] right-0 text-xs font-bold leading-none text-white/50 transition-opacity duration-300"
                  style={{ opacity: on ? 1 : 0, transitionDelay: on ? "380ms" : "0ms" }}
                >
                  ▶
                </div>
              </div>
            )}
            <div
              className={cn(
                "rounded-xl border-2 px-3 py-2.5 text-center text-sm font-semibold",
                on ? "border-white/40 bg-white/20 text-white shadow-lg" : "border-white/10 bg-white/5 text-white/25"
              )}
              style={{
                transition: `transform 620ms ${SETTLE}, opacity 380ms ease-out, background-color 500ms, border-color 500ms`,
                transform: on ? "translateY(0) scale(1)" : "translateY(22px) scale(0.88)",
                opacity: on ? 1 : 0,
              }}
            >
              <div className="mb-0.5 text-[10px] font-bold uppercase tracking-widest text-white/40">
                {i + 1}
              </div>
              {step}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ─── Visual: Comparison ──────────────────────────────────
//
// The two sides fly in from opposite edges, then their bullets land one by one.
// Previously the panels nudged 24px and every bullet appeared at once.

function ComparisonVisual({ leftLabel = "A", leftItems = [], rightLabel = "B", rightItems = [], active }: {
  leftLabel?: string; leftItems?: string[];
  rightLabel?: string; rightItems?: string[];
  active: boolean;
}) {
  const [panels, setPanels] = useState(!active);
  useEffect(() => {
    if (!active || prefersReducedMotion()) { setPanels(true); return; }
    setPanels(false);
    const t = setTimeout(() => setPanels(true), 220);
    return () => clearTimeout(t);
  }, [active]);

  const maxItems = Math.max(leftItems.length, rightItems.length);
  const bullets = useStagger(active, maxItems, 780, 520);

  const panelStyle = (dir: -1 | 1) => ({
    transition: `transform 700ms ${SETTLE}, opacity 400ms ease-out`,
    transform: panels ? "translateX(0)" : `translateX(${dir * 60}px)`,
    opacity: panels ? 1 : 0,
  });
  const itemStyle = (i: number, dir: -1 | 1) => ({
    transition: `transform 480ms ${SETTLE}, opacity 320ms ease-out`,
    transform: i < bullets ? "translateX(0)" : `translateX(${dir * 16}px)`,
    opacity: i < bullets ? 1 : 0,
  });

  return (
    <div className="grid w-full grid-cols-[1fr_auto_1fr] gap-3 p-2">
      <div className="rounded-xl border border-white/20 bg-white/10 p-3" style={panelStyle(-1)}>
        <p className="mb-2 text-center text-xs font-bold uppercase tracking-wider text-white/70">{leftLabel}</p>
        <div className="space-y-1.5">
          {leftItems.map((item, i) => (
            <div key={i} className="flex items-start gap-1.5 text-xs text-white/90" style={itemStyle(i, -1)}>
              <span className="mt-0.5 h-1.5 w-1.5 shrink-0 rounded-full bg-green-400" />
              {item}
            </div>
          ))}
        </div>
      </div>

      <div className="flex items-center">
        <div
          className="flex h-8 w-8 items-center justify-center rounded-full bg-white/10 text-xs font-black text-white/50"
          style={{
            transition: `transform 600ms ${SETTLE}`,
            transform: panels ? "scale(1) rotate(0deg)" : "scale(0.3) rotate(-90deg)",
          }}
        >
          vs
        </div>
      </div>

      <div className="rounded-xl border border-white/20 bg-white/10 p-3" style={panelStyle(1)}>
        <p className="mb-2 text-center text-xs font-bold uppercase tracking-wider text-white/70">{rightLabel}</p>
        <div className="space-y-1.5">
          {rightItems.map((item, i) => (
            <div key={i} className="flex items-start gap-1.5 text-xs text-white/90" style={itemStyle(i, 1)}>
              <span className="mt-0.5 h-1.5 w-1.5 shrink-0 rounded-full bg-rose-400" />
              {item}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ─── Visual: Formula ─────────────────────────────────────
//
// The formula ASSEMBLES: it is split on whitespace and each token drops into
// place in reading order, so the student watches the expression get built
// rather than watching a finished box fade in.

function FormulaVisual({ text = "", subtext = "", active }: {
  text?: string; subtext?: string; active: boolean;
}) {
  const tokens = (text || "").trim().split(/\s+/).filter(Boolean);
  const shown = useStagger(active, tokens.length, 380, 230);
  const assembled = tokens.length > 0 && shown >= tokens.length;

  const [sub, setSub] = useState(!active);
  useEffect(() => {
    if (!active || prefersReducedMotion()) { setSub(true); return; }
    setSub(false);
    const t = setTimeout(() => setSub(true), 420 + tokens.length * 230);
    return () => clearTimeout(t);
  }, [active, text, tokens.length]);

  return (
    <div className="flex flex-col items-center justify-center gap-4 p-4">
      <div
        className={cn(
          "rounded-2xl border-2 px-8 py-5 text-center font-mono",
          assembled ? "border-white/60 shadow-[0_0_40px_rgba(255,255,255,0.28)]" : "border-white/20"
        )}
        style={{ transition: "border-color 700ms ease-out, box-shadow 700ms ease-out" }}
      >
        <p className="flex flex-wrap items-baseline justify-center gap-x-2 gap-y-1 text-3xl font-black tracking-wider text-white sm:text-4xl">
          {tokens.map((tk, i) => (
            <span
              key={i}
              style={{
                display: "inline-block",
                transition: `transform 520ms ${SETTLE}, opacity 260ms ease-out`,
                transform: i < shown ? "translateY(0) scale(1)" : "translateY(-18px) scale(0.7)",
                opacity: i < shown ? 1 : 0,
              }}
            >
              {tk}
            </span>
          ))}
        </p>
      </div>
      {subtext && (
        <p
          className="max-w-xs text-center text-sm text-white/70"
          style={{
            transition: `transform 600ms ${SETTLE}, opacity 400ms ease-out`,
            transform: sub ? "translateY(0)" : "translateY(12px)",
            opacity: sub ? 1 : 0,
          }}
        >
          {subtext}
        </p>
      )}
    </div>
  );
}

// ─── Visual: Timeline ────────────────────────────────────
//
// The spine DRAWS downward and each dot pops as its event slides in, so the
// timeline advances instead of appearing all at once.

function TimelineVisual({ events = [], active }: {
  events?: { period: string; event: string }[];
  active: boolean;
}) {
  const shown = useStagger(active, events.length, 420, 760);
  const drawn = events.length === 0 ? 1 : Math.min(1, shown / events.length);

  return (
    <div className="relative flex flex-col gap-3 py-2 pl-6 pr-2">
      {/* The spine grows from the top as events arrive. */}
      <div className="absolute bottom-2 left-3.5 top-2 w-0.5 overflow-hidden rounded-full bg-white/10">
        <div
          className="h-full w-full origin-top rounded-full bg-white/45 transition-transform duration-700 ease-out"
          style={{ transform: `scaleY(${drawn})` }}
        />
      </div>

      {events.map((ev, i) => {
        const on = i < shown;
        return (
          <div
            key={i}
            className="flex items-start gap-3"
            style={{
              transition: `transform 560ms ${SETTLE}, opacity 340ms ease-out`,
              transform: on ? "translateX(0)" : "translateX(-24px)",
              opacity: on ? 1 : 0,
            }}
          >
            <div
              className="absolute mt-1.5 h-3 w-3 rounded-full border-2 border-white/50 bg-slate-900"
              style={{
                left: "10px",
                transition: `transform 480ms ${SETTLE}`,
                transform: on ? "scale(1)" : "scale(0)",
              }}
            />
            <div className="ml-2">
              <span className="text-xs font-bold text-white/50">{ev.period}</span>
              <p className="text-sm font-semibold text-white">{ev.event}</p>
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ─── Visual: Highlight ───────────────────────────────────

function HighlightVisual({ text = "", subtext = "", active }: {
  text?: string; subtext?: string; active: boolean;
}) {
  const [in_, setIn] = useState(!active);
  useEffect(() => {
    if (!active || prefersReducedMotion()) { setIn(true); return; }
    setIn(false);
    const t = setTimeout(() => setIn(true), 200);
    return () => clearTimeout(t);
  }, [active, text]);

  return (
    <div className="flex flex-col items-center justify-center gap-3 p-4 text-center">
      <div
        style={{
          transition: `transform 720ms ${SETTLE}, opacity 420ms ease-out`,
          transform: in_ ? "scale(1)" : "scale(0.55)",
          opacity: in_ ? 1 : 0,
        }}
      >
        <p
          className={cn(
            "text-4xl font-black leading-tight text-white sm:text-5xl",
            in_ ? "animate-[slideFloat_4s_ease-in-out_infinite]" : ""
          )}
        >
          {text}
        </p>
      </div>
      {subtext && (
        <p
          className="max-w-sm text-sm text-white/70"
          style={{
            transition: `transform 600ms ${SETTLE} 380ms, opacity 500ms ease-out 380ms`,
            transform: in_ ? "translateY(0)" : "translateY(14px)",
            opacity: in_ ? 1 : 0,
          }}
        >
          {subtext}
        </p>
      )}
    </div>
  );
}

// ─── Visual: Diagram (connected nodes) ───────────────────
//
// Connectors are STROKED IN via a dash offset, so each arrow is drawn between
// two nodes as the diagram assembles.

function DiagramVisual({ steps = [], active }: { steps?: string[]; active: boolean }) {
  const shown = useStagger(active, steps.length, 460, 680);
  const isLine = steps.length <= 3;

  const nodeStyle = (i: number) => ({
    transition: `transform 620ms ${SETTLE}, opacity 340ms ease-out, background-color 500ms`,
    transform: i < shown ? "translateY(0) scale(1)" : "translateY(16px) scale(0.8)",
    opacity: i < shown ? 1 : 0,
  });

  return isLine ? (
    <div className="flex flex-wrap items-center justify-center gap-3 p-2">
      {steps.map((node, i) => (
        <div key={i} className="flex items-center gap-2">
          {i > 0 && (
            <svg width="26" height="16" aria-hidden="true">
              <path
                d="M2 8 L18 8 M13 3 L19 8 L13 13"
                stroke="rgba(255,255,255,0.45)"
                strokeWidth="2"
                fill="none"
                strokeDasharray="30"
                style={{
                  transition: "stroke-dashoffset 520ms ease-out",
                  strokeDashoffset: i < shown ? 0 : 30,
                }}
              />
            </svg>
          )}
          <div
            className={cn(
              "flex h-16 w-24 items-center justify-center rounded-xl border-2 p-2 text-center text-xs font-bold text-white",
              i < shown ? "border-white/40 bg-white/20" : "border-white/10 bg-white/5"
            )}
            style={nodeStyle(i)}
          >
            {node}
          </div>
        </div>
      ))}
    </div>
  ) : (
    <div className="grid grid-cols-2 gap-3 p-2">
      {steps.map((node, i) => (
        <div
          key={i}
          className={cn(
            "flex min-h-[56px] items-center justify-center rounded-xl border-2 p-2 text-center text-xs font-bold text-white",
            i < shown ? "border-white/40 bg-white/20" : "border-white/10 bg-white/5"
          )}
          style={nodeStyle(i)}
        >
          <span className="mr-1.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-white/20 text-[10px]">
            {i + 1}
          </span>
          {node}
        </div>
      ))}
    </div>
  );
}

// ─── Visual: List ────────────────────────────────────────

function ListVisual({ keyPoints = [], active }: { keyPoints: string[]; active: boolean }) {
  const shown = useStagger(active, keyPoints.length, 460, 640);

  return (
    <div className="flex flex-col gap-2 p-2">
      {keyPoints.map((pt, i) => {
        const on = i < shown;
        return (
          <div
            key={i}
            className={cn(
              "flex items-start gap-3 rounded-xl border px-4 py-2.5",
              on ? "border-white/25 bg-white/10" : "border-white/10 bg-white/5"
            )}
            style={{
              transition: `transform 560ms ${SETTLE}, opacity 340ms ease-out, background-color 500ms`,
              transform: on ? "translateX(0)" : "translateX(34px)",
              opacity: on ? 1 : 0,
            }}
          >
            <span
              className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-white/20 text-xs font-bold text-white"
              style={{
                transition: `transform 500ms ${SETTLE} 120ms`,
                transform: on ? "scale(1)" : "scale(0.4)",
              }}
            >
              {i + 1}
            </span>
            <span className="text-sm font-medium text-white/90">{pt}</span>
          </div>
        );
      })}
    </div>
  );
}

// ─── Visual dispatcher ────────────────────────────────────

function SlideVisual({ slide, active }: { slide: VideoSlide; active: boolean }) {
  const vd = slide.visualData ?? {};
  switch (slide.visualType) {
    case "process":    return <ProcessVisual    steps={vd.steps ?? []} active={active} />;
    case "comparison": return <ComparisonVisual leftLabel={vd.leftLabel} leftItems={vd.leftItems ?? []} rightLabel={vd.rightLabel} rightItems={vd.rightItems ?? []} active={active} />;
    case "formula":    return <FormulaVisual    text={vd.text} subtext={vd.subtext} active={active} />;
    case "timeline":   return <TimelineVisual   events={vd.events ?? []} active={active} />;
    case "highlight":  return <HighlightVisual  text={vd.text} subtext={vd.subtext} active={active} />;
    case "diagram":    return <DiagramVisual    steps={vd.steps ?? []} active={active} />;
    case "list":       return <ListVisual       keyPoints={slide.keyPoints} active={active} />;
    default:           return <HighlightVisual  text={slide.heading} active={active} />;
  }
}

// ─── Animated key point ───────────────────────────────────

function AnimatedPoint({ text, visible, delay }: { text: string; visible: boolean; delay: number }) {
  return (
    <div className={cn(
      "flex items-start gap-2.5 text-sm transition-all duration-500",
      visible ? "opacity-100 translate-y-0" : "opacity-0 translate-y-3"
    )} style={{ transitionDelay: visible ? `${delay}ms` : "0ms" }}>
      <span className="mt-1 h-2 w-2 shrink-0 rounded-full bg-white/60" />
      <span className="text-white/90 leading-relaxed">{text}</span>
    </div>
  );
}

// ─── Main player ─────────────────────────────────────────

function isSpeechSupported() {
  return typeof window !== "undefined" && "speechSynthesis" in window;
}

export default function VideoTutorialPlayer({ script, subject, chapterTitle, onClose }: Props) {
  const [slideIdx, setSlideIdx]       = useState(0);
  const [isPlaying, setIsPlaying]     = useState(false);
  const [isMuted, setIsMuted]         = useState(false);
  const [visiblePts, setVisiblePts]   = useState(0);

  const speechRef     = useRef<SpeechSynthesisUtterance | null>(null);
  const pointTimers   = useRef<ReturnType<typeof setTimeout>[]>([]);
  const advanceTimer  = useRef<ReturnType<typeof setTimeout> | null>(null);
  const speechSupported = isSpeechSupported();

  const slide      = script.slides[slideIdx];
  const totalSlides = script.slides.length;
  const accent     = ACCENTS[slideIdx % ACCENTS.length];

  // ── Cleanup ──────────────────────────────────────────

  const stopAll = useCallback(() => {
    if (speechSupported) window.speechSynthesis.cancel();
    speechRef.current = null;
    pointTimers.current.forEach(clearTimeout);
    pointTimers.current = [];
    if (advanceTimer.current) { clearTimeout(advanceTimer.current); advanceTimer.current = null; }
  }, [speechSupported]);

  // ── Key points animation ─────────────────────────────

  const animatePoints = useCallback((pts: string[], totalMs: number) => {
    const interval = totalMs / (pts.length + 1);
    pointTimers.current = pts.map((_, i) =>
      setTimeout(() => setVisiblePts(i + 1), interval * (i + 1))
    );
  }, []);

  // ── Speak ────────────────────────────────────────────

  const speakSlide = useCallback((idx: number) => {
    if (!speechSupported || isMuted) return;
    const text = script.slides[idx].narration;
    const u = new SpeechSynthesisUtterance(text);
    u.rate = 0.9; u.pitch = 1.05; u.volume = 1;
    const voices = window.speechSynthesis.getVoices();
    const best = voices.find(v =>
      v.lang.startsWith("en") &&
      (v.name.toLowerCase().includes("google") || v.name.toLowerCase().includes("natural"))
    );
    if (best) u.voice = best;

    const wordCount = text.split(/\s+/).length;
    const estimatedMs = (wordCount / 125) * 60_000;
    animatePoints(script.slides[idx].keyPoints, estimatedMs);

    u.onend = () => {
      advanceTimer.current = setTimeout(() => {
        setSlideIdx(prev => {
          if (prev < script.slides.length - 1) return prev + 1;
          setIsPlaying(false);
          return prev;
        });
      }, 1800);
    };
    speechRef.current = u;
    window.speechSynthesis.speak(u);
  }, [speechSupported, isMuted, script.slides, animatePoints]);

  // ── Reset points when slide changes ─────────────────

  useEffect(() => { setVisiblePts(0); }, [slideIdx]);

  // ── Play/pause effect ────────────────────────────────

  useEffect(() => {
    stopAll();
    if (isPlaying) speakSlide(slideIdx);
    return stopAll;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isPlaying, slideIdx]);

  // ── Controls ─────────────────────────────────────────

  function goTo(idx: number) {
    stopAll();
    setSlideIdx(idx);
    if (isPlaying) setIsPlaying(false); // briefly reset then re-trigger
    // small trick: re-trigger via state cycle
    setTimeout(() => isPlaying && setIsPlaying(true), 50);
  }

  function prev() { if (slideIdx > 0) { stopAll(); setSlideIdx(s => s - 1); } }
  function next() { if (slideIdx < totalSlides - 1) { stopAll(); setSlideIdx(s => s + 1); } }

  function togglePlay() {
    if (isPlaying) { stopAll(); setIsPlaying(false); }
    else setIsPlaying(true);
  }

  function toggleMute() {
    if (!isMuted) { stopAll(); }
    else if (isPlaying) speakSlide(slideIdx);
    setIsMuted(m => !m);
  }

  function handleClose() { stopAll(); setIsPlaying(false); onClose(); }

  const progressPct = ((slideIdx + 1) / totalSlides) * 100;

  return (
    <div
      className="relative flex h-full flex-col overflow-hidden rounded-2xl text-white shadow-2xl"
      style={{
        background:
          "radial-gradient(ellipse at 20% 0%, #1e1b4b 0%, #0a0a1f 45%, #050510 100%)",
        boxShadow:
          "0 0 0 1px rgba(34,211,238,0.15), 0 30px 80px -10px rgba(139,92,246,0.35), inset 0 0 120px rgba(34,211,238,0.04)",
      }}>

      {/* ── Header ─────────────────────────────────── */}
      <div className="relative z-20 flex items-center gap-3 border-b border-cyan-400/20 bg-white/[0.03] px-5 py-3 backdrop-blur-xl">
        <div className="min-w-0 flex-1">
          <p className="truncate text-[10px] font-semibold uppercase tracking-widest text-white/30">
            {subject} · {chapterTitle}
          </p>
          <p className="truncate text-sm font-bold text-white">{script.title}</p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <span className="flex items-center gap-1 rounded-full bg-white/10 px-2.5 py-1 text-xs text-white/50">
            <Clock className="h-3 w-3" />~{script.estimatedMinutes} min · {totalSlides} slides
          </span>
          <button onClick={handleClose}
                  className="rounded-full p-1.5 text-white/40 transition-colors hover:bg-white/10 hover:text-white">
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* ── Accent stripe ────────────────────────── */}
      <div className={cn("h-1 w-full bg-gradient-to-r transition-all duration-700", accent.from, accent.to)} />

      {/* ── Main slide area ────────────────────────── */}
      <div className="relative flex min-h-0 flex-1 overflow-hidden">

        {/* ── Holographic background stage ── */}
        <div className="pointer-events-none absolute inset-0 overflow-hidden">
          {/* Soft depth blur orbs */}
          <div className="absolute -right-24 -top-24 h-72 w-72 rounded-full opacity-30 blur-[90px] transition-colors duration-700"
               style={{ background: accent.hex }} />
          <div className="absolute -bottom-24 -left-16 h-72 w-72 rounded-full opacity-25 blur-[100px] transition-colors duration-700"
               style={{ background: "#8b5cf6" }} />
          <div className="absolute right-1/3 bottom-1/4 h-40 w-40 rounded-full opacity-20 blur-[70px]"
               style={{ background: "#fbbf24" }} />

          {/* Perspective grid floor */}
          <div className="absolute inset-x-0 bottom-0 h-1/2 opacity-25"
               style={{
                 backgroundImage:
                   "linear-gradient(rgba(34,211,238,0.35) 1px, transparent 1px), linear-gradient(90deg, rgba(34,211,238,0.35) 1px, transparent 1px)",
                 backgroundSize: "40px 40px",
                 transform: "perspective(500px) rotateX(60deg)",
                 transformOrigin: "bottom",
                 maskImage: "linear-gradient(to top, black, transparent)",
                 WebkitMaskImage: "linear-gradient(to top, black, transparent)",
               }} />

          {/* Pulsing data lines (horizontal scans) */}
          <div className="absolute inset-x-0 top-1/4 h-px"
               style={{
                 background: "linear-gradient(90deg, transparent, #22d3ee, transparent)",
                 boxShadow: "0 0 10px #22d3ee",
                 animation: "dataScan 6s ease-in-out infinite",
               }} />
          <div className="absolute inset-x-0 top-2/3 h-px"
               style={{
                 background: "linear-gradient(90deg, transparent, #fbbf24, transparent)",
                 boxShadow: "0 0 10px #fbbf24",
                 animation: "dataScan 7.5s ease-in-out infinite 1.2s",
               }} />

          {/* Floating holo cube — top right */}
          <svg className="absolute" style={{
                 top: "12%", right: "8%", width: 70, height: 70,
                 animation: "holoFloat 7s ease-in-out infinite",
                 filter: "drop-shadow(0 0 10px #22d3ee)",
               }} viewBox="0 0 100 100" fill="none">
            <g stroke="#22d3ee" strokeWidth="1.5" opacity="0.85">
              <path d="M20 30 L50 15 L80 30 L80 70 L50 85 L20 70 Z" />
              <path d="M20 30 L50 45 L80 30" />
              <path d="M50 45 L50 85" />
            </g>
          </svg>

          {/* Floating holo sphere — mid left */}
          <svg className="absolute" style={{
                 bottom: "22%", left: "6%", width: 60, height: 60,
                 animation: "holoFloat 9s ease-in-out infinite 1.5s",
                 filter: "drop-shadow(0 0 12px #8b5cf6)",
               }} viewBox="0 0 100 100" fill="none">
            <g stroke="#a78bfa" strokeWidth="1.5" opacity="0.85">
              <circle cx="50" cy="50" r="35" />
              <ellipse cx="50" cy="50" rx="35" ry="12" />
              <ellipse cx="50" cy="50" rx="12" ry="35" />
              <line x1="15" y1="50" x2="85" y2="50" />
            </g>
          </svg>

          {/* Floating gold octahedron — top left */}
          <svg className="absolute" style={{
                 top: "20%", left: "10%", width: 46, height: 46,
                 animation: "holoFloat 8s ease-in-out infinite 0.7s",
                 filter: "drop-shadow(0 0 10px #fbbf24)",
               }} viewBox="0 0 100 100" fill="none">
            <g stroke="#fbbf24" strokeWidth="1.5" opacity="0.9">
              <path d="M50 10 L90 50 L50 90 L10 50 Z" />
              <path d="M10 50 L90 50" />
              <path d="M50 10 L50 90" />
            </g>
          </svg>

          {/* Particle field */}
          {Array.from({ length: 18 }).map((_, i) => {
            const colors = ["#22d3ee", "#8b5cf6", "#fbbf24"];
            const color = colors[i % 3];
            const left = (i * 53) % 100;
            const top = (i * 37) % 100;
            const dur = 4 + (i % 5);
            return (
              <span key={i} className="absolute rounded-full"
                style={{
                  left: `${left}%`, top: `${top}%`,
                  width: 3, height: 3,
                  background: color,
                  boxShadow: `0 0 6px ${color}`,
                  opacity: 0.7,
                  animation: `holoFloat ${dur}s ease-in-out infinite ${i * 0.2}s, holoTwinkle 2.${i % 9}s ease-in-out infinite`,
                }} />
            );
          })}
        </div>

        {/* ── Content grid: visual (left) + teacher (right) ── */}
        <div className="relative flex flex-1 flex-col overflow-y-auto p-4 sm:p-5">

          {/* Slide heading */}
          <h2 key={`heading-${slideIdx}`}
              className="mb-4 text-xl font-black leading-tight tracking-tight text-white sm:text-2xl animate-in fade-in slide-in-from-left-4 duration-500"
              style={{ textShadow: `0 0 20px ${accent.hex}66, 0 0 40px ${accent.hex}33` }}>
            {slide.heading}
          </h2>

          {/* Visual + Teacher row */}
          <div className="mb-4 flex items-start gap-4">

            {/* Visual area */}
            <div key={`visual-${slideIdx}`}
                 className="relative min-w-0 flex-1 overflow-hidden rounded-2xl py-3 backdrop-blur-md"
                 style={{
                   minHeight: 140,
                   border: `1px solid ${accent.hex}55`,
                   background: "linear-gradient(135deg, rgba(255,255,255,0.04), rgba(255,255,255,0.01))",
                   boxShadow: `0 0 30px ${accent.hex}22, inset 0 0 30px rgba(255,255,255,0.02)`,
                 }}>
              <SlideVisual slide={slide} active={isPlaying} />
            </div>

            {/* Teacher character */}
            <div className="shrink-0 flex flex-col items-center gap-1">
              {/* Speech bubble when playing */}
              {isPlaying && !isMuted && (
                <div className="relative mb-1 max-w-[90px] rounded-xl border border-white/20 bg-white/10 px-2 py-1 text-center text-[9px] text-white/70">
                  <div className="flex justify-center gap-0.5">
                    {[0.3, 0.6, 1, 0.6, 0.3].map((s, i) => (
                      <span key={i} className="inline-block w-1 rounded-full bg-white/50"
                            style={{ height: `${s * 10}px`,
                                     animation: "soundBar 0.7s ease-in-out infinite alternate",
                                     animationDelay: `${i * 0.14}s` }} />
                    ))}
                  </div>
                  {/* Bubble tail */}
                  <div className="absolute -bottom-1.5 left-1/2 -translate-x-1/2 border-l-4 border-r-4 border-t-[6px] border-l-transparent border-r-transparent border-t-white/20" />
                </div>
              )}

              <TeacherCharacter
                emotion={slide.teacherEmotion ?? "explaining"}
                colorIdx={slideIdx}
              />
            </div>
          </div>

          {/* Key points */}
          <div className="space-y-2">
            {slide.keyPoints.map((pt, i) => (
              <AnimatedPoint
                key={`${slideIdx}-${i}`}
                text={pt}
                visible={!isPlaying || i < visiblePts}
                delay={isPlaying ? 0 : i * 80}
              />
            ))}
          </div>
        </div>
      </div>

      {/* ── Progress bar ─────────────────────────── */}
      <div className="relative h-1 w-full bg-white/10">
        <div className={cn("h-full bg-gradient-to-r transition-all duration-500", accent.from, accent.to)}
             style={{ width: `${progressPct}%` }} />
      </div>

      {/* ── Slide chips ──────────────────────────── */}
      <div className="relative z-20 flex gap-1.5 overflow-x-auto border-t border-cyan-400/10 bg-white/[0.02] px-4 py-2 backdrop-blur-xl scrollbar-none">
        {script.slides.map((s, i) => (
          <button key={i} onClick={() => goTo(i)}
                  className={cn(
                    "shrink-0 rounded-lg border px-3 py-1.5 text-[10px] font-semibold transition-all",
                    i === slideIdx
                      ? "border-white/30 bg-white/20 text-white"
                      : "border-white/10 bg-white/5 text-white/40 hover:bg-white/10 hover:text-white/70"
                  )}
                  title={s.heading}>
            {i + 1}
          </button>
        ))}
      </div>

      {/* ── Controls ─────────────────────────────── */}
      <div className="relative z-20 flex items-center justify-between border-t border-cyan-400/20 bg-white/[0.03] px-5 py-3 backdrop-blur-xl">
        {/* Mute */}
        <button onClick={toggleMute}
                disabled={!speechSupported}
                className="rounded-full p-2 text-white/50 transition-colors hover:bg-white/10 hover:text-white disabled:opacity-30">
          {isMuted || !speechSupported ? <VolumeX className="h-5 w-5" /> : <Volume2 className="h-5 w-5" />}
        </button>

        {/* Prev / Play-Pause / Next */}
        <div className="flex items-center gap-3">
          <button onClick={prev} disabled={slideIdx === 0}
                  className="rounded-full p-2 text-white/50 transition-colors hover:bg-white/10 hover:text-white disabled:cursor-not-allowed disabled:opacity-30">
            <SkipBack className="h-5 w-5" />
          </button>

          <button onClick={togglePlay}
                  className={cn(
                    "flex h-12 w-12 items-center justify-center rounded-full text-white shadow-lg transition-transform active:scale-95 bg-gradient-to-br",
                    accent.from, accent.to
                  )}>
            {isPlaying ? <Pause className="h-5 w-5" /> : <Play className="ml-0.5 h-5 w-5" />}
          </button>

          <button onClick={next} disabled={slideIdx === totalSlides - 1}
                  className="rounded-full p-2 text-white/50 transition-colors hover:bg-white/10 hover:text-white disabled:cursor-not-allowed disabled:opacity-30">
            <SkipForward className="h-5 w-5" />
          </button>
        </div>

        {/* Slide count */}
        <span className="tabular-nums text-xs text-white/40">
          {slideIdx + 1} / {totalSlides}
        </span>
      </div>

      {/* ── CSS animations ───────────────────────── */}
      <style>{`
        @keyframes holoSpin {
          from { transform: rotate(0deg); }
          to   { transform: rotate(360deg); }
        }
        @keyframes holoPulse {
          0%,100% { transform: scale(1);    filter: brightness(1); }
          50%     { transform: scale(1.06); filter: brightness(1.25); }
        }
        @keyframes holoFloat {
          0%,100% { transform: translateY(0) rotate(0deg); }
          50%     { transform: translateY(-12px) rotate(8deg); }
        }
        @keyframes holoTwinkle {
          0%,100% { opacity: 0.25; }
          50%     { opacity: 0.95; }
        }
        @keyframes dataScan {
          0%,100% { transform: translateX(-100%); opacity: 0; }
          10%     { opacity: 1; }
          50%     { transform: translateX(0%);    opacity: 1; }
          90%     { opacity: 1; }
        }
        @keyframes teacherSway {
          0%,100% { transform: rotate(-1.5deg); }
          50%      { transform: rotate(1.5deg);  }
        }
        @keyframes soundBar {
          from { transform: scaleY(0.3); }
          to   { transform: scaleY(1.0); }
        }
        @keyframes slideFloat {
          0%, 100% { transform: translateY(0); }
          50%      { transform: translateY(-6px); }
        }
        @keyframes highlightPulse {
          0%,100% { text-shadow: 0 0 20px rgba(255,255,255,0.15); }
          50%     { text-shadow: 0 0 40px rgba(255,255,255,0.50); }
        }
        @keyframes writingPen {
          0%   { transform: rotate(-20deg) translateY(0); }
          100% { transform: rotate(20deg)  translateY(4px); }
        }
      `}</style>
    </div>
  );
}
