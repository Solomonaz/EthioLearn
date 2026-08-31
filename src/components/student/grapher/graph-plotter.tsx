"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { compile } from "mathjs";
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
} from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Interactive 2D function grapher (no paid services).
 *
 * Expressions are parsed/evaluated safely with mathjs (never eval). Each visible
 * function is sampled per pixel column and drawn as an SVG polyline, breaking the
 * line at discontinuities/asymptotes. Supports wheel-zoom, drag-pan, a hover
 * value trace, and a small table of values.
 */

const COLORS = ["#2563EB", "#DC2626", "#16A34A", "#7C3AED", "#EA580C", "#0891B2"];

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

const DEFAULT_VIEW: View = { xMin: -10, xMax: 10, yMin: -10, yMax: 10 };

let counter = 0;
const uid = () => `fn_${++counter}`;

/** Strip a leading "y =" / "f(x) =" so students can paste natural equations. */
function normalize(expr: string): string {
  return expr.trim().replace(/^\s*(?:[yY]|[fFgGhH]\s*\(\s*[xX]\s*\))\s*=\s*/, "");
}

type Compiled = { evaluate: (scope: Record<string, number>) => unknown };

function tryCompile(expr: string): { fn: Compiled | null; error: boolean } {
  const e = normalize(expr);
  if (!e) return { fn: null, error: false };
  try {
    const fn = compile(e) as Compiled;
    fn.evaluate({ x: 1 }); // probe once to surface obvious errors
    return { fn, error: false };
  } catch {
    return { fn: null, error: true };
  }
}

function evalAt(fn: Compiled, x: number): number | null {
  try {
    const y = fn.evaluate({ x });
    return typeof y === "number" && Number.isFinite(y) ? y : null;
  } catch {
    return null;
  }
}

/** A "nice" gridline step (1/2/5 × 10ⁿ) for a given range and target tick count. */
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

