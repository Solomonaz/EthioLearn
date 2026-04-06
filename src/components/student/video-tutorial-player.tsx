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

const ACCENTS = [
  { from: "from-violet-600",  to: "to-indigo-700",  hex: "#7c3aed", light: "#ede9fe" },
  { from: "from-emerald-500", to: "to-teal-600",    hex: "#059669", light: "#d1fae5" },
  { from: "from-rose-500",    to: "to-pink-600",    hex: "#e11d48", light: "#ffe4e6" },
  { from: "from-amber-500",   to: "to-orange-600",  hex: "#d97706", light: "#fef3c7" },
  { from: "from-sky-500",     to: "to-blue-600",    hex: "#0284c7", light: "#e0f2fe" },
  { from: "from-lime-500",    to: "to-green-600",   hex: "#16a34a", light: "#dcfce7" },
];

// ─── Teacher Character ────────────────────────────────────

const TEACHER_COLORS = ["#6366f1","#10b981","#f43f5e","#f59e0b","#0ea5e9","#22c55e"];

function TeacherCharacter({ emotion = "explaining", colorIdx = 0 }: {
  emotion?: TeacherEmotion;
  colorIdx?: number;
}) {
  const shirtColor = TEACHER_COLORS[colorIdx % TEACHER_COLORS.length];

  // Arm rotation angles (degrees) from shoulder pivot
  const leftArm  = { explaining: 30, pointing: 10, excited: -150, thinking: 30,  writing: 40  }[emotion] ?? 30;
  const rightArm = { explaining: -30, pointing: -110, excited: -30, thinking: -65, writing: -50 }[emotion] ?? -30;
  const bodyAnim = emotion === "excited"  ? "animate-bounce"
                 : emotion === "pointing" ? ""
                 : "animate-[teacherSway_4s_ease-in-out_infinite]";

  return (
    <div className={cn("relative flex flex-col items-center select-none", bodyAnim)}
         style={{ width: 88, minHeight: 170 }}>

      {/* ── Head ── */}
      <div className="relative z-10" style={{ width: 52, height: 52 }}>
        <div className="absolute inset-0 rounded-full" style={{ background: "#FDDBB4" }} />
        {/* Hair */}
        <div className="absolute top-0 left-0 right-0 h-5 rounded-t-full" style={{ background: "#4B2E0E" }} />
        {/* Eyes */}
        <div className="absolute flex gap-2.5" style={{ top: 17, left: 10 }}>
          <div className="relative" style={{ width: 10, height: 11, borderRadius: "50%", background: "white" }}>
            <div className={cn("absolute rounded-full bg-gray-900", emotion === "excited" ? "animate-ping" : "")}
                 style={{ width: 6, height: 6, top: 2, left: 2 }} />
          </div>
          <div className="relative" style={{ width: 10, height: 11, borderRadius: "50%", background: "white" }}>
            <div className="absolute rounded-full bg-gray-900"
                 style={{ width: 6, height: 6, top: 2, left: 2 }} />
          </div>
        </div>
        {/* Eyebrows */}
        <div className="absolute flex gap-3" style={{ top: 11, left: 9 }}>
          <div className="h-1 w-7 rounded-full"
               style={{ background: "#4B2E0E", transform: emotion === "thinking" ? "rotate(-8deg)" : emotion === "excited" ? "rotate(-15deg)" : "rotate(0deg)" }} />
        </div>
        {/* Mouth */}
        <div className="absolute" style={{ bottom: 9, left: "50%", transform: "translateX(-50%)" }}>
          {emotion === "excited" ? (
            <div style={{ width: 20, height: 10, borderRadius: "0 0 14px 14px", background: "#c2410c", border: "2px solid #9a3412" }} />
          ) : emotion === "thinking" ? (
            <div style={{ width: 14, height: 4, borderRadius: 4, background: "#c2410c" }} />
          ) : (
            <div style={{ width: 18, height: 6, borderRadius: "0 0 12px 12px", border: "2px solid #c2410c", borderTop: "none" }} />
          )}
        </div>
        {/* Cheeks */}
        <div className="absolute rounded-full opacity-40"
             style={{ width: 10, height: 7, background: "#f87171", bottom: 12, left: 4 }} />
        <div className="absolute rounded-full opacity-40"
             style={{ width: 10, height: 7, background: "#f87171", bottom: 12, right: 4 }} />
      </div>

      {/* ── Neck ── */}
      <div style={{ width: 14, height: 8, background: "#FDDBB4", zIndex: 9 }} />

      {/* ── Body + arms row ── */}
      <div className="relative flex items-start" style={{ width: 88, height: 60 }}>

        {/* Left arm (originates from left shoulder) */}
        <div className="absolute"
             style={{
               left: 0, top: 6,
               transformOrigin: "right center",
               transform: `rotate(${leftArm}deg)`,
               transition: "transform 0.5s ease",
               width: 22, height: 11,
               borderRadius: 8,
               background: shirtColor,
             }}>
          {/* Hand */}
          <div className="absolute rounded-full"
               style={{ width: 13, height: 13, background: "#FDDBB4", left: -6, top: -1 }} />
        </div>

        {/* Body */}
        <div className="mx-auto rounded-2xl"
             style={{ width: 44, height: 56, background: shirtColor, zIndex: 10 }}>
          {/* Shirt detail */}
          <div className="mx-auto mt-2 rounded-full opacity-30"
               style={{ width: 10, height: 10, background: "white" }} />
        </div>

        {/* Right arm (originates from right shoulder) */}
        <div className="absolute"
             style={{
               right: 0, top: 6,
               transformOrigin: "left center",
               transform: `rotate(${rightArm}deg)`,
               transition: "transform 0.5s ease",
               width: 22, height: 11,
               borderRadius: 8,
               background: shirtColor,
             }}>
          {/* Hand — pointer finger for "pointing" */}
          <div className="absolute rounded-full"
               style={{ width: 13, height: 13, background: "#FDDBB4", right: -6, top: -1 }} />
          {emotion === "pointing" && (
            <div className="absolute rounded-full"
                 style={{ width: 5, height: 10, background: "#FDDBB4", right: -8, top: -4 }} />
          )}
          {emotion === "writing" && (
            <div className="absolute"
                 style={{ width: 3, height: 14, background: "#fbbf24", right: -5, top: -4,
                          borderRadius: 2,
                          animation: "writingPen 0.8s ease-in-out infinite alternate" }} />
          )}
        </div>
      </div>

      {/* ── Legs ── */}
      <div className="flex gap-1 mt-0.5">
        <div className="rounded-b-full" style={{ width: 16, height: 38, background: "#1e3a5f" }} />
        <div className="rounded-b-full" style={{ width: 16, height: 38, background: "#1e3a5f" }} />
      </div>

      {/* ── Shoes ── */}
      <div className="flex gap-1 -mt-1">
        <div className="rounded-full" style={{ width: 22, height: 10, background: "#111" }} />
        <div className="rounded-full" style={{ width: 22, height: 10, background: "#111" }} />
      </div>

      {/* ── Shadow ── */}
      <div className="rounded-full opacity-20 mt-0.5"
           style={{ width: 50, height: 8, background: "#000" }} />
    </div>
  );
}

