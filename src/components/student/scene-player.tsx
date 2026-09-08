"use client";

import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import { Play, Pause, SkipBack, SkipForward, Volume2, VolumeX, X, Clock } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  resolveScene,
  sceneDurationMs,
  type Scene,
  type SceneColor,
  type ResolvedScene,
} from "@/lib/scene-schema";

/**
 * Plays an animated scene: a cast of actors moved across keyframes, with bonds
 * that form and break between them.
 *
 * The animation NEVER goes through React state. Interpolating six actors at
 * 60fps through `setState` would re-render the whole tree ~60 times a second;
 * instead every actor and link owns a DOM node captured in a ref, and the
 * frame loop writes attributes straight onto it. React re-renders only when the
 * step changes — caption, pips, transport.
 */

interface Props {
  scene: Scene;
  subject?: string;
  chapterTitle?: string;
  onClose?: () => void;
}

// ─── Stage ───────────────────────────────────────────────
// Scenes are authored in a 0–100 space; the stage is the pixel space it maps
// onto. Keeping the aspect at 1000×560 means x and y scale by different
// factors, so radii use the x factor to stay circular.
const STAGE_W = 1000;
const STAGE_H = 560;
const BASE_R = 30;       // circle radius at size 1
const toX = (x: number) => (x / 100) * STAGE_W;
const toY = (y: number) => (y / 100) * STAGE_H;

// ─── Palette ─────────────────────────────────────────────
// Named colours resolve here, tuned against the dark stage. `ink` is the text
// laid on top of the fill, chosen for contrast rather than derived.
const PALETTE: Record<SceneColor, { base: string; light: string; deep: string; ink: string }> = {
  red:    { base: "#ff5b52", light: "#ff9d84", deep: "#b7241f", ink: "#3a0906" },
  orange: { base: "#ff9f43", light: "#ffc98a", deep: "#c26a12", ink: "#3a1c00" },
  yellow: { base: "#ffce3f", light: "#fff0b0", deep: "#c8971a", ink: "#2a1f00" },
  green:  { base: "#54e08a", light: "#a6f2c1", deep: "#219a56", ink: "#04270f" },
  cyan:   { base: "#37d7ff", light: "#a5eeff", deep: "#1892b6", ink: "#04212b" },
  blue:   { base: "#5b8dff", light: "#a9c2ff", deep: "#2b56c4", ink: "#f2f6ff" },
  purple: { base: "#b06bff", light: "#d6b0ff", deep: "#7434c4", ink: "#f7f0ff" },
  white:  { base: "#eef3fb", light: "#ffffff", deep: "#a9b6cf", ink: "#0b1220" },
  grey:   { base: "#8a99b3", light: "#c2ccdb", deep: "#55627a", ink: "#0b1220" },
};

const easeInOutCubic = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const clamp01 = (v: number) => Math.max(0, Math.min(1, v));

/** Live, interpolated state — held in a ref, never in React state. */
interface LiveState {
  place: Record<string, { x: number; y: number; opacity: number }>;
  links: Record<string, number>;
}