export function GraphPlotter({ initial }: { initial?: string[] }) {
  const [fns, setFns] = useState<Fn[]>(() => {
    const seed = (initial ?? []).filter((s) => s.trim()).slice(0, 6);
    const list = (seed.length ? seed : ["x^2"]).map((expr, i) => ({
      id: uid(),
      expr,
      color: COLORS[i % COLORS.length],
    }));
    return list;
  });
  const [view, setView] = useState<View>(DEFAULT_VIEW);
  const [showTable, setShowTable] = useState(false);
  const [hover, setHover] = useState<{ px: number; py: number; x: number; y: number; color: string } | null>(null);

  // ── Measure the plot area ─────────────────────────────────
  const boxRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 640, h: 420 });
  useEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      setSize({ w: el.clientWidth, h: el.clientHeight });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const { w: W, h: H } = size;

  // ── Compile visible functions ─────────────────────────────
  const compiled = useMemo(
    () =>
      fns.map((f) => ({
        ...f,
        ...tryCompile(f.expr),
      })),
    [fns],
  );

  // ── Coordinate transforms ─────────────────────────────────
  const sx = useCallback((x: number) => ((x - view.xMin) / (view.xMax - view.xMin)) * W, [view, W]);
  const sy = useCallback((y: number) => H - ((y - view.yMin) / (view.yMax - view.yMin)) * H, [view, H]);
  const wx = useCallback((px: number) => view.xMin + (px / W) * (view.xMax - view.xMin), [view, W]);

  // ── Build polyline segments for each function ─────────────
  const paths = useMemo(() => {
    if (!W || !H) return [];
    const yPad = (view.yMax - view.yMin) * 4; // allow lines a bit off-screen
    return compiled
      .filter((f) => f.fn && !f.hidden)
      .map((f) => {
        const segments: string[] = [];
        let cur: string[] = [];
        let prevY: number | null = null;
        for (let px = 0; px <= W; px++) {
          const x = wx(px);
          const y = evalAt(f.fn!, x);
          const off = y === null || y > view.yMax + yPad || y < view.yMin - yPad;
          const jump = prevY !== null && y !== null && Math.abs(y - prevY) > (view.yMax - view.yMin) * 4;
          if (off || jump) {
            if (cur.length) segments.push(cur.join(" "));
            cur = [];
            prevY = y;
            continue;
          }
          cur.push(`${px.toFixed(1)},${sy(y!).toFixed(1)}`);
          prevY = y;
        }
        if (cur.length) segments.push(cur.join(" "));
        return { color: f.color, segments };
      });
  }, [compiled, W, H, view, wx, sy]);

  // ── Gridlines ─────────────────────────────────────────────
  const grid = useMemo(() => {
    const xs: { x: number; label: string }[] = [];
    const ys: { y: number; label: string }[] = [];
    const stepX = niceStep(view.xMax - view.xMin, 10);
    const stepY = niceStep(view.yMax - view.yMin, 8);
    for (let x = Math.ceil(view.xMin / stepX) * stepX; x <= view.xMax; x += stepX)
      xs.push({ x, label: fmt(x) });
    for (let y = Math.ceil(view.yMin / stepY) * stepY; y <= view.yMax; y += stepY)
      ys.push({ y, label: fmt(y) });
    return { xs, ys };
  }, [view]);

  // ── Interactions ──────────────────────────────────────────
  const drag = useRef<{ x: number; y: number; view: View } | null>(null);

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

  const onWheel = (e: React.WheelEvent) => {
    e.preventDefault();
    const rect = (e.currentTarget as SVGElement).getBoundingClientRect();
    const cxRatio = (e.clientX - rect.left) / rect.width;
    const cyRatio = (e.clientY - rect.top) / rect.height;
    zoomBy(e.deltaY > 0 ? 1.15 : 1 / 1.15, cxRatio, cyRatio);
  };

  const onPointerDown = (e: React.PointerEvent) => {
    (e.currentTarget as SVGElement).setPointerCapture(e.pointerId);
    drag.current = { x: e.clientX, y: e.clientY, view };
  };
  const onPointerMove = (e: React.PointerEvent) => {
    const rect = (e.currentTarget as SVGElement).getBoundingClientRect();
    if (drag.current) {
      const d = drag.current;
      const dxW = ((e.clientX - d.x) / rect.width) * (d.view.xMax - d.view.xMin);
      const dyW = ((e.clientY - d.y) / rect.height) * (d.view.yMax - d.view.yMin);
      setView({
        xMin: d.view.xMin - dxW,
        xMax: d.view.xMax - dxW,
        yMin: d.view.yMin + dyW,
        yMax: d.view.yMax + dyW,
      });
      setHover(null);
      return;
    }
    // hover trace on the first visible/valid function
    const first = compiled.find((f) => f.fn && !f.hidden);
    if (!first?.fn) {
      setHover(null);
      return;
    }
    const px = e.clientX - rect.left;
    const x = wx(px);
    const y = evalAt(first.fn, x);
    if (y === null) {
      setHover(null);
      return;
    }
    setHover({ px, py: sy(y), x, y, color: first.color });
  };
  const onPointerUp = (e: React.PointerEvent) => {
    drag.current = null;
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
    for (let px = 0; px <= W; px += 2) {
      const x = wx(px);
      for (const f of vis) {
        const y = evalAt(f.fn!, x);
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
  const updateExpr = (id: string, expr: string) =>
    setFns((list) => list.map((f) => (f.id === id ? { ...f, expr } : f)));
  const toggleHidden = (id: string) =>
    setFns((list) => list.map((f) => (f.id === id ? { ...f, hidden: !f.hidden } : f)));
  const removeFn = (id: string) => setFns((list) => list.filter((f) => f.id !== id));
  const addFn = () =>
    setFns((list) =>
      list.length >= 6 ? list : [...list, { id: uid(), expr: "", color: COLORS[list.length % COLORS.length] }],
    );

  // ── Table of values ───────────────────────────────────────
  const tableRows = useMemo(() => {
    if (!showTable) return [];
    const vis = compiled.filter((f) => f.fn && !f.hidden);
    const rows: { x: number; ys: (number | null)[] }[] = [];
    const n = 11;
    for (let i = 0; i < n; i++) {
      const x = view.xMin + ((view.xMax - view.xMin) * i) / (n - 1);
      rows.push({ x, ys: vis.map((f) => evalAt(f.fn!, x)) });
    }
    return rows;
  }, [showTable, compiled, view]);
  const visibleForTable = compiled.filter((f) => f.fn && !f.hidden);

  const originX = view.xMin <= 0 && view.xMax >= 0 ? sx(0) : null;
  const originY = view.yMin <= 0 && view.yMax >= 0 ? sy(0) : null;

  return (
    <div className="flex flex-col gap-4 lg:flex-row">
      {/* ── Controls ─────────────────────────────────────── */}
      <div className="w-full shrink-0 space-y-3 lg:w-80">
        <div className="rounded-2xl border border-border bg-surface p-4 shadow-sm">
          <div className="mb-2 flex items-center justify-between">
            <h2 className="text-sm font-bold text-text-primary">Functions</h2>
            <button
              onClick={addFn}
              disabled={fns.length >= 6}
              className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2.5 py-1 text-xs font-semibold text-primary hover:bg-primary/20 disabled:opacity-40"
            >
              <Plus className="h-3.5 w-3.5" /> Add
            </button>
          </div>
          <div className="space-y-2">
            {compiled.map((f) => (
              <div key={f.id} className="flex items-center gap-2">
                <span className="h-3.5 w-3.5 shrink-0 rounded-full" style={{ backgroundColor: f.color }} />
                <div className="relative flex-1">
                  <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm font-semibold text-text-muted">
                    y=
                  </span>
                  <input
                    value={f.expr}
                    onChange={(e) => updateExpr(f.id, e.target.value)}
                    placeholder="x^2 - 3"
                    spellCheck={false}
                    className={cn(
                      "w-full rounded-lg border bg-background py-2 pl-8 pr-2 font-mono text-sm text-text-primary outline-none transition focus:ring-2 focus:ring-primary/20",
                      f.error ? "border-error focus:border-error" : "border-border focus:border-primary",
                    )}
                  />
                </div>
                <button
                  onClick={() => toggleHidden(f.id)}
                  title={f.hidden ? "Show" : "Hide"}
                  className="rounded-md p-1.5 text-text-muted hover:bg-border/50 hover:text-text-primary"
                >
                  {f.hidden ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
                <button
                  onClick={() => removeFn(f.id)}
                  title="Remove"
                  className="rounded-md p-1.5 text-text-muted hover:bg-error/10 hover:text-error"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            ))}
          </div>
          <p className="mt-2 text-xs text-text-muted">
            Use <code className="rounded bg-background px-1">x</code>, <code className="rounded bg-background px-1">^</code>,
            and functions like <code className="rounded bg-background px-1">sin</code>,{" "}
            <code className="rounded bg-background px-1">sqrt</code>, <code className="rounded bg-background px-1">abs</code>.
          </p>
        </div>

        {/* range inputs */}
        <div className="rounded-2xl border border-border bg-surface p-4 shadow-sm">
          <h2 className="mb-2 text-sm font-bold text-text-primary">Window</h2>
          <div className="grid grid-cols-2 gap-2">
            {(["xMin", "xMax", "yMin", "yMax"] as const).map((k) => (
              <label key={k} className="text-xs font-medium text-text-secondary">
                {k}
                <input
                  type="number"
                  value={Math.round(view[k] * 100) / 100}
                  onChange={(e) => {
                    const n = Number(e.target.value);
                    if (Number.isFinite(n)) setView((v) => ({ ...v, [k]: n }));
                  }}
                  className="mt-0.5 w-full rounded-lg border border-border bg-background px-2 py-1.5 text-sm text-text-primary outline-none focus:border-primary focus:ring-2 focus:ring-primary/20"
                />
              </label>
            ))}
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            <ToolBtn onClick={() => zoomBy(1 / 1.4)}><ZoomIn className="h-4 w-4" /> In</ToolBtn>
            <ToolBtn onClick={() => zoomBy(1.4)}><ZoomOut className="h-4 w-4" /> Out</ToolBtn>
            <ToolBtn onClick={fitY}><Maximize2 className="h-4 w-4" /> Fit Y</ToolBtn>
            <ToolBtn onClick={() => setView(DEFAULT_VIEW)}><RotateCcw className="h-4 w-4" /> Reset</ToolBtn>
            <ToolBtn onClick={() => setShowTable((s) => !s)} active={showTable}>
              <TableIcon className="h-4 w-4" /> Table
            </ToolBtn>
          </div>
        </div>

        {/* value table */}
        {showTable && visibleForTable.length > 0 && (
          <div className="overflow-x-auto rounded-2xl border border-border bg-surface p-3 shadow-sm">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-text-muted">
                  <th className="px-2 py-1 text-left font-semibold">x</th>
                  {visibleForTable.map((f) => (
                    <th key={f.id} className="px-2 py-1 text-right font-semibold" style={{ color: f.color }}>
                      y
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {tableRows.map((r, i) => (
                  <tr key={i} className="border-t border-border">
                    <td className="px-2 py-1 font-mono text-text-secondary">{fmt(r.x)}</td>
                    {r.ys.map((y, j) => (
                      <td key={j} className="px-2 py-1 text-right font-mono text-text-primary">
                        {y === null ? "—" : fmt(y)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* ── Graph ────────────────────────────────────────── */}
      <div
        ref={boxRef}
        className="relative min-h-[360px] flex-1 overflow-hidden rounded-2xl border border-border bg-surface shadow-sm"
        style={{ touchAction: "none" }}
      >
        <svg
          width={W}
          height={H}
          className="block cursor-crosshair select-none"
          onWheel={onWheel}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerLeave={() => setHover(null)}
        >
          {/* gridlines */}
          {grid.xs.map((g, i) => (
            <line key={`x${i}`} x1={sx(g.x)} y1={0} x2={sx(g.x)} y2={H} stroke="var(--color-border)" strokeWidth={g.x === 0 ? 0 : 1} opacity={0.6} />
          ))}
          {grid.ys.map((g, i) => (
            <line key={`y${i}`} x1={0} y1={sy(g.y)} x2={W} y2={sy(g.y)} stroke="var(--color-border)" strokeWidth={g.y === 0 ? 0 : 1} opacity={0.6} />
          ))}

          {/* axes */}
          {originY !== null && <line x1={0} y1={originY} x2={W} y2={originY} stroke="var(--color-text-muted)" strokeWidth={1.5} />}
          {originX !== null && <line x1={originX} y1={0} x2={originX} y2={H} stroke="var(--color-text-muted)" strokeWidth={1.5} />}

          {/* axis labels */}
          {originY !== null &&
            grid.xs.map((g, i) =>
              g.x === 0 ? null : (
                <text key={`xl${i}`} x={sx(g.x)} y={Math.min(H - 4, originY + 14)} textAnchor="middle" fontSize={11} fill="var(--color-text-muted)">
                  {g.label}
                </text>
              ),
            )}
          {originX !== null &&
            grid.ys.map((g, i) =>
              g.y === 0 ? null : (
                <text key={`yl${i}`} x={Math.max(4, originX + 4)} y={sy(g.y) - 3} fontSize={11} fill="var(--color-text-muted)">
                  {g.label}
                </text>
              ),
            )}

          {/* function curves */}
          {paths.map((p, i) =>
            p.segments.map((seg, j) => (
              <polyline key={`${i}-${j}`} points={seg} fill="none" stroke={p.color} strokeWidth={2.4} strokeLinejoin="round" strokeLinecap="round" />
            )),
          )}

          {/* hover trace */}
          {hover && (
            <g>
              <circle cx={hover.px} cy={hover.py} r={4.5} fill={hover.color} stroke="#fff" strokeWidth={1.5} />
            </g>
          )}
        </svg>

        {hover && (
          <div className="pointer-events-none absolute left-3 top-3 rounded-lg bg-text-primary/90 px-2.5 py-1 font-mono text-xs text-white shadow">
            x={fmt(hover.x)}, y={fmt(hover.y)}
          </div>
        )}
      </div>
    </div>
  );
}

function ToolBtn({
  children,
  onClick,
  active,
}: {
  children: React.ReactNode;
  onClick: () => void;
  active?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "inline-flex items-center gap-1 rounded-full px-3 py-1.5 text-xs font-semibold transition",
        active
          ? "bg-primary text-white"
          : "bg-background text-text-secondary ring-1 ring-border hover:bg-border/50",
      )}
    >
      {children}
    </button>
  );
}