// ─── Visual: Process ─────────────────────────────────────

function ProcessVisual({ steps = [], active }: { steps: string[]; active: boolean }) {
  const [shown, setShown] = useState(active ? steps.length : 0);
  useEffect(() => {
    if (!active) { setShown(steps.length); return; }
    setShown(0);
    const timers = steps.map((_, i) =>
      setTimeout(() => setShown(i + 1), 400 + i * 900)
    );
    return () => timers.forEach(clearTimeout);
  }, [active, steps]);

  return (
    <div className="flex flex-wrap items-center justify-center gap-2 p-2">
      {steps.map((step, i) => (
        <div key={i} className="flex items-center gap-2">
          {i > 0 && (
            <div className={cn("text-white/40 text-xl font-bold transition-opacity duration-500",
                               i < shown ? "opacity-100" : "opacity-0")}>→</div>
          )}
          <div className={cn(
            "rounded-xl border-2 border-white/20 px-3 py-2.5 text-center text-sm font-semibold transition-all duration-500",
            i < shown ? "bg-white/20 text-white scale-100 shadow-lg" : "bg-white/5 text-white/20 scale-90"
          )}>
            <div className="mb-0.5 text-[10px] font-bold uppercase tracking-widest text-white/40">
              {i + 1}
            </div>
            {step}
          </div>
        </div>
      ))}
    </div>
  );
}

