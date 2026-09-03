"use client";

import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { compile, derivative, parse } from "mathjs";
import {
  Plus,
  Trash2,
  ZoomIn,
  ZoomOut,
  Maximize2,
  Table as TableIcon,
  Eye,
  EyeOff,
  RotateCcw,
  Activity,
  Download,
  Save,
  FolderOpen,
  FunctionSquare,
  Pen,
  Highlighter,
  Eraser,
  Undo2,
  X,
  Expand,
  Shrink,
  BoxSelect,
  LineChart,
  Loader2,
  Sun,
  Moon,
  SlidersHorizontal,
  LayoutGrid,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "@/components/ui/sonner";

/**
 * Interactive 2D function grapher (no paid services). mathjs parses/evaluates
 * expressions safely (never eval). Features: multiple functions, inequality
 * shading (y < / > f(x)), pan/zoom, hover trace, value table, symbolic
 * derivatives, roots & intersection analysis, PNG download, and save/load.
 */

const COLORS = ["#2563EB", "#DC2626", "#16A34A", "#7C3AED", "#EA580C", "#0891B2"];
const PEN_COLORS = ["#111827", "#dc2626", "#2563eb", "#16a34a", "#f59e0b", "#ffffff"];
const SVGNS = "http://www.w3.org/2000/svg";

/** A freehand ink stroke drawn on the whiteboard layer (screen pixels). */
interface Stroke {
  id: string;
  color: string;
  width: number;
  opacity: number;
  pts: { x: number; y: number }[];
}

type Ineq = "<" | ">" | "<=" | ">=" | null;

interface Fn {
  id: string;
  expr: string;
  color: string;
  hidden?: boolean;
}

interface View {
  xMin: number;
  xMax: number;
  yMin: number;
  yMax: number;
}

interface SavedGraph {
  id: string;
  title: string;
  expressions: string[];
  view?: View | null;
}

const DEFAULT_VIEW: View = { xMin: -10, xMax: 10, yMin: -10, yMax: 10 };

let counter = 0;
const uid = () => `fn_${++counter}`;

/** Split a leading inequality ("y < f", "> f") off an expression. */
function parseExpr(expr: string): { body: string; ineq: Ineq } {
  const m = expr.trim().match(/^\s*[yY]?\s*(<=|>=|<|>)\s*(.+)$/);
  if (m) return { ineq: m[1] as Ineq, body: m[2] };
  return { ineq: null, body: expr };
}

/** Normalise typed notation: strip "y ="/"f(x) =", accept ln, π, √. */
function normalize(expr: string): string {
  return expr
    .trim()
    .replace(/^\s*(?:[yY]|[fFgGhH]\s*\(\s*[xX]\s*\))\s*=\s*/, "")
    .replace(/\bln\s*\(/gi, "log(")
    .replace(/π/g, "pi")
    .replace(/√/g, "sqrt");
}

type Compiled = { evaluate: (scope: Record<string, number>) => unknown };

// Names that are never adjustable parameters (the graph variable, constants).
const RESERVED = new Set(["x", "e", "pi", "i", "Infinity", "NaN", "true", "false", "null"]);

/** Free parameters in an expression: symbols other than x and known constants,
 *  excluding function names (sin, cos, …). These become interactive sliders. */
function freeParams(expr: string): string[] {
  let node;
  try {
    node = parse(expr);
  } catch {
    return [];
  }
  const names: string[] = [];
  node.traverse((n, _path, parent) => {
    const nn = n as unknown as { type: string; name?: string };
    const pp = parent as unknown as { type?: string; fn?: unknown } | null;
    if (nn.type === "SymbolNode" && nn.name) {
      if (pp && pp.type === "FunctionNode" && pp.fn === n) return; // skip the callee (e.g. "sin")
      if (!RESERVED.has(nn.name) && !names.includes(nn.name)) names.push(nn.name);
    }
  });
  return names;
}

function tryCompile(expr: string): { fn: Compiled | null; error: boolean; params: string[] } {
  const e = normalize(expr);
  if (!e) return { fn: null, error: false, params: [] };
  const params = freeParams(e);
  try {
    const fn = compile(e) as Compiled;
    const scope: Record<string, number> = { x: 1 };
    for (const p of params) scope[p] = 1; // test with defaults so params aren't "errors"
    fn.evaluate(scope);
    return { fn, error: false, params };
  } catch {
    return { fn: null, error: true, params };
  }
}

function evalAt(fn: Compiled, x: number, params: Record<string, number> = {}): number | null {
  try {
    const y = fn.evaluate({ x, ...params });
    return typeof y === "number" && Number.isFinite(y) ? y : null;
  } catch {
    return null;
  }
}

/** Refine a root/crossing of g between lo and hi by bisection. */
function bisect(g: (x: number) => number | null, lo: number, hi: number): number | null {
  let flo = g(lo);
  if (flo === null) return null;
  for (let k = 0; k < 40; k++) {
    const mid = (lo + hi) / 2;
    const fm = g(mid);
    if (fm === null) return null;
    if (Math.abs(fm) < 1e-9) return mid;
    if (flo * fm < 0) hi = mid;
    else {
      lo = mid;
      flo = fm;
    }
  }
  return (lo + hi) / 2;
}

function niceStep(range: number, target: number): number {
  const raw = range / target;
  const mag = Math.pow(10, Math.floor(Math.log10(raw || 1)));
  const norm = raw / mag;
  const step = norm < 1.5 ? 1 : norm < 3 ? 2 : norm < 7 ? 5 : 10;
  return step * mag;
}

function fmt(v: number): string {
  if (v === 0) return "0";
  const a = Math.abs(v);
  if (a >= 1e4 || a < 1e-3) return v.toExponential(1);
  return String(Math.round(v * 1000) / 1000);
}

export function GraphPlotter({
  initial,
  seedKey,
  // The smart-pen (handwrite an equation → AI recognises & graphs it) is an AI
  // feature, so it's hidden when AI is off platform-wide. Defaults on.
  aiTools = true,
}: {
  initial?: string[];
  seedKey?: number;
  aiTools?: boolean;
}) {
  const [fns, setFns] = useState<Fn[]>(() => {
    const seed = (initial ?? []).filter((s) => s.trim()).slice(0, 6);
    return (seed.length ? seed : ["x^2"]).map((expr, i) => ({
      id: uid(),
      expr,
      color: COLORS[i % COLORS.length],
    }));
  });
  const [view, setView] = useState<View>(DEFAULT_VIEW);
  const [showTable, setShowTable] = useState(false);
  const [analysis, setAnalysis] = useState(false);
  const [hover, setHover] = useState<{ px: number; py: number; x: number; y: number; color: string } | null>(null);
  const [saved, setSaved] = useState<SavedGraph[]>([]);
  const [savedOpen, setSavedOpen] = useState(false);

  // Whiteboard / smart-pen ink layer.
  const [penMode, setPenMode] = useState(false);
  const [penTool, setPenTool] = useState<"pen" | "highlighter" | "eraser" | "select">("pen");
  const [penColor, setPenColor] = useState(PEN_COLORS[0]);
  const [strokes, setStrokes] = useState<Stroke[]>([]);
  const drawingRef = useRef<string | null>(null);
  const [isFull, setIsFull] = useState(false);

  // If AI gets turned off (or the plan doesn't include it), leave pen mode so
  // the AI handwriting toolbar can't be reached while it's hidden.
  useEffect(() => {
    if (!aiTools) setPenMode(false);
  }, [aiTools]);

  // The surface is a blank board; a plotted graph appears as a self-contained,
  // movable card (its own mini coordinate plane) — it never takes over the
  // whole board. `boardDark` flips a board-local light/dark look (a soft
  // charcoal board, like a smartboard — independent of the app theme).
  const [boardDark, setBoardDark] = useState(false);
  const [card, setCard] = useState<{ x: number; y: number } | null>(null); // top-left of the graph card (null = centred default)
  const [menuOpen, setMenuOpen] = useState(false); // tool dot expanded?
  const clipId = useId().replace(/[^a-zA-Z0-9]/g, "");

  // Board-local palette (explicit colours so the board look never depends on
  // the surrounding app theme). Curves keep their own vivid COLORS.
  const bt = boardDark
    ? { bg: "#3a3f45", grid: "#565c65", axis: "#aab2bd", label: "#aab2bd", marker: "#3f454c", hoverRing: "#3f454c", card: "#3f454c", cardBorder: "#5c636d", sel: "#4ade80" }
    : { bg: "#f6f7f9", grid: "#e5e7eb", axis: "#64748b", label: "#64748b", marker: "#ffffff", hoverRing: "#ffffff", card: "#ffffff", cardBorder: "#d8dbe0", sel: "#166534" };

  // Lasso selection of ink → recognise handwriting → graph it.
  const [marquee, setMarquee] = useState<{ x: number; y: number; w: number; h: number } | null>(null);
  const marqueeStart = useRef<{ x: number; y: number } | null>(null);
  const [selection, setSelection] = useState<string[]>([]);
  const [selRect, setSelRect] = useState<{ x: number; y: number; w: number; h: number } | null>(null);
  const [recognizing, setRecognizing] = useState(false);

  // ── Measure the plot area ─────────────────────────────────
  const boxRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const wheelRef = useRef<(e: WheelEvent) => void>(() => {});
  const [size, setSize] = useState({ w: 640, h: 420 });
  useEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setSize({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const { w: W, h: H } = size;

  // Apply a fresh AI/explain seed WITHOUT remounting, so the student's ink,
  // sliders and view survive. `seedKey` bumps whenever new equations arrive;
  // the first run is skipped because useState already seeded the functions.
  const seededOnce = useRef(false);
  useEffect(() => {
    if (!seededOnce.current) {
      seededOnce.current = true;
      return;
    }
    const seed = (initial ?? []).filter((s) => s.trim()).slice(0, 6);
    if (!seed.length) return;
    setFns(seed.map((expr, i) => ({ id: uid(), expr, color: COLORS[i % COLORS.length] })));
    setHover(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seedKey]);

  // Wheel-zoom needs a NON-passive listener so preventDefault works (React's
  // onWheel can be passive). Attach once; the handler is refreshed each render
  // via wheelRef so it always sees current state.
  useEffect(() => {
    const el = svgRef.current;
    if (!el) return;
    const h = (e: WheelEvent) => wheelRef.current(e);
    el.addEventListener("wheel", h, { passive: false });
    return () => el.removeEventListener("wheel", h);
  }, []);

  // Graph-card geometry: a bounded panel that scales with the board but caps,
  // so the plot stays a compact widget instead of covering the whole surface.
  const cardW = Math.round(Math.min(Math.max(W * 0.52, 260), 560));
  const cardH = Math.round(Math.min(Math.max(H * 0.62, 200), 400));
  const cx = card ? card.x : Math.max(12, Math.round((W - cardW) / 2));
  const cy = card ? card.y : Math.max(12, Math.round((H - cardH) / 2));

  // ── Saved graphs ──────────────────────────────────────────
  const loadSavedList = useCallback(() => {
    fetch("/api/graph/saved")
      .then((r) => (r.ok ? r.json() : { graphs: [] }))
      .then((d) => setSaved(d.graphs ?? []))
      .catch(() => {});
  }, []);
  useEffect(() => loadSavedList(), [loadSavedList]);

  // Fullscreen the graph area (great for a smartboard).
  const toggleFull = () => {
    const el = boxRef.current;
    if (!el) return;
    if (!document.fullscreenElement) el.requestFullscreen?.().catch(() => {});
    else document.exitFullscreen?.().catch(() => {});
  };
  useEffect(() => {
    const onChange = () => setIsFull(!!document.fullscreenElement);
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, []);

  // Flip the board's local light/dark look, keeping the default ink visible.
  const toggleDark = () => {
    setPenColor((c) => (!boardDark ? (c === "#111827" ? "#ffffff" : c) : c === "#ffffff" ? "#111827" : c));
    setBoardDark((d) => !d);
  };

  // ── Compile visible functions (+ inequality parse) ────────
  const compiled = useMemo(
    () =>
      fns.map((f) => {
        const { body, ineq } = parseExpr(f.expr);
        return { ...f, ...tryCompile(body), ineq };
      }),
    [fns],
  );

  // ── Adjustable parameters (A, B, k, …) → live sliders ─────
  const [paramVals, setParamVals] = useState<Record<string, number>>({});
  const allParams = useMemo(() => {
    const list: string[] = [];
    for (const f of compiled) for (const p of f.params) if (!list.includes(p)) list.push(p);
    return list;
  }, [compiled]);
  const paramScope = useMemo(() => {
    const s: Record<string, number> = {};
    for (const p of allParams) s[p] = paramVals[p] ?? 1;
    return s;
  }, [allParams, paramVals]);

  // ── Coordinate transforms (guarded against zero span) ─────
  const spanX = view.xMax - view.xMin;
  const spanY = view.yMax - view.yMin;
  const safeX = Number.isFinite(spanX) && spanX !== 0 ? spanX : 1;
  const safeY = Number.isFinite(spanY) && spanY !== 0 ? spanY : 1;
  const sx = useCallback((x: number) => ((x - view.xMin) / safeX) * cardW, [view.xMin, safeX, cardW]);
  const sy = useCallback((y: number) => cardH - ((y - view.yMin) / safeY) * cardH, [view.yMin, safeY, cardH]);
  const wx = useCallback((px: number) => view.xMin + (px / (cardW || 1)) * safeX, [view.xMin, safeX, cardW]);

  // ── Build polyline segments (+ shading for inequalities) inside the card ──
  const paths = useMemo(() => {
    if (!cardW || !cardH) return [] as { color: string; segments: string[]; fills: string[]; ineq: Ineq }[];
    return compiled
      .filter((f) => f.fn && !f.hidden)
      .map((f) => {
        const segments: string[] = [];
        const fills: string[] = [];
        const edge = f.ineq === "<" || f.ineq === "<=" ? cardH : 0;
        let cur: string[] = [];
        let firstPx = 0;
        let lastPx = 0;
        let prevY: number | null = null;
        const flush = () => {
          if (cur.length) {
            segments.push(cur.join(" "));
            if (f.ineq && cur.length >= 2) {
              fills.push(`M ${firstPx},${edge} L ${cur.join(" L ")} L ${lastPx},${edge} Z`);
            }
          }
          cur = [];
        };
        for (let px = 0; px <= cardW; px++) {
          const x = wx(px);
          const y = evalAt(f.fn!, x, paramScope);
          const off = y === null || y > view.yMax + safeY * 4 || y < view.yMin - safeY * 4;
          const jump = prevY !== null && y !== null && Math.abs(y - prevY) > safeY * 4;
          if (off || jump) {
            flush();
            prevY = y;
            continue;
          }
          if (cur.length === 0) firstPx = px;
          lastPx = px;
          cur.push(`${px.toFixed(1)},${sy(y!).toFixed(1)}`);
          prevY = y;
        }
        flush();
        return { color: f.color, segments, fills, ineq: f.ineq };
      });
  }, [compiled, cardW, cardH, view, wx, sy, safeY, paramScope]);

  // Only show the graph card when there's actually something to plot.
  const showCard = compiled.some((f) => f.fn && !f.hidden);

  // ── Roots & intersections (analysis) ──────────────────────
  const markers = useMemo(() => {
    const roots: { x: number; color: string }[] = [];
    const inters: { x: number; y: number }[] = [];
    if (!analysis || !Number.isFinite(spanX) || spanX <= 0) return { roots, inters };
    const vis = compiled.filter((f) => f.fn && !f.hidden);
    const N = 500;
    const dx = spanX / N;
    for (const f of vis) {
      const g = (x: number) => evalAt(f.fn!, x, paramScope);
      let prev = g(view.xMin);
      for (let i = 1; i <= N && roots.length < 30; i++) {
        const x = view.xMin + i * dx;
        const y = g(x);
        if (prev !== null && y !== null && prev * y < 0) {
          const rx = bisect(g, x - dx, x);
          if (rx !== null) roots.push({ x: rx, color: f.color });
        }
        prev = y;
      }
    }
    for (let a = 0; a < vis.length; a++) {
      for (let b = a + 1; b < vis.length; b++) {
        const d = (x: number) => {
          const ya = evalAt(vis[a].fn!, x, paramScope);
          const yb = evalAt(vis[b].fn!, x, paramScope);
          return ya === null || yb === null ? null : ya - yb;
        };
        let prev = d(view.xMin);
        for (let i = 1; i <= N && inters.length < 30; i++) {
          const x = view.xMin + i * dx;
          const dy = d(x);
          if (prev !== null && dy !== null && prev * dy < 0) {
            const ix = bisect(d, x - dx, x);
            if (ix !== null) {
              const yv = evalAt(vis[a].fn!, ix, paramScope);
              if (yv !== null) inters.push({ x: ix, y: yv });
            }
          }
          prev = dy;
        }
      }
    }
    return { roots, inters };
  }, [analysis, compiled, view, spanX, paramScope]);

  // ── Gridlines ─────────────────────────────────────────────
  const grid = useMemo(() => {
    const xs: { x: number; label: string }[] = [];
    const ys: { y: number; label: string }[] = [];
    if (
      !Number.isFinite(view.xMin) ||
      !Number.isFinite(view.xMax) ||
      !Number.isFinite(view.yMin) ||
      !Number.isFinite(view.yMax) ||
      view.xMax <= view.xMin ||
      view.yMax <= view.yMin
    ) {
      return { xs, ys };
    }
    const stepX = niceStep(view.xMax - view.xMin, 10);
    const stepY = niceStep(view.yMax - view.yMin, 8);
    if (stepX > 0) for (let x = Math.ceil(view.xMin / stepX) * stepX; x <= view.xMax; x += stepX) xs.push({ x, label: fmt(x) });
    if (stepY > 0) for (let y = Math.ceil(view.yMin / stepY) * stepY; y <= view.yMax; y += stepY) ys.push({ y, label: fmt(y) });
    return { xs, ys };
  }, [view]);

  // ── Whiteboard ink (smart-pen) ────────────────────────────
  const ptOf = (e: React.PointerEvent, rect: DOMRect) => ({ x: e.clientX - rect.left, y: e.clientY - rect.top });
  const eraseAt = (p: { x: number; y: number }) =>
    setStrokes((s) => s.filter((st) => !st.pts.some((q) => Math.hypot(q.x - p.x, q.y - p.y) < 14)));

  const finalizeSelection = (a: { x: number; y: number }, b: { x: number; y: number }) => {
    const x = Math.min(a.x, b.x);
    const y = Math.min(a.y, b.y);
    const w = Math.abs(b.x - a.x);
    const h = Math.abs(b.y - a.y);
    if (w < 5 || h < 5) {
      setSelection([]);
      setSelRect(null);
      return;
    }
    const ids = strokes
      .filter((st) => st.pts.some((p) => p.x >= x && p.x <= x + w && p.y >= y && p.y <= y + h))
      .map((st) => st.id);
    if (!ids.length) {
      setSelection([]);
      setSelRect(null);
      return;
    }
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const st of strokes) {
      if (!ids.includes(st.id)) continue;
      for (const p of st.pts) {
        minX = Math.min(minX, p.x);
        minY = Math.min(minY, p.y);
        maxX = Math.max(maxX, p.x);
        maxY = Math.max(maxY, p.y);
      }
    }
    const pad = 8;
    setSelection(ids);
    setSelRect({ x: minX - pad, y: minY - pad, w: maxX - minX + pad * 2, h: maxY - minY + pad * 2 });
  };

  const startStroke = (e: React.PointerEvent) => {
    const el = e.currentTarget as SVGElement;
    el.setPointerCapture(e.pointerId);
    const p = ptOf(e, el.getBoundingClientRect());
    if (penTool === "select") {
      drawingRef.current = "select";
      marqueeStart.current = p;
      setMarquee({ x: p.x, y: p.y, w: 0, h: 0 });
      setSelection([]);
      setSelRect(null);
      return;
    }
    if (penTool === "eraser") {
      drawingRef.current = "erasing";
      eraseAt(p);
      return;
    }
    const pressure = e.pressure && e.pressure > 0 ? e.pressure : 0.5;
    const hi = penTool === "highlighter";
    const id = uid();
    drawingRef.current = id;
    setStrokes((s) => [
      ...s,
      { id, color: penColor, width: hi ? 16 : 2 + pressure * 4, opacity: hi ? 0.35 : 1, pts: [p] },
    ]);
  };
  const extendStroke = (e: React.PointerEvent) => {
    if (!drawingRef.current) return;
    const p = ptOf(e, (e.currentTarget as SVGElement).getBoundingClientRect());
    if (drawingRef.current === "select") {
      const s = marqueeStart.current;
      if (s) setMarquee({ x: s.x, y: s.y, w: p.x - s.x, h: p.y - s.y });
      return;
    }
    if (drawingRef.current === "erasing") return eraseAt(p);
    const id = drawingRef.current;
    setStrokes((s) => s.map((st) => (st.id === id ? { ...st, pts: [...st.pts, p] } : st)));
  };
  const endStroke = (e: React.PointerEvent) => {
    const el = e.currentTarget as SVGElement;
    if (drawingRef.current === "select") {
      const p = ptOf(e, el.getBoundingClientRect());
      const s = marqueeStart.current;
      drawingRef.current = null;
      marqueeStart.current = null;
      setMarquee(null);
      if (s) finalizeSelection(s, p);
    } else {
      drawingRef.current = null;
    }
    try {
      el.releasePointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
  };
  const undoInk = () => setStrokes((s) => s.slice(0, -1));
  const clearInk = () => {
    setStrokes([]);
    setSelection([]);
    setSelRect(null);
  };
  const deleteSelection = () => {
    setStrokes((s) => s.filter((st) => !selection.includes(st.id)));
    setSelection([]);
    setSelRect(null);
  };

  // Rasterise the selected ink to a clean image for handwriting recognition.
  const rasterizeSelection = (ids: string[]): string | null => {
    const sel = strokes.filter((s) => ids.includes(s.id));
    if (!sel.length) return null;
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const st of sel) for (const p of st.pts) {
      minX = Math.min(minX, p.x);
      minY = Math.min(minY, p.y);
      maxX = Math.max(maxX, p.x);
      maxY = Math.max(maxY, p.y);
    }
    const pad = 18;
    const w = Math.max(1, Math.ceil(maxX - minX + pad * 2));
    const h = Math.max(1, Math.ceil(maxY - minY + pad * 2));
    const scale = 2;
    const canvas = document.createElement("canvas");
    canvas.width = w * scale;
    canvas.height = h * scale;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    ctx.scale(scale, scale);
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, w, h);
    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    for (const st of sel) {
      ctx.strokeStyle = "#111827"; // dark ink on white → reliable OCR regardless of pen colour
      ctx.lineWidth = Math.max(3, st.width);
      ctx.beginPath();
      st.pts.forEach((p, i) => {
        const x = p.x - minX + pad;
        const y = p.y - minY + pad;
        if (i) ctx.lineTo(x, y);
        else ctx.moveTo(x, y);
      });
      ctx.stroke();
    }
    return canvas.toDataURL("image/jpeg", 0.92);
  };

  const graphSelection = async () => {
    const img = rasterizeSelection(selection);
    if (!img) return toast.error("Select your writing first");
    setRecognizing(true);
    try {
      const res = await fetch("/api/graph/recognize", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ image: img, mimeType: "image/jpeg" }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) return toast.error(data.error || "Couldn't read the writing");
      const eqs: string[] = data.equations ?? [];
      if (!eqs.length) return toast.error("No equation recognised");
      setFns(eqs.slice(0, 6).map((e, i) => ({ id: uid(), expr: e, color: COLORS[i % COLORS.length] })));
      setSelection([]);
      setSelRect(null);
      toast.success(`Graphed ${eqs.length} function${eqs.length > 1 ? "s" : ""}`);
    } catch {
      toast.error("AI is unavailable right now.");
    } finally {
      setRecognizing(false);
    }
  };

  // ── Interactions ──────────────────────────────────────────
  // Dragging the card moves the whole graph (grid + axes + curves) as one
  // object; the rest of the board stays a plain writing surface.
  const move = useRef<{ x: number; y: number; ox: number; oy: number } | null>(null);
  const [moving, setMoving] = useState(false);
  // Is a board point (relative to the board's top-left) inside the graph card?
  const inCard = (bx: number, by: number) => showCard && bx >= cx && bx <= cx + cardW && by >= cy && by <= cy + cardH;

  const zoomBy = (factor: number, cxRatio = 0.5, cyRatio = 0.5) => {
    setView((v) => {
      const cx = v.xMin + (v.xMax - v.xMin) * cxRatio;
      const cy = v.yMin + (v.yMax - v.yMin) * (1 - cyRatio);
      return {
        xMin: cx - (cx - v.xMin) * factor,
        xMax: cx + (v.xMax - cx) * factor,
        yMin: cy - (cy - v.yMin) * factor,
        yMax: cy + (v.yMax - cy) * factor,
      };
    });
  };

  // Kept fresh every render so the native (non-passive) wheel listener above
  // always sees current penMode / card geometry without re-binding.
  wheelRef.current = (e: WheelEvent) => {
    if (penMode) return; // don't shift the board while drawing
    const el = svgRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const bx = e.clientX - rect.left;
    const by = e.clientY - rect.top;
    if (!inCard(bx, by)) return; // only the card zooms; the board is inert
    e.preventDefault();
    // Zoom about the cursor, in the card's own frame.
    zoomBy(e.deltaY > 0 ? 1.15 : 1 / 1.15, (bx - cx) / cardW, (by - cy) / cardH);
  };
  const onPointerDown = (e: React.PointerEvent) => {
    if (penMode) return startStroke(e);
    const rect = (e.currentTarget as SVGElement).getBoundingClientRect();
    const bx = e.clientX - rect.left;
    const by = e.clientY - rect.top;
    if (!inCard(bx, by)) return; // clicking the blank board does nothing
    (e.currentTarget as SVGElement).setPointerCapture(e.pointerId);
    move.current = { x: e.clientX, y: e.clientY, ox: cx, oy: cy };
    setMoving(true);
  };
  const onPointerMove = (e: React.PointerEvent) => {
    if (penMode) return extendStroke(e);
    const rect = (e.currentTarget as SVGElement).getBoundingClientRect();
    if (move.current) {
      const m = move.current;
      // Clamp so at least `margin` px of the card always stays on the board —
      // otherwise it can be dragged out of reach (only Reset would recover it).
      const margin = 48;
      const nx = m.ox + (e.clientX - m.x);
      const ny = m.oy + (e.clientY - m.y);
      setCard({
        x: Math.max(margin - cardW, Math.min(nx, W - margin)),
        y: Math.max(margin - cardH, Math.min(ny, H - margin)),
      });
      setHover(null);
      return;
    }
    const bx = e.clientX - rect.left;
    const by = e.clientY - rect.top;
    const first = compiled.find((f) => f.fn && !f.hidden);
    if (!first?.fn || !inCard(bx, by)) return setHover(null);
    // Map the cursor into the card's own coordinate frame.
    const gx = bx - cx;
    const y = evalAt(first.fn, wx(gx), paramScope);
    if (y === null) return setHover(null);
    setHover({ px: gx, py: sy(y), x: wx(gx), y, color: first.color });
  };
  const onPointerUp = (e: React.PointerEvent) => {
    if (penMode) return endStroke(e);
    move.current = null;
    setMoving(false);
    try {
      (e.currentTarget as SVGElement).releasePointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
  };

  const fitY = () => {
    const vis = compiled.filter((f) => f.fn && !f.hidden);
    if (!vis.length) return;
    let lo = Infinity;
    let hi = -Infinity;
    for (let px = 0; px <= cardW; px += 2) {
      const x = wx(px);
      for (const f of vis) {
        const y = evalAt(f.fn!, x, paramScope);
        if (y !== null) {
          lo = Math.min(lo, y);
          hi = Math.max(hi, y);
        }
      }
    }
    if (!Number.isFinite(lo) || !Number.isFinite(hi)) return;
    if (lo === hi) {
      lo -= 1;
      hi += 1;
    }
    const pad = (hi - lo) * 0.1;
    setView((v) => ({ ...v, yMin: lo - pad, yMax: hi + pad }));
  };

  // ── Function list editing ─────────────────────────────────
  const updateExpr = (id: string, expr: string) => setFns((l) => l.map((f) => (f.id === id ? { ...f, expr } : f)));
  const toggleHidden = (id: string) => setFns((l) => l.map((f) => (f.id === id ? { ...f, hidden: !f.hidden } : f)));
  const removeFn = (id: string) => setFns((l) => l.filter((f) => f.id !== id));
  const addFn = () =>
    setFns((l) => (l.length >= 6 ? l : [...l, { id: uid(), expr: "", color: COLORS[l.length % COLORS.length] }]));

  const addDerivative = (f: Fn) => {
    try {
      const d = derivative(normalize(parseExpr(f.expr).body), "x").toString();
      setFns((l) =>
        l.length >= 6 ? l : [...l, { id: uid(), expr: d, color: COLORS[l.length % COLORS.length] }],
      );
      toast.success("Added the derivative");
    } catch {
      toast.error("Can't differentiate that expression");
    }
  };

  // ── Save / load ───────────────────────────────────────────
  const saveCurrent = async () => {
    const expressions = fns.map((f) => f.expr.trim()).filter(Boolean);
    if (!expressions.length) return toast.error("Nothing to save");
    const title = expressions.map((e) => `y=${e}`).join(", ").slice(0, 50);
    try {
      const res = await fetch("/api/graph/saved", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title, expressions, view }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        return toast.error(d.error || "Couldn't save");
      }
      toast.success("Graph saved");
      loadSavedList();
    } catch {
      toast.error("Couldn't save");
    }
  };
  const openSaved = (g: SavedGraph) => {
    setFns(g.expressions.map((e, i) => ({ id: uid(), expr: e, color: COLORS[i % COLORS.length] })));
    if (g.view) setView(g.view);
    setSavedOpen(false);
  };
  const deleteSaved = async (id: string) => {
    try {
      await fetch(`/api/graph/saved/${id}`, { method: "DELETE" });
      setSaved((l) => l.filter((g) => g.id !== id));
    } catch {
      /* ignore */
    }
  };

  // ── Download PNG ──────────────────────────────────────────
  const download = () => {
    const svg = svgRef.current;
    if (!svg) return;
    const clone = svg.cloneNode(true) as SVGSVGElement;
    const bg = document.createElementNS(SVGNS, "rect");
    bg.setAttribute("width", "100%");
    bg.setAttribute("height", "100%");
    bg.setAttribute("fill", bt.bg); // export on the current board colour
    clone.insertBefore(bg, clone.firstChild);
    const str = new XMLSerializer().serializeToString(clone);
    const url = URL.createObjectURL(new Blob([str], { type: "image/svg+xml" }));
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = W * 2;
      canvas.height = H * 2;
      const ctx = canvas.getContext("2d");
      URL.revokeObjectURL(url);
      if (!ctx) return;
      ctx.scale(2, 2);
      ctx.drawImage(img, 0, 0);
      canvas.toBlob((blob) => {
        if (!blob) return;
        const a = document.createElement("a");
        a.href = URL.createObjectURL(blob);
        a.download = "graph.png";
        a.click();
        setTimeout(() => URL.revokeObjectURL(a.href), 1000);
      });
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      toast.error("Couldn't export the image");
    };
    img.src = url;
  };

  // ── Table of values ───────────────────────────────────────
  const visibleForTable = compiled.filter((f) => f.fn && !f.hidden);
  const tableRows = useMemo(() => {
    if (!showTable) return [];
    const rows: { x: number; ys: (number | null)[] }[] = [];
    const n = 11;
    for (let i = 0; i < n; i++) {
      const x = view.xMin + ((view.xMax - view.xMin) * i) / (n - 1);
      rows.push({ x, ys: visibleForTable.map((f) => evalAt(f.fn!, x, paramScope)) });
    }
    return rows;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showTable, compiled, view, paramScope]);

  const originX = view.xMin <= 0 && view.xMax >= 0 ? sx(0) : null;
  const originY = view.yMin <= 0 && view.yMax >= 0 ? sy(0) : null;

  return (
    <div
      ref={boxRef}
      className="relative h-[78vh] min-h-[560px] w-full overflow-hidden rounded-2xl border shadow-sm"
      style={{ touchAction: "none", backgroundColor: bt.bg, borderColor: bt.cardBorder }}
    >
        <svg
          ref={svgRef}
          width={W}
          height={H}
          className={cn("block select-none", penMode ? "cursor-crosshair" : "cursor-default")}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerLeave={() => setHover(null)}
        >
          {/* The graph is a self-contained card that sits on the blank board.
              Everything inside is clipped to the card and moves with it. */}
          <defs>
            <clipPath id={clipId}>
              <rect x={0} y={0} width={cardW} height={cardH} rx={12} />
            </clipPath>
          </defs>

          {showCard && (
            <g transform={`translate(${cx},${cy})`} style={{ cursor: moving ? "grabbing" : "grab" }}>
              {/* card surface */}
              <rect x={0} y={0} width={cardW} height={cardH} rx={12} fill={bt.card} stroke={bt.cardBorder} strokeWidth={1} />

              <g clipPath={`url(#${clipId})`}>
                {/* gridlines */}
                {grid.xs.map((g, i) => (
                  <line key={`x${i}`} x1={sx(g.x)} y1={0} x2={sx(g.x)} y2={cardH} stroke={bt.grid} strokeWidth={g.x === 0 ? 0 : 1} opacity={0.9} />
                ))}
                {grid.ys.map((g, i) => (
                  <line key={`y${i}`} x1={0} y1={sy(g.y)} x2={cardW} y2={sy(g.y)} stroke={bt.grid} strokeWidth={g.y === 0 ? 0 : 1} opacity={0.9} />
                ))}

                {/* axes */}
                {originY !== null && <line x1={0} y1={originY} x2={cardW} y2={originY} stroke={bt.axis} strokeWidth={1.5} />}
                {originX !== null && <line x1={originX} y1={0} x2={originX} y2={cardH} stroke={bt.axis} strokeWidth={1.5} />}

                {/* axis labels */}
                {originY !== null && grid.xs.map((g, i) => (g.x === 0 ? null : (
                  <text key={`xl${i}`} x={sx(g.x)} y={Math.min(cardH - 4, originY + 14)} textAnchor="middle" fontSize={11} fill={bt.label}>{g.label}</text>
                )))}
                {originX !== null && grid.ys.map((g, i) => (g.y === 0 ? null : (
                  <text key={`yl${i}`} x={Math.max(4, originX + 4)} y={sy(g.y) - 3} fontSize={11} fill={bt.label}>{g.label}</text>
                )))}

                {/* inequality shading (behind curves) */}
                {paths.map((p, i) => p.fills.map((d, j) => (
                  <path key={`fill${i}-${j}`} d={d} fill={p.color} fillOpacity={0.15} stroke="none" />
                )))}

                {/* function curves */}
                {paths.map((p, i) => p.segments.map((seg, j) => (
                  <polyline key={`${i}-${j}`} points={seg} fill="none" stroke={p.color} strokeWidth={2.4} strokeLinejoin="round" strokeLinecap="round" />
                )))}

                {/* analysis markers */}
                {analysis && markers.roots.map((r, i) => (
                  <circle key={`r${i}`} cx={sx(r.x)} cy={sy(0)} r={4} fill={bt.marker} stroke={r.color} strokeWidth={2} />
                ))}
                {analysis && markers.inters.map((p, i) => (
                  <circle key={`in${i}`} cx={sx(p.x)} cy={sy(p.y)} r={4.5} fill={bt.marker} stroke={bt.axis} strokeWidth={2} />
                ))}

                {/* hover trace (off while drawing) */}
                {!penMode && hover && <circle cx={hover.px} cy={hover.py} r={4.5} fill={hover.color} stroke={bt.hoverRing} strokeWidth={1.5} />}
              </g>

              {/* crisp frame above the clipped grid */}
              <rect x={0} y={0} width={cardW} height={cardH} rx={12} fill="none" stroke={bt.cardBorder} strokeWidth={1} pointerEvents="none" />
            </g>
          )}

          {/* whiteboard ink (smart-pen) — drawn on the board, stays put when
              the graph is moved */}
          {strokes.map((st) =>
            st.pts.length === 1 ? (
              <circle key={st.id} cx={st.pts[0].x} cy={st.pts[0].y} r={st.width / 2} fill={st.color} opacity={st.opacity} />
            ) : (
              <polyline
                key={st.id}
                points={st.pts.map((p) => `${p.x},${p.y}`).join(" ")}
                fill="none"
                stroke={st.color}
                strokeWidth={st.width}
                strokeOpacity={st.opacity}
                strokeLinejoin="round"
                strokeLinecap="round"
              />
            ),
          )}
        </svg>

        {/* View window + parameter sliders, beside the graph card (only when a
            graph exists). xMin/xMax/yMin/yMax and any A,B,k parameters all live
            here as sliders — the number panels are gone. */}
        {showCard && (() => {
          const rows = 4 + (allParams.length ? allParams.length + 1 : 0);
          const panelW = 214;
          const panelH = rows * 28 + 44;
          let left = cx + cardW + 12;
          let top = cy;
          if (left + panelW > W - 8) left = cx - panelW - 12; // try the left of the card
          if (left < 8) {
            left = Math.max(8, Math.min(cx, W - panelW - 8)); // else drop below the card
            top = cy + cardH + 12;
          }
          top = Math.max(8, Math.min(top, H - panelH - 8));
          const setBound = (k: "xMin" | "xMax" | "yMin" | "yMax", v: number) =>
            setView((vw) => {
              if (k === "xMin") return { ...vw, xMin: Math.min(v, vw.xMax - 0.5) };
              if (k === "xMax") return { ...vw, xMax: Math.max(v, vw.xMin + 0.5) };
              if (k === "yMin") return { ...vw, yMin: Math.min(v, vw.yMax - 0.5) };
              return { ...vw, yMax: Math.max(v, vw.yMin + 0.5) };
            });
          // The view sliders track the current window: their extent grows as the
          // student zooms out, so a zoomed view is always representable (no pinning
          // at ±50, no sudden snap when nudging a slider after zooming out).
          const vmag = Math.max(10, Math.abs(view.xMin), Math.abs(view.xMax), Math.abs(view.yMin), Math.abs(view.yMax));
          const bound = Math.ceil((vmag * 1.15) / 10) * 10;
          const bstep = bound > 120 ? 1 : 0.5;
          const clampShow = (n: number) => Math.max(-bound, Math.min(bound, n));
          return (
            <div
              className="absolute z-10 flex flex-col gap-1.5 rounded-2xl border p-3 shadow-xl backdrop-blur"
              style={{ left, top, width: panelW, backgroundColor: bt.card, borderColor: bt.cardBorder }}
            >
              <div className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wide" style={{ color: bt.label }}>
                <SlidersHorizontal className="h-3.5 w-3.5" /> View
              </div>
              {(["xMin", "xMax", "yMin", "yMax"] as const).map((k) => (
                <div key={k} className="flex items-center gap-2">
                  <span className="w-9 font-mono text-[11px] font-bold" style={{ color: bt.axis }}>{k}</span>
                  <input
                    type="range"
                    min={-bound}
                    max={bound}
                    step={bstep}
                    value={clampShow(view[k])}
                    onChange={(e) => setBound(k, Number(e.target.value))}
                    className="h-1 flex-1 cursor-pointer accent-primary"
                  />
                  <span className="w-9 text-right font-mono text-[11px]" style={{ color: bt.label }}>{fmt(view[k])}</span>
                </div>
              ))}
              {allParams.length > 0 && (
                <>
                  <div className="mt-1 border-t pt-2 text-[11px] font-bold uppercase tracking-wide" style={{ color: bt.label, borderColor: bt.cardBorder }}>
                    Parameters
                  </div>
                  {allParams.map((p) => (
                    <div key={p} className="flex items-center gap-2">
                      <span className="w-9 font-mono text-xs font-bold" style={{ color: bt.axis }}>{p}</span>
                      <input
                        type="range"
                        min={-10}
                        max={10}
                        step={0.1}
                        value={paramScope[p]}
                        onChange={(e) => setParamVals((v) => ({ ...v, [p]: Number(e.target.value) }))}
                        className="h-1 flex-1 cursor-pointer accent-primary"
                      />
                      <span className="w-9 text-right font-mono text-xs" style={{ color: bt.label }}>{fmt(paramScope[p])}</span>
                    </div>
                  ))}
                </>
              )}
            </div>
          );
        })()}

        {/* Smart-pen toolbar */}
        {penMode && (
          <div className="absolute right-2 top-2 z-10 flex flex-wrap items-center gap-1 rounded-xl border border-border bg-surface/95 p-1.5 shadow-lg backdrop-blur">
            <PenIconBtn active={penTool === "pen"} onClick={() => setPenTool("pen")} title="Pen"><Pen className="h-4 w-4" /></PenIconBtn>
            <PenIconBtn active={penTool === "highlighter"} onClick={() => setPenTool("highlighter")} title="Highlighter"><Highlighter className="h-4 w-4" /></PenIconBtn>
            <PenIconBtn active={penTool === "eraser"} onClick={() => setPenTool("eraser")} title="Eraser"><Eraser className="h-4 w-4" /></PenIconBtn>
            <PenIconBtn active={penTool === "select"} onClick={() => setPenTool("select")} title="Select writing & graph it"><BoxSelect className="h-4 w-4" /></PenIconBtn>
            {(penTool === "pen" || penTool === "highlighter") && (
              <div className="mx-1 flex items-center gap-1">
                {PEN_COLORS.map((c) => (
                  <button
                    key={c}
                    onClick={() => setPenColor(c)}
                    title={`Colour ${c}`}
                    className={cn(
                      "h-5 w-5 rounded-full border border-border transition hover:scale-110",
                      penColor === c && "ring-2 ring-primary ring-offset-1 ring-offset-surface",
                    )}
                    style={{ backgroundColor: c }}
                  />
                ))}
              </div>
            )}
            <PenIconBtn onClick={undoInk} title="Undo"><Undo2 className="h-4 w-4" /></PenIconBtn>
            <PenIconBtn onClick={clearInk} title="Clear all ink"><Trash2 className="h-4 w-4" /></PenIconBtn>
            <PenIconBtn onClick={() => setPenMode(false)} title="Exit pen mode"><X className="h-4 w-4" /></PenIconBtn>
          </div>
        )}

        {hover && !penMode && (
          <div className="pointer-events-none absolute left-3 top-12 rounded-lg bg-text-primary/90 px-2.5 py-1 font-mono text-xs text-white shadow">
            x={fmt(hover.x)}, y={fmt(hover.y)}
          </div>
        )}

        {/* Lasso marquee (while dragging) */}
        {penMode && penTool === "select" && marquee && (
          <div
            className="pointer-events-none absolute z-10 rounded border-2 border-dashed"
            style={{
              left: Math.min(marquee.x, marquee.x + marquee.w),
              top: Math.min(marquee.y, marquee.y + marquee.h),
              width: Math.abs(marquee.w),
              height: Math.abs(marquee.h),
              borderColor: bt.sel,
              backgroundColor: `${bt.sel}1f`,
            }}
          />
        )}

        {/* Selection box + contextual toolbar (like a smartboard) */}
        {penMode && penTool === "select" && selRect && selection.length > 0 && (
          <>
            <div
              className="pointer-events-none absolute z-10 rounded-md border-2"
              style={{ left: selRect.x, top: selRect.y, width: selRect.w, height: selRect.h, borderColor: bt.sel }}
            >
              {[
                "left-0 top-0",
                "right-0 top-0",
                "left-0 bottom-0",
                "right-0 bottom-0",
              ].map((pos) => (
                <span
                  key={pos}
                  className={cn("absolute h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2", pos)}
                  style={{
                    left: pos.includes("right") ? selRect.w : 0,
                    top: pos.includes("bottom") ? selRect.h : 0,
                    borderColor: bt.sel,
                    backgroundColor: bt.card,
                  }}
                />
              ))}
            </div>
            {/* toolbar above the selection */}
            <div
              className="absolute z-20 flex items-center gap-1 rounded-xl border border-border bg-surface p-1 shadow-lg"
              style={{
                left: Math.max(4, selRect.x),
                top: selRect.y > 46 ? selRect.y - 42 : selRect.y + selRect.h + 6,
              }}
            >
              <button
                onClick={graphSelection}
                disabled={recognizing}
                className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-xs font-bold text-white transition hover:bg-primary-dark disabled:opacity-60"
              >
                {recognizing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <LineChart className="h-3.5 w-3.5" />}
                {recognizing ? "Reading…" : "Graph"}
              </button>
              <PenIconBtn onClick={deleteSelection} title="Delete selection"><Trash2 className="h-4 w-4" /></PenIconBtn>
              <PenIconBtn onClick={() => { setSelection([]); setSelRect(null); }} title="Deselect"><X className="h-4 w-4" /></PenIconBtn>
            </div>
          </>
        )}

        {/* Functions — add & edit equations, docked at the top of the board.
            Hidden while drawing so the pen toolbar owns the top strip. */}
        {!penMode && (
        <div
          className="absolute left-1/2 top-3 z-20 flex max-w-[calc(100%-24px)] -translate-x-1/2 flex-wrap items-center justify-center gap-1.5 rounded-2xl border p-1.5 shadow-lg backdrop-blur"
          style={{ backgroundColor: bt.card, borderColor: bt.cardBorder }}
        >
          {compiled.map((f) => (
            <div key={f.id} className="flex items-center gap-1 rounded-xl border px-1.5 py-1" style={{ borderColor: bt.cardBorder }}>
              <span className="h-3 w-3 shrink-0 rounded-full" style={{ backgroundColor: f.color, opacity: f.hidden ? 0.3 : 1 }} />
              <span className="font-mono text-xs font-semibold" style={{ color: bt.label }}>y=</span>
              <input
                value={f.expr}
                onChange={(e) => updateExpr(f.id, e.target.value)}
                placeholder="x^2 - 3"
                spellCheck={false}
                className="w-24 bg-transparent font-mono text-sm outline-none sm:w-32"
                style={{ color: f.error ? "#ef4444" : bt.axis }}
              />
              <button onClick={() => addDerivative(f)} title="Add derivative (d/dx)" className={cn("rounded p-1 transition", boardDark ? "hover:bg-white/10" : "hover:bg-black/5")} style={{ color: bt.label }}>
                <FunctionSquare className="h-3.5 w-3.5" />
              </button>
              <button onClick={() => toggleHidden(f.id)} title={f.hidden ? "Show" : "Hide"} className={cn("rounded p-1 transition", boardDark ? "hover:bg-white/10" : "hover:bg-black/5")} style={{ color: bt.label }}>
                {f.hidden ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
              </button>
              <button onClick={() => removeFn(f.id)} title="Remove" className={cn("rounded p-1 transition", boardDark ? "hover:bg-white/10" : "hover:bg-black/5")} style={{ color: bt.label }}>
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>
          ))}
          <button
            onClick={addFn}
            disabled={fns.length >= 6}
            className="inline-flex items-center gap-1 rounded-xl bg-primary px-2.5 py-1.5 text-xs font-bold text-white shadow-sm transition hover:bg-primary-dark disabled:opacity-40"
          >
            <Plus className="h-3.5 w-3.5" /> Add
          </button>
        </div>
        )}

        {/* Analysis results (floating) */}
        {analysis && (markers.roots.length > 0 || markers.inters.length > 0) && (
          <div
            className="absolute left-4 top-20 z-20 max-w-[46%] rounded-2xl border p-3 text-xs shadow-xl backdrop-blur"
            style={{ backgroundColor: bt.card, borderColor: bt.cardBorder }}
          >
            <div className="mb-1 text-[11px] font-bold uppercase tracking-wide" style={{ color: bt.label }}>Analysis</div>
            {markers.roots.length > 0 && (
              <p style={{ color: bt.axis }}>
                <span className="font-semibold">Roots (x): </span>
                {markers.roots.map((r) => fmt(r.x)).join(", ")}
              </p>
            )}
            {markers.inters.length > 0 && (
              <p className="mt-1" style={{ color: bt.axis }}>
                <span className="font-semibold">Intersections: </span>
                {markers.inters.map((p) => `(${fmt(p.x)}, ${fmt(p.y)})`).join(", ")}
              </p>
            )}
          </div>
        )}

        {/* Value table (floating) */}
        {showTable && visibleForTable.length > 0 && (
          <div
            className="absolute bottom-4 left-4 z-20 max-h-[42%] max-w-[48%] overflow-auto rounded-2xl border p-2.5 shadow-xl backdrop-blur"
            style={{ backgroundColor: bt.card, borderColor: bt.cardBorder }}
          >
            <div className="mb-1 flex items-center justify-between">
              <span className="text-[11px] font-bold uppercase tracking-wide" style={{ color: bt.label }}>Table</span>
              <button onClick={() => setShowTable(false)} title="Close" style={{ color: bt.label }}><X className="h-3.5 w-3.5" /></button>
            </div>
            <table className="w-full text-xs">
              <thead>
                <tr>
                  <th className="px-2 py-1 text-left font-semibold" style={{ color: bt.label }}>x</th>
                  {visibleForTable.map((f) => (
                    <th key={f.id} className="px-2 py-1 text-right font-semibold" style={{ color: f.color }}>y</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {tableRows.map((r, i) => (
                  <tr key={i} style={{ borderTop: `1px solid ${bt.cardBorder}` }}>
                    <td className="px-2 py-1 font-mono" style={{ color: bt.label }}>{fmt(r.x)}</td>
                    {r.ys.map((y, j) => (
                      <td key={j} className="px-2 py-1 text-right font-mono" style={{ color: bt.axis }}>{y === null ? "—" : fmt(y)}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Saved graphs (floating) */}
        {savedOpen && (
          <div
            className="absolute bottom-4 left-1/2 z-30 max-h-[52%] w-64 -translate-x-1/2 overflow-y-auto rounded-2xl border p-1.5 shadow-xl backdrop-blur"
            style={{ backgroundColor: bt.card, borderColor: bt.cardBorder }}
          >
            <div className="mb-1 flex items-center justify-between px-1.5 pt-1">
              <span className="text-[11px] font-bold uppercase tracking-wide" style={{ color: bt.label }}>Saved graphs</span>
              <button onClick={() => setSavedOpen(false)} title="Close" style={{ color: bt.label }}><X className="h-3.5 w-3.5" /></button>
            </div>
            {saved.length === 0 ? (
              <p className="px-2 py-2 text-xs" style={{ color: bt.label }}>No saved graphs yet.</p>
            ) : (
              saved.map((g) => (
                <div key={g.id} className={cn("flex items-center gap-1 rounded-lg px-1", boardDark ? "hover:bg-white/10" : "hover:bg-black/5")}>
                  <button onClick={() => openSaved(g)} className="min-w-0 flex-1 truncate py-1.5 pl-1.5 text-left font-mono text-xs" style={{ color: bt.axis }}>{g.title}</button>
                  <button onClick={() => deleteSaved(g.id)} title="Delete" className="rounded-md p-1" style={{ color: bt.label }}><Trash2 className="h-3.5 w-3.5" /></button>
                </div>
              ))
            )}
          </div>
        )}

        {/* Tool dot — tap to expand every graph tool (keeps the board clean) */}
        <div className="absolute bottom-4 right-4 z-40 flex flex-col items-end gap-2">
          {menuOpen && (
            <div
              className="mb-1 grid w-[240px] grid-cols-3 gap-1 rounded-2xl border p-2 shadow-2xl backdrop-blur"
              style={{ backgroundColor: bt.card, borderColor: bt.cardBorder }}
            >
              {[
                { icon: ZoomIn, label: "In", onClick: () => zoomBy(1 / 1.4) },
                { icon: ZoomOut, label: "Out", onClick: () => zoomBy(1.4) },
                { icon: Maximize2, label: "Fit Y", onClick: fitY },
                { icon: RotateCcw, label: "Reset", onClick: () => { setView(DEFAULT_VIEW); setCard(null); } },
                { icon: TableIcon, label: "Table", onClick: () => setShowTable((s) => !s), active: showTable },
                { icon: Activity, label: "Analyse", onClick: () => setAnalysis((s) => !s), active: analysis },
                { icon: Pen, label: "Pen", onClick: () => { setPenMode((p) => !p); setMenuOpen(false); }, active: penMode },
                { icon: Save, label: "Save", onClick: saveCurrent },
                { icon: FolderOpen, label: "Saved", onClick: () => { if (!savedOpen) loadSavedList(); setSavedOpen((s) => !s); }, active: savedOpen },
                { icon: Download, label: "PNG", onClick: download },
                { icon: isFull ? Shrink : Expand, label: isFull ? "Window" : "Full", onClick: toggleFull },
                { icon: boardDark ? Sun : Moon, label: boardDark ? "Light" : "Dark", onClick: toggleDark },
              ]
                // Smart-pen (handwrite → AI graphs it) is hidden when AI is off.
                .filter((t) => aiTools || t.label !== "Pen")
                .map((t) => (
                <button
                  key={t.label}
                  onClick={t.onClick}
                  title={t.label}
                  className={cn(
                    "flex flex-col items-center gap-1 rounded-xl px-1 py-2 text-[10px] font-semibold transition",
                    !t.active && (boardDark ? "hover:bg-white/10" : "hover:bg-black/5"),
                  )}
                  style={t.active ? { backgroundColor: "#2563eb", color: "#ffffff" } : { color: bt.axis }}
                >
                  <t.icon className="h-4 w-4" />
                  {t.label}
                </button>
              ))}
            </div>
          )}
          <button
            onClick={() => setMenuOpen((m) => !m)}
            title={menuOpen ? "Close tools" : "Tools"}
            aria-label={menuOpen ? "Close tools" : "Open tools"}
            className="flex h-14 w-14 items-center justify-center rounded-full text-white shadow-2xl transition hover:brightness-110 active:scale-95"
            style={{ backgroundImage: "linear-gradient(135deg,#2563eb,#7c3aed)" }}
          >
            {menuOpen ? <X className="h-6 w-6" /> : <LayoutGrid className="h-6 w-6" />}
          </button>
        </div>
      </div>
  );
}

function PenIconBtn({
  children,
  onClick,
  title,
  active,
}: {
  children: React.ReactNode;
  onClick: () => void;
  title: string;
  active?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      title={title}
      aria-label={title}
      className={cn(
        "flex h-8 w-8 items-center justify-center rounded-lg transition",
        active ? "bg-primary text-white" : "text-text-secondary hover:bg-border/50 hover:text-text-primary",
      )}
    >
      {children}
    </button>
  );
}