export default function ScenePlayer({ scene, subject, chapterTitle, onClose }: Props) {
  const resolved: ResolvedScene = useMemo(() => resolveScene(scene), [scene]);
  const frames = resolved.frames;
  const lastIdx = frames.length - 1;

  const [idx, setIdx] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [muted, setMuted] = useState(false);

  const reduceMotion = useRef(false);
  const actorRefs = useRef<Record<string, SVGGElement | null>>({});
  const linkRefs = useRef<Record<string, { g: SVGGElement | null; a: SVGLineElement | null; b: SVGLineElement | null; head: SVGPolygonElement | null }>>({});
  const fillRef = useRef<HTMLDivElement | null>(null);

  const live = useRef<LiveState>({ place: {}, links: {} });
  const anim = useRef<{ from: LiveState; to: LiveState; start: number; dur: number } | null>(null);
  const rafId = useRef<number | null>(null);
  const holdTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mutedRef = useRef(muted);
  const playingRef = useRef(playing);
  useEffect(() => { mutedRef.current = muted; }, [muted]);
  useEffect(() => { playingRef.current = playing; }, [playing]);

  const totalMin = Math.max(1, Math.round(sceneDurationMs(resolved) / 60000));

  // ── Painting ───────────────────────────────────────────
  const paint = useCallback((state: LiveState) => {
    for (const actor of resolved.actors) {
      const node = actorRefs.current[actor.id];
      const p = state.place[actor.id];
      if (!node || !p) continue;
      node.setAttribute("transform", `translate(${toX(p.x).toFixed(1)},${toY(p.y).toFixed(1)})`);
      node.setAttribute("opacity", p.opacity.toFixed(3));
    }

    for (const link of resolved.links) {
      const refs = linkRefs.current[link.id];
      const strength = state.links[link.id] ?? 0;
      if (!refs?.g) continue;

      const from = state.place[link.from];
      const to = state.place[link.to];
      if (!from || !to || strength <= 0.01) {
        refs.g.setAttribute("opacity", "0");
        continue;
      }

      // A bond is only as visible as the faintest atom it joins, so a link
      // never floats over a molecule that has faded out.
      refs.g.setAttribute("opacity", (clamp01(from.opacity) * clamp01(to.opacity)).toFixed(3));

      const x1 = toX(from.x), y1 = toY(from.y), x2 = toX(to.x), y2 = toY(to.y);
      let dx = x2 - x1, dy = y2 - y1;
      const len = Math.hypot(dx, dy) || 1;
      dx /= len; dy /= len;

      const rFrom = radiusOf(link.from) + 3;
      const rTo = radiusOf(link.to) + 3;
      const ax = x1 + dx * rFrom, ay = y1 + dy * rFrom;
      const bx = x2 - dx * rTo,  by = y2 - dy * rTo;

      // Double bonds separate into two strokes continuously, so 1 → 2 reads as
      // a second line growing rather than a hard swap.
      const spread = 4.5 * clamp01(strength - 1);
      const px = -dy * spread, py = dx * spread;

      setLine(refs.a, ax + px, ay + py, bx + px, by + py, clamp01(strength));
      setLine(refs.b, ax - px, ay - py, bx - px, by - py, clamp01(strength - 1));

      if (refs.head) {
        const size = 11;
        const tipX = bx, tipY = by;
        const nx = -dy, ny = dx;
        refs.head.setAttribute(
          "points",
          `${tipX},${tipY} ${tipX - dx * size + nx * size * 0.5},${tipY - dy * size + ny * size * 0.5} ` +
          `${tipX - dx * size - nx * size * 0.5},${tipY - dy * size - ny * size * 0.5}`
        );
        refs.head.setAttribute("opacity", clamp01(strength).toFixed(3));
      }
    }
  }, [resolved]);

  const radiusOf = useCallback((actorId: string) => {
    const a = resolved.actors.find((x) => x.id === actorId);
    if (!a) return BASE_R;
    if (a.kind === "label") return 6;
    return BASE_R * (a.size ?? 1);
  }, [resolved]);

  // ── Narration ──────────────────────────────────────────
  const speak = useCallback((text: string) => {
    if (mutedRef.current || reduceMotion.current) return;
    if (typeof window === "undefined" || !("speechSynthesis" in window)) return;
    try {
      window.speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(text);
      u.rate = 0.98;
      window.speechSynthesis.speak(u);
    } catch { /* narration is optional; never break playback */ }
  }, []);

  const stopSpeech = useCallback(() => {
    if (typeof window === "undefined" || !("speechSynthesis" in window)) return;
    try { window.speechSynthesis.cancel(); } catch { /* ignore */ }
  }, []);

  // ── Timeline ───────────────────────────────────────────
  const cloneFrame = (i: number): LiveState => ({
    place: Object.fromEntries(Object.entries(frames[i].place).map(([k, v]) => [k, { ...v }])),
    links: { ...frames[i].links },
  });

  const goTo = useCallback((target: number, announce: boolean) => {
    if (holdTimer.current) { clearTimeout(holdTimer.current); holdTimer.current = null; }
    const next = Math.max(0, Math.min(lastIdx, target));
    setIdx(next);
    if (announce) speak(frames[next].narration);

    const to = cloneFrame(next);
    if (reduceMotion.current) {
      live.current = to;
      paint(to);
      if (fillRef.current) fillRef.current.style.width = `${(next / Math.max(1, lastIdx)) * 100}%`;
      return;
    }
    anim.current = {
      from: {
        place: Object.fromEntries(Object.entries(live.current.place).map(([k, v]) => [k, { ...v }])),
        links: { ...live.current.links },
      },
      to,
      start: performance.now(),
      dur: frames[next].durationMs,
    };
    // eslint-disable-next-line @typescript-eslint/no-use-before-define
    if (rafId.current === null) rafId.current = requestAnimationFrame(tick);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [frames, lastIdx, paint, speak]);

  const tick = useCallback((now: number) => {
    rafId.current = null;
    const a = anim.current;
    if (!a) return;

    let t = (now - a.start) / a.dur;
    const done = t >= 1;
    t = clamp01(t);
    const e = easeInOutCubic(t);

    const next: LiveState = { place: {}, links: {} };
    for (const key of Object.keys(a.to.place)) {
      const f = a.from.place[key] ?? a.to.place[key];
      const g = a.to.place[key];
      next.place[key] = {
        x: lerp(f.x, g.x, e),
        y: lerp(f.y, g.y, e),
        opacity: lerp(f.opacity, g.opacity, e),
      };
    }
    for (const key of Object.keys(a.to.links)) {
      next.links[key] = lerp(a.from.links[key] ?? 0, a.to.links[key], e);
    }
    live.current = next;
    paint(next);

    if (fillRef.current) {
      const frac = lastIdx === 0 ? 1 : (idxRef.current + t) / lastIdx;
      fillRef.current.style.width = `${clamp01(frac) * 100}%`;
    }

    if (done) {
      anim.current = null;
      if (playingRef.current && idxRef.current < lastIdx) {
        holdTimer.current = setTimeout(() => {
          holdTimer.current = null;
          goTo(idxRef.current + 1, true);
        }, 620);
      } else if (idxRef.current >= lastIdx) {
        setPlaying(false);
      }
    } else {
      rafId.current = requestAnimationFrame(tick);
    }
  }, [goTo, lastIdx, paint]);

  // `tick` reads the step index every frame; a ref keeps it current without
  // rebuilding the callback (which would cancel the loop) on every step.
  const idxRef = useRef(idx);
  useEffect(() => { idxRef.current = idx; }, [idx]);

  // ── Mount: rest on frame 0, then autoplay ──────────────
  useEffect(() => {
    reduceMotion.current =
      typeof window !== "undefined" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    live.current = cloneFrame(0);
    paint(live.current);
    if (fillRef.current) fillRef.current.style.width = "0%";

    let start: ReturnType<typeof setTimeout> | null = null;
    if (!reduceMotion.current) {
      start = setTimeout(() => { setPlaying(true); goTo(0, true); }, 600);
    }
    return () => {
      if (start) clearTimeout(start);
      if (rafId.current !== null) cancelAnimationFrame(rafId.current);
      if (holdTimer.current) clearTimeout(holdTimer.current);
      stopSpeech();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resolved]);

  const pause = useCallback(() => {
    setPlaying(false);
    if (holdTimer.current) { clearTimeout(holdTimer.current); holdTimer.current = null; }
    stopSpeech();
  }, [stopSpeech]);

  const play = useCallback(() => {
    setPlaying(true);
    // Finished scenes replay from the top rather than sitting on the last frame.
    const from = idxRef.current >= lastIdx ? 0 : idxRef.current;
    if (from === 0 && idxRef.current >= lastIdx) {
      live.current = cloneFrame(0);
      paint(live.current);
    }
    goTo(from, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [goTo, lastIdx, paint]);

  const frame = frames[idx];

  return (
    <div className="mx-auto w-full max-w-5xl">
      {/* Header */}
      <div className="mb-3 flex items-end justify-between gap-4 px-1">
        <div className="min-w-0">
          {(subject || chapterTitle) && (
            <p className="truncate font-mono text-[11px] uppercase tracking-[0.18em] text-cyan-400/80">
              {[subject, chapterTitle].filter(Boolean).join(" · ")}
            </p>
          )}
          <h2 className="truncate text-lg font-bold text-white sm:text-xl">{resolved.title}</h2>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <span className="flex items-center gap-1.5 rounded-full border border-white/10 bg-white/5 px-3 py-1 font-mono text-[11px] text-slate-300">
            <Clock className="h-3.5 w-3.5" />~{totalMin} min · {frames.length} steps
          </span>
          {onClose && (
            <button
              onClick={() => { pause(); onClose(); }}
              aria-label="Close"
              className="grid h-9 w-9 place-items-center rounded-lg border border-white/10 bg-white/5 text-slate-300 hover:border-cyan-400/40 hover:text-white"
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </div>
      </div>

      <div className="overflow-hidden rounded-2xl border border-slate-700/60 bg-gradient-to-b from-slate-900 to-slate-950 shadow-2xl">
        {/* Stage */}
        <div className="relative border-b border-slate-700/60 bg-[radial-gradient(120%_120%_at_50%_0%,#0d1730_0%,#0a1120_70%)]">
          <svg
            viewBox={`0 0 ${STAGE_W} ${STAGE_H}`}
            className="block h-auto w-full"
            role="img"
            aria-label={`Animation: ${resolved.title}`}
          >
            <defs>
              {SCENE_COLOR_KEYS.map((c) => (
                <radialGradient key={c} id={`sg-${c}`} cx="38%" cy="34%" r="72%">
                  <stop offset="0%" stopColor={PALETTE[c].light} />
                  <stop offset="55%" stopColor={PALETTE[c].base} />
                  <stop offset="100%" stopColor={PALETTE[c].deep} />
                </radialGradient>
              ))}
              <filter id="sg-soft" x="-60%" y="-60%" width="220%" height="220%">
                <feGaussianBlur stdDeviation="8" />
              </filter>
              <pattern id="sg-grid" width="50" height="50" patternUnits="userSpaceOnUse">
                <path d="M50 0H0V50" fill="none" stroke="#22314c" strokeWidth="1" opacity="0.26" />
              </pattern>
            </defs>

            <rect width={STAGE_W} height={STAGE_H} fill="url(#sg-grid)" />

            {/* Links sit under actors so bonds meet the discs, not cover them. */}
            <g>
              {resolved.links.map((link) => {
                const col = PALETTE[link.color ?? "grey"].base;
                return (
                  <g key={link.id} ref={(el) => { linkRefs.current[link.id] = { ...(linkRefs.current[link.id] ?? { g: null, a: null, b: null, head: null }), g: el }; }} opacity="0">
                    <line ref={(el) => { if (linkRefs.current[link.id]) linkRefs.current[link.id].a = el; }} stroke={col} strokeWidth="5" strokeLinecap="round" />
                    <line ref={(el) => { if (linkRefs.current[link.id]) linkRefs.current[link.id].b = el; }} stroke={col} strokeWidth="5" strokeLinecap="round" opacity="0" />
                    {link.style === "arrow" && (
                      <polygon ref={(el) => { if (linkRefs.current[link.id]) linkRefs.current[link.id].head = el; }} fill={col} />
                    )}
                  </g>
                );
              })}
            </g>

            <g>
              {resolved.actors.map((actor) => {
                const pal = PALETTE[actor.color ?? "cyan"];
                const size = actor.size ?? 1;
                const r = BASE_R * size;
                return (
                  <g key={actor.id} ref={(el) => { actorRefs.current[actor.id] = el; }} opacity="0">
                    {actor.kind === "circle" && (
                      <>
                        <circle r={r + 7} fill={pal.base} opacity="0.34" filter="url(#sg-soft)" />
                        <circle r={r} fill={`url(#sg-${actor.color ?? "cyan"})`} stroke="#ffffff30" strokeWidth="1" />
                        <ellipse cx={-r * 0.28} cy={-r * 0.34} rx={r * 0.42} ry={r * 0.26} fill="#ffffff" opacity="0.32" />
                        {actor.text && (
                          <text textAnchor="middle" dy="0.36em" fontWeight="800"
                            fontSize={Math.max(13, r * 0.85)} fill={pal.ink}>{actor.text}</text>
                        )}
                      </>
                    )}
                    {actor.kind === "box" && (
                      <>
                        <rect x={-58 * size} y={-24 * size} width={116 * size} height={48 * size} rx={12}
                          fill={`url(#sg-${actor.color ?? "cyan"})`} stroke="#ffffff30" strokeWidth="1" />
                        <text textAnchor="middle" dy="0.36em" fontWeight="700"
                          fontSize={17 * size} fill={pal.ink}>{actor.text}</text>
                      </>
                    )}
                    {actor.kind === "label" && (
                      <text textAnchor="middle" dy="0.36em" fontWeight="600"
                        fontSize={19 * size} fill={pal.base} letterSpacing="0.04em">{actor.text}</text>
                    )}
                  </g>
                );
              })}
            </g>
          </svg>
        </div>

        {/* Caption */}
        <div className="flex items-center gap-3 border-b border-slate-700/60 px-5 py-4">
          <span className="shrink-0 rounded-md border border-slate-600/70 px-2 py-1 font-mono text-[11px] tracking-widest text-cyan-400">
            {String(idx + 1).padStart(2, "0")} / {String(frames.length).padStart(2, "0")}
          </span>
          <p className="text-sm leading-snug text-slate-100 sm:text-[15px]">{frame.caption}</p>
        </div>

        {/* Transport */}
        <div className="flex items-center gap-4 px-4 py-3">
          <div className="flex items-center gap-2">
            <button onClick={() => { pause(); goTo(idx - 1, true); }} disabled={idx === 0}
              aria-label="Previous step"
              className="grid h-10 w-10 place-items-center rounded-xl border border-slate-600/70 bg-slate-800 text-slate-200 disabled:opacity-40 hover:border-cyan-400/50">
              <SkipBack className="h-4 w-4" />
            </button>
            <button onClick={() => (playing ? pause() : play())}
              aria-label={playing ? "Pause" : "Play"}
              className="grid h-12 w-12 place-items-center rounded-2xl bg-gradient-to-b from-cyan-300 to-cyan-500 text-slate-900 shadow-lg shadow-cyan-500/20">
              {playing ? <Pause className="h-5 w-5" /> : <Play className="h-5 w-5" />}
            </button>
            <button onClick={() => { pause(); goTo(idx + 1, true); }} disabled={idx === lastIdx}
              aria-label="Next step"
              className="grid h-10 w-10 place-items-center rounded-xl border border-slate-600/70 bg-slate-800 text-slate-200 disabled:opacity-40 hover:border-cyan-400/50">
              <SkipForward className="h-4 w-4" />
            </button>
            <button onClick={() => { setMuted((m) => !m); if (!muted) stopSpeech(); }}
              aria-label={muted ? "Unmute narration" : "Mute narration"}
              className={cn(
                "grid h-10 w-10 place-items-center rounded-xl border bg-slate-800",
                muted ? "border-slate-600/70 text-slate-400" : "border-cyan-400/50 text-cyan-300"
              )}>
              {muted ? <VolumeX className="h-4 w-4" /> : <Volume2 className="h-4 w-4" />}
            </button>
          </div>

          <div className="flex min-w-0 flex-1 flex-col gap-2">
            <div className="h-1.5 overflow-hidden rounded-full bg-slate-700/70">
              <div ref={fillRef} className="h-full rounded-full bg-gradient-to-r from-cyan-600 to-cyan-300" style={{ width: "0%" }} />
            </div>
            <div className="flex gap-1.5">
              {frames.map((f, i) => (
                <button key={i} onClick={() => { pause(); goTo(i, true); }}
                  title={f.caption}
                  aria-label={`Step ${i + 1}`}
                  className="group flex-1">
                  <span className={cn(
                    "block h-1 w-full rounded-full transition-colors",
                    i === idx ? "bg-cyan-300" : i < idx ? "bg-cyan-700" : "bg-slate-700 group-hover:bg-slate-600"
                  )} />
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

const SCENE_COLOR_KEYS = Object.keys(PALETTE) as SceneColor[];

function setLine(el: SVGLineElement | null, x1: number, y1: number, x2: number, y2: number, opacity: number) {
  if (!el) return;
  el.setAttribute("x1", x1.toFixed(1));
  el.setAttribute("y1", y1.toFixed(1));
  el.setAttribute("x2", x2.toFixed(1));
  el.setAttribute("y2", y2.toFixed(1));
  el.setAttribute("opacity", opacity.toFixed(3));
}