// ─── Visual: Comparison ──────────────────────────────────

function ComparisonVisual({ leftLabel = "A", leftItems = [], rightLabel = "B", rightItems = [], active }: {
  leftLabel?: string; leftItems?: string[];
  rightLabel?: string; rightItems?: string[];
  active: boolean;
}) {
  const [showLeft, setShowLeft] = useState(!active);
  const [showRight, setShowRight] = useState(!active);
  useEffect(() => {
    if (!active) { setShowLeft(true); setShowRight(true); return; }
    setShowLeft(false); setShowRight(false);
    const t1 = setTimeout(() => setShowLeft(true), 300);
    const t2 = setTimeout(() => setShowRight(true), 900);
    return () => { clearTimeout(t1); clearTimeout(t2); };
  }, [active]);

  return (
    <div className="grid grid-cols-[1fr_auto_1fr] gap-3 p-2 w-full">
      {/* Left */}
      <div className={cn("rounded-xl border border-white/20 bg-white/10 p-3 transition-all duration-500",
                         showLeft ? "opacity-100 translate-x-0" : "opacity-0 -translate-x-6")}>
        <p className="mb-2 text-center text-xs font-bold uppercase tracking-wider text-white/70">{leftLabel}</p>
        <div className="space-y-1.5">
          {leftItems.map((item, i) => (
            <div key={i} className="flex items-start gap-1.5 text-xs text-white/90">
              <span className="mt-0.5 h-1.5 w-1.5 shrink-0 rounded-full bg-green-400" />
              {item}
            </div>
          ))}
        </div>
      </div>
      {/* VS divider */}
      <div className="flex items-center">
        <div className="flex h-8 w-8 items-center justify-center rounded-full bg-white/10 text-xs font-black text-white/50">vs</div>
      </div>
      {/* Right */}
      <div className={cn("rounded-xl border border-white/20 bg-white/10 p-3 transition-all duration-500",
                         showRight ? "opacity-100 translate-x-0" : "opacity-0 translate-x-6")}>
        <p className="mb-2 text-center text-xs font-bold uppercase tracking-wider text-white/70">{rightLabel}</p>
        <div className="space-y-1.5">
          {rightItems.map((item, i) => (
            <div key={i} className="flex items-start gap-1.5 text-xs text-white/90">
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

function FormulaVisual({ text = "", subtext = "", active }: {
  text?: string; subtext?: string; active: boolean;
}) {
  const [revealed, setRevealed] = useState(!active);
  const [glow, setGlow] = useState(false);
  useEffect(() => {
    if (!active) { setRevealed(true); setGlow(false); return; }
    setRevealed(false); setGlow(false);
    const t1 = setTimeout(() => setRevealed(true), 400);
    const t2 = setTimeout(() => setGlow(true), 1200);
    return () => { clearTimeout(t1); clearTimeout(t2); };
  }, [active, text]);

  return (
    <div className="flex flex-col items-center justify-center gap-4 p-4">
      <div className={cn(
        "rounded-2xl border-2 border-white/30 px-8 py-5 text-center font-mono transition-all duration-700",
        revealed ? "opacity-100 scale-100" : "opacity-0 scale-75",
        glow ? "shadow-[0_0_40px_rgba(255,255,255,0.3)] border-white/60" : ""
      )}>
        <p className="text-3xl font-black tracking-wider text-white sm:text-4xl">{text}</p>
      </div>
      {subtext && (
        <p className={cn("max-w-xs text-center text-sm text-white/70 transition-all duration-700 delay-300",
                         revealed ? "opacity-100 translate-y-0" : "opacity-0 translate-y-3")}>
          {subtext}
        </p>
      )}
    </div>
  );
}

// ─── Visual: Timeline ────────────────────────────────────

function TimelineVisual({ events = [], active }: {
  events?: { period: string; event: string }[];
  active: boolean;
}) {
  const [shown, setShown] = useState(active ? 0 : events.length);
  useEffect(() => {
    if (!active) { setShown(events.length); return; }
    setShown(0);
    const timers = events.map((_, i) => setTimeout(() => setShown(i + 1), 300 + i * 800));
    return () => timers.forEach(clearTimeout);
  }, [active, events]);

  return (
    <div className="relative flex flex-col gap-3 py-2 pl-6 pr-2">
      {/* Vertical line */}
      <div className="absolute left-3.5 top-2 bottom-2 w-0.5 bg-white/20 rounded-full" />
      {events.map((ev, i) => (
        <div key={i}
             className={cn("flex items-start gap-3 transition-all duration-500",
                           i < shown ? "opacity-100 translate-x-0" : "opacity-0 -translate-x-4")}>
          {/* Dot */}
          <div className="absolute left-2 mt-1.5 h-3 w-3 rounded-full border-2 border-white/40 bg-white/20"
               style={{ left: "10px" }} />
          <div className="ml-2">
            <span className="text-xs font-bold text-white/50">{ev.period}</span>
            <p className="text-sm font-semibold text-white">{ev.event}</p>
          </div>
        </div>
      ))}
    </div>
  );
}

// ─── Visual: Highlight ───────────────────────────────────

function HighlightVisual({ text = "", subtext = "", active }: {
  text?: string; subtext?: string; active: boolean;
}) {
  const [in_, setIn] = useState(!active);
  useEffect(() => {
    if (!active) { setIn(true); return; }
    setIn(false);
    const t = setTimeout(() => setIn(true), 200);
    return () => clearTimeout(t);
  }, [active, text]);

  return (
    <div className="flex flex-col items-center justify-center gap-3 p-4 text-center">
      <div className={cn(
        "transition-all duration-700",
        in_ ? "opacity-100 scale-100" : "opacity-0 scale-50"
      )}>
        <p className={cn(
          "text-4xl font-black leading-tight text-white sm:text-5xl",
          in_ ? "animate-[highlightPulse_2.5s_ease-in-out_infinite]" : ""
        )}>
          {text}
        </p>
      </div>
      {subtext && (
        <p className={cn("max-w-sm text-sm text-white/70 transition-all duration-700 delay-500",
                         in_ ? "opacity-100" : "opacity-0")}>
          {subtext}
        </p>
      )}
    </div>
  );
}

// ─── Visual: Diagram (connected nodes) ───────────────────

function DiagramVisual({ steps = [], active }: { steps?: string[]; active: boolean }) {
  const [shown, setShown] = useState(active ? 0 : steps.length);
  useEffect(() => {
    if (!active) { setShown(steps.length); return; }
    setShown(0);
    const timers = steps.map((_, i) => setTimeout(() => setShown(i + 1), 500 + i * 700));
    return () => timers.forEach(clearTimeout);
  }, [active, steps]);

  // Arrange in a circle or line depending on count
  const isLine = steps.length <= 3;

  return isLine ? (
    <div className="flex flex-wrap items-center justify-center gap-3 p-2">
      {steps.map((node, i) => (
        <div key={i} className="flex items-center gap-2">
          {i > 0 && (
            <svg width="24" height="16" className={cn("transition-opacity duration-500", i < shown ? "opacity-100" : "opacity-0")}>
              <path d="M2 8 L18 8 M13 3 L19 8 L13 13" stroke="rgba(255,255,255,0.4)" strokeWidth="2" fill="none" />
            </svg>
          )}
          <div className={cn(
            "flex h-16 w-24 items-center justify-center rounded-xl border-2 border-white/30 p-2 text-center text-xs font-bold text-white transition-all duration-500",
            i < shown ? "bg-white/20 scale-100 opacity-100" : "bg-white/5 scale-90 opacity-0"
          )}>
            {node}
          </div>
        </div>
      ))}
    </div>
  ) : (
    <div className="grid grid-cols-2 gap-3 p-2">
      {steps.map((node, i) => (
        <div key={i}
             className={cn(
               "flex min-h-[56px] items-center justify-center rounded-xl border-2 border-white/30 p-2 text-center text-xs font-bold text-white transition-all duration-500",
               i < shown ? "bg-white/20 scale-100 opacity-100" : "bg-white/5 scale-90 opacity-0"
             )}>
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
  const [shown, setShown] = useState(active ? 0 : keyPoints.length);
  useEffect(() => {
    if (!active) { setShown(keyPoints.length); return; }
    setShown(0);
    const timers = keyPoints.map((_, i) => setTimeout(() => setShown(i + 1), 500 + i * 700));
    return () => timers.forEach(clearTimeout);
  }, [active, keyPoints]);

  return (
    <div className="flex flex-col gap-2 p-2">
      {keyPoints.map((pt, i) => (
        <div key={i}
             className={cn(
               "flex items-start gap-3 rounded-xl border border-white/20 bg-white/10 px-4 py-2.5 transition-all duration-500",
               i < shown ? "opacity-100 translate-x-0" : "opacity-0 translate-x-6"
             )}>
          <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-white/20 text-xs font-bold text-white">
            {i + 1}
          </span>
          <span className="text-sm font-medium text-white/90">{pt}</span>
        </div>
      ))}
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
    <div className="flex h-full flex-col overflow-hidden rounded-2xl bg-gray-950 text-white shadow-2xl">

      {/* ── Header ─────────────────────────────────── */}
      <div className="flex items-center gap-3 border-b border-white/10 bg-gray-900/80 px-5 py-3">
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

        {/* Background glow blob */}
        <div className="pointer-events-none absolute inset-0 overflow-hidden">
          <div className="absolute -right-20 -top-20 h-64 w-64 rounded-full opacity-10 blur-3xl transition-colors duration-700"
               style={{ background: accent.hex }} />
          <div className="absolute -bottom-20 -left-10 h-48 w-48 rounded-full opacity-10 blur-2xl transition-colors duration-700"
               style={{ background: accent.hex }} />
        </div>

        {/* ── Content grid: visual (left) + teacher (right) ── */}
        <div className="relative flex flex-1 flex-col overflow-y-auto p-4 sm:p-5">

          {/* Slide heading */}
          <h2 key={`heading-${slideIdx}`}
              className="mb-4 text-xl font-black leading-tight text-white sm:text-2xl animate-in fade-in slide-in-from-left-4 duration-500">
            {slide.heading}
          </h2>

          {/* Visual + Teacher row */}
          <div className="mb-4 flex items-start gap-4">

            {/* Visual area */}
            <div key={`visual-${slideIdx}`}
                 className="min-w-0 flex-1 overflow-hidden rounded-2xl border border-white/10 bg-white/5 py-3"
                 style={{ minHeight: 140 }}>
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
      <div className="flex gap-1.5 overflow-x-auto bg-gray-900/60 px-4 py-2 scrollbar-none">
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
      <div className="flex items-center justify-between border-t border-white/10 bg-gray-900/80 px-5 py-3">
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
        @keyframes teacherSway {
          0%,100% { transform: rotate(-1.5deg); }
          50%      { transform: rotate(1.5deg);  }
        }
        @keyframes soundBar {
          from { transform: scaleY(0.3); }
          to   { transform: scaleY(1.0); }
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
