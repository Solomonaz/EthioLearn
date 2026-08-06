"use client";

import { useEffect, useRef, useState } from "react";
import {
  StickyNote,
  X,
  Pencil,
  Eraser,
  Trash2,
  Save,
  Type,
  GripHorizontal,
  Plus,
} from "lucide-react";
import { toast } from "@/components/ui/sonner";

// Preset ink colours + a custom picker.
const COLORS = ["#1f2937", "#dc2626", "#2563eb", "#16a34a", "#d97706", "#7c3aed"];
const UI_KEY = "ethiolearn:student-notes:v1";
const PANEL_W = 360;
const CANVAS_W = 320;
const CANVAS_H = 240;
const JSON_HEADERS = { "Content-Type": "application/json" };

type Mode = "write" | "draw";
type Tool = "pen" | "eraser";
type NoteMeta = { id: string; title: string; updatedAt: string };

function clampPos(x: number, y: number) {
  const pad = 8;
  const w = typeof window !== "undefined" ? window.innerWidth : 1200;
  const h = typeof window !== "undefined" ? window.innerHeight : 800;
  const maxX = Math.max(pad, w - PANEL_W - pad);
  const maxY = Math.max(pad, h - 80 - pad); // keep the header on-screen
  return { x: Math.max(pad, Math.min(x, maxX)), y: Math.max(pad, Math.min(y, maxY)) };
}

// Paint a saved sketch (or clear) onto the shared canvas. Pure — safe to call
// from anywhere without worrying about stale closures.
function paintCanvas(c: HTMLCanvasElement | null, drawing: string | null) {
  if (!c) return;
  const ctx = c.getContext("2d");
  if (!ctx) return;
  ctx.clearRect(0, 0, c.width, c.height);
  if (drawing) {
    const img = new Image();
    img.onload = () => ctx.drawImage(img, 0, 0);
    img.src = drawing;
  }
}

export function StudentNotes() {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState({ x: 24, y: 96 });
  const [mode, setMode] = useState<Mode>("write");

  // The note collection + which one is active.
  const [notes, setNotes] = useState<NoteMeta[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [text, setText] = useState("");

  const [color, setColor] = useState(COLORS[0]);
  const [tool, setTool] = useState<Tool>("pen");
  const [penWidth, setPenWidth] = useState(3);
  const [dragging, setDragging] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const drawingRef = useRef(false);
  const lastRef = useRef<{ x: number; y: number } | null>(null);
  const dragRef = useRef<{ sx: number; sy: number; ox: number; oy: number } | null>(null);
  const busyRef = useRef(false); // serialises switch/create/delete

  // ── Load a note's full content into the editor + canvas ──
  async function openNote(id: string) {
    try {
      const d = await fetch(`/api/students/me/notes/${id}`).then((r) => (r.ok ? r.json() : null));
      const note = d?.note;
      setActiveId(id);
      setTitle(note?.title ?? "Untitled");
      setText(note?.content ?? "");
      paintCanvas(canvasRef.current, note?.drawing ?? null);
      setDirty(false);
      setConfirmingDelete(false);
    } catch {
      /* ignore — keep whatever is on screen */
    }
  }

  // ── Load persisted UI state + the note list (once) ──
  useEffect(() => {
    let savedActiveId: string | null = null;
    try {
      const raw = localStorage.getItem(UI_KEY);
      if (raw) {
        const s = JSON.parse(raw);
        if (typeof s.x === "number" && typeof s.y === "number") setPos(clampPos(s.x, s.y));
        if (s.open) setOpen(true);
        if (s.mode === "draw" || s.mode === "write") setMode(s.mode);
        if (typeof s.activeId === "string") savedActiveId = s.activeId;
      } else {
        setPos(clampPos(window.innerWidth - PANEL_W - 24, window.innerHeight - 460));
      }
    } catch {
      /* ignore */
    }

    (async () => {
      try {
        const list = await fetch("/api/students/me/notes").then((r) =>
          r.ok ? r.json() : { notes: [] },
        );
        let items: NoteMeta[] = list.notes ?? [];
        if (items.length === 0) {
          const created = await fetch("/api/students/me/notes", {
            method: "POST",
            headers: JSON_HEADERS,
            body: JSON.stringify({ title: "My Notes" }),
          }).then((r) => r.json());
          if (created?.note) items = [created.note];
        }
        setNotes(items);
        if (items.length > 0) {
          const pick = items.find((n) => n.id === savedActiveId) ?? items[0];
          await openNote(pick.id);
        }
      } catch {
        /* ignore */
      } finally {
        setLoaded(true);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Persist UI state (open / position / mode / active note) ──
  useEffect(() => {
    try {
      localStorage.setItem(
        UI_KEY,
        JSON.stringify({ open, x: pos.x, y: pos.y, mode, activeId }),
      );
    } catch {
      /* ignore */
    }
  }, [open, pos, mode, activeId]);

  // ── Dragging (window-level so it keeps up with a fast pointer) ──
  useEffect(() => {
    if (!dragging) return;
    const move = (e: PointerEvent) => {
      const d = dragRef.current;
      if (!d) return;
      setPos(clampPos(d.ox + (e.clientX - d.sx), d.oy + (e.clientY - d.sy)));
    };
    const up = () => setDragging(false);
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
  }, [dragging]);

  function startDrag(e: React.PointerEvent) {
    dragRef.current = { sx: e.clientX, sy: e.clientY, ox: pos.x, oy: pos.y };
    setDragging(true);
  }

  // ── Persist the active note to the server ──
  async function saveActive(silent = false) {
    if (!activeId) return;
    if (!silent) setSaving(true);
    try {
      const drawing = canvasRef.current?.toDataURL("image/png") ?? null;
      const res = await fetch(`/api/students/me/notes/${activeId}`, {
        method: "PATCH",
        headers: JSON_HEADERS,
        body: JSON.stringify({ title, content: text, drawing }),
      });
      if (!res.ok) throw new Error();
      const cleanTitle = title.trim() || "Untitled";
      setNotes((prev) =>
        prev.map((n) =>
          n.id === activeId ? { ...n, title: cleanTitle, updatedAt: new Date().toISOString() } : n,
        ),
      );
      setDirty(false);
      if (!silent) toast.success("Notes saved.");
    } catch {
      if (!silent) toast.error("Couldn't save your notes. Please try again.");
    } finally {
      if (!silent) setSaving(false);
    }
  }

  // ── Switch to another note (auto-saving the current one first) ──
  async function switchTo(id: string) {
    if (id === activeId || busyRef.current) return;
    busyRef.current = true;
    try {
      if (dirty) await saveActive(true);
      await openNote(id);
    } finally {
      busyRef.current = false;
    }
  }

  // ── Create a fresh note ──
  async function createNote() {
    if (busyRef.current) return;
    busyRef.current = true;
    try {
      if (dirty && activeId) await saveActive(true);
      const created = await fetch("/api/students/me/notes", {
        method: "POST",
        headers: JSON_HEADERS,
        body: JSON.stringify({ title: `Note ${notes.length + 1}` }),
      }).then((r) => (r.ok ? r.json() : null));
      if (!created?.note) {
        toast.error("Couldn't create a new note.");
        return;
      }
      setNotes((prev) => [...prev, created.note]);
      setMode("write");
      await openNote(created.note.id);
    } finally {
      busyRef.current = false;
    }
  }

  // ── Delete the active note (confirmation is handled by the inline bar) ──
  async function deleteActive() {
    if (!activeId || busyRef.current) return;
    setConfirmingDelete(false);
    busyRef.current = true;
    try {
      const res = await fetch(`/api/students/me/notes/${activeId}`, { method: "DELETE" });
      if (!res.ok) {
        toast.error("Couldn't delete the note.");
        return;
      }
      const remaining = notes.filter((n) => n.id !== activeId);
      if (remaining.length > 0) {
        setNotes(remaining);
        await openNote(remaining[0].id);
      } else {
        // Never leave the student with zero notes — start a fresh one.
        const created = await fetch("/api/students/me/notes", {
          method: "POST",
          headers: JSON_HEADERS,
          body: JSON.stringify({ title: "My Notes" }),
        }).then((r) => (r.ok ? r.json() : null));
        setNotes(created?.note ? [created.note] : []);
        if (created?.note) await openNote(created.note.id);
      }
      toast.success("Note deleted.");
    } finally {
      busyRef.current = false;
    }
  }

  // Renaming updates the tab label live; the change is persisted on Save.
  function onTitleChange(v: string) {
    setTitle(v);
    setDirty(true);
    setNotes((prev) => prev.map((n) => (n.id === activeId ? { ...n, title: v } : n)));
  }

  // ── Canvas drawing (Pointer Events → unified mouse / pen / touch) ──
  function canvasPos(e: React.PointerEvent<HTMLCanvasElement>) {
    const c = canvasRef.current!;
    const r = c.getBoundingClientRect();
    return {
      x: (e.clientX - r.left) * (c.width / r.width),
      y: (e.clientY - r.top) * (c.height / r.height),
    };
  }
  function penDown(e: React.PointerEvent<HTMLCanvasElement>) {
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      /* pointer capture is best-effort */
    }
    drawingRef.current = true;
    lastRef.current = canvasPos(e);
  }
  function penMove(e: React.PointerEvent<HTMLCanvasElement>) {
    if (!drawingRef.current) return;
    const ctx = canvasRef.current?.getContext("2d");
    const from = lastRef.current;
    if (!ctx || !from) return;
    const p = canvasPos(e);
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    if (tool === "eraser") {
      ctx.globalCompositeOperation = "destination-out";
      ctx.lineWidth = 22;
    } else {
      ctx.globalCompositeOperation = "source-over";
      ctx.strokeStyle = color;
      ctx.lineWidth = penWidth;
    }
    ctx.beginPath();
    ctx.moveTo(from.x, from.y);
    ctx.lineTo(p.x, p.y);
    ctx.stroke();
    lastRef.current = p;
    if (!dirty) setDirty(true);
  }
  function penUp(e: React.PointerEvent<HTMLCanvasElement>) {
    drawingRef.current = false;
    lastRef.current = null;
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
  }
  function clearCanvas() {
    const c = canvasRef.current;
    if (!c) return;
    c.getContext("2d")?.clearRect(0, 0, c.width, c.height);
    setDirty(true);
  }

  return (
    <>
      {/* Floating launcher — shown when the panel is closed */}
      {!open && (
        <button
          onClick={() => setOpen(true)}
          aria-label="Open study notes"
          className="fixed bottom-5 right-5 z-[60] flex h-12 w-12 items-center justify-center rounded-full bg-primary text-white shadow-lg transition-transform hover:scale-105"
        >
          <StickyNote className="h-5 w-5" />
        </button>
      )}

      {/* The notes panel — always mounted (so text + sketch survive close/open
          and page navigation), just hidden when closed. */}
      <div
        className={
          "fixed z-[60] w-[360px] max-w-[92vw] overflow-hidden rounded-xl border border-border bg-surface shadow-2xl " +
          (open ? "" : "hidden")
        }
        style={{ left: pos.x, top: pos.y }}
      >
        {/* Draggable header */}
        <div
          onPointerDown={startDrag}
          className="flex cursor-grab items-center justify-between gap-2 border-b border-border bg-primary/5 px-3 py-2 active:cursor-grabbing"
          style={{ touchAction: "none" }}
        >
          <div className="flex items-center gap-2">
            <GripHorizontal className="h-4 w-4 text-text-muted" />
            <StickyNote className="h-4 w-4 text-primary" />
            <span className="text-sm font-semibold text-text-primary">My Notes</span>
            {dirty && <span className="text-[10px] font-medium text-warning">• Unsaved</span>}
          </div>
          <button
            onClick={() => setOpen(false)}
            aria-label="Close notes"
            className="rounded-md p-1 text-text-secondary hover:bg-border/60 hover:text-text-primary"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Note tabs — one per topic/subject, plus a button to add another */}
        <div className="flex items-center gap-1 border-b border-border px-2 py-1.5">
          <div className="flex flex-1 items-center gap-1 overflow-x-auto">
            {notes.map((n) => (
              <button
                key={n.id}
                onClick={() => switchTo(n.id)}
                title={n.title || "Untitled"}
                className={
                  "max-w-[120px] shrink-0 truncate rounded-md px-2.5 py-1 text-xs font-medium transition-colors " +
                  (n.id === activeId
                    ? "bg-primary/10 text-primary"
                    : "text-text-secondary hover:bg-border/50")
                }
              >
                {n.title || "Untitled"}
              </button>
            ))}
            {loaded && notes.length === 0 && (
              <span className="px-2 py-1 text-xs text-text-muted">No notes yet</span>
            )}
          </div>
          <button
            onClick={createNote}
            aria-label="New note"
            title="New note"
            className="shrink-0 rounded-md p-1 text-text-secondary hover:bg-primary/10 hover:text-primary"
          >
            <Plus className="h-4 w-4" />
          </button>
        </div>

        {/* Active note title (editable = rename) + delete */}
        <div className="flex items-center gap-2 border-b border-border px-3 py-2">
          <input
            value={title}
            onChange={(e) => onTitleChange(e.target.value)}
            placeholder="Note title"
            aria-label="Note title"
            disabled={!activeId}
            className="min-w-0 flex-1 rounded-md border border-transparent bg-transparent px-1.5 py-1 text-sm font-semibold text-text-primary outline-none hover:border-border focus:border-primary focus:bg-background disabled:opacity-50"
          />
          <button
            onClick={() => setConfirmingDelete((v) => !v)}
            aria-label="Delete note"
            title="Delete note"
            disabled={!activeId}
            className={
              "shrink-0 rounded-md p-1.5 disabled:opacity-40 " +
              (confirmingDelete
                ? "bg-red-500/10 text-red-500"
                : "text-text-secondary hover:bg-red-50 hover:text-red-500")
            }
          >
            <Trash2 className="h-4 w-4" />
          </button>
        </div>

        {/* Inline delete confirmation — replaces the ugly native confirm() */}
        {confirmingDelete && (
          <div className="flex items-center gap-2 border-b border-border bg-red-500/10 px-3 py-2">
            <span className="min-w-0 flex-1 truncate text-xs font-medium text-red-600">
              Delete “{title || "Untitled"}”? This can’t be undone.
            </span>
            <button
              onClick={deleteActive}
              className="shrink-0 rounded-md bg-red-600 px-2.5 py-1 text-xs font-semibold text-white hover:bg-red-700"
            >
              Delete
            </button>
            <button
              onClick={() => setConfirmingDelete(false)}
              className="shrink-0 rounded-md border border-border px-2.5 py-1 text-xs font-medium text-text-secondary hover:bg-border/50"
            >
              Cancel
            </button>
          </div>
        )}

        {/* Mode tabs */}
        <div className="flex items-center gap-1 border-b border-border px-2 py-1.5">
          <button
            onClick={() => setMode("write")}
            className={
              "flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium transition-colors " +
              (mode === "write" ? "bg-primary/10 text-primary" : "text-text-secondary hover:bg-border/50")
            }
          >
            <Type className="h-3.5 w-3.5" /> Write
          </button>
          <button
            onClick={() => setMode("draw")}
            className={
              "flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium transition-colors " +
              (mode === "draw" ? "bg-primary/10 text-primary" : "text-text-secondary hover:bg-border/50")
            }
          >
            <Pencil className="h-3.5 w-3.5" /> Draw
          </button>
        </div>

        <div className="p-3">
          {/* Write area (kept mounted; hidden in draw mode) */}
          <textarea
            value={text}
            onChange={(e) => {
              setText(e.target.value);
              if (!dirty) setDirty(true);
            }}
            placeholder="Jot down anything while you study…"
            className={
              "h-56 w-full resize-none rounded-lg border border-border bg-background p-3 text-sm text-text-primary outline-none focus:border-primary focus:ring-1 focus:ring-primary " +
              (mode === "write" ? "" : "hidden")
            }
          />

          {/* Draw area (kept mounted; hidden in write mode) */}
          <div className={mode === "draw" ? "" : "hidden"}>
            {/* Tools */}
            <div className="mb-2 flex flex-wrap items-center gap-1.5">
              {COLORS.map((c) => (
                <button
                  key={c}
                  onClick={() => {
                    setColor(c);
                    setTool("pen");
                  }}
                  aria-label={`Colour ${c}`}
                  className={
                    "h-6 w-6 rounded-full border transition-transform hover:scale-110 " +
                    (tool === "pen" && color === c ? "ring-2 ring-offset-1 ring-primary" : "border-border")
                  }
                  style={{ backgroundColor: c }}
                />
              ))}
              <label
                className="flex h-6 w-6 cursor-pointer items-center justify-center rounded-full border border-dashed border-border text-[9px] text-text-muted"
                title="Custom colour"
              >
                +
                <input
                  type="color"
                  value={color}
                  onChange={(e) => {
                    setColor(e.target.value);
                    setTool("pen");
                  }}
                  className="sr-only"
                />
              </label>

              <span className="mx-1 h-5 w-px bg-border" />

              <button
                onClick={() => setTool("pen")}
                aria-label="Pen"
                className={
                  "rounded-md p-1.5 transition-colors " +
                  (tool === "pen" ? "bg-primary/10 text-primary" : "text-text-secondary hover:bg-border/50")
                }
              >
                <Pencil className="h-4 w-4" />
              </button>
              <button
                onClick={() => setTool("eraser")}
                aria-label="Eraser"
                className={
                  "rounded-md p-1.5 transition-colors " +
                  (tool === "eraser" ? "bg-primary/10 text-primary" : "text-text-secondary hover:bg-border/50")
                }
              >
                <Eraser className="h-4 w-4" />
              </button>
              <button
                onClick={clearCanvas}
                aria-label="Clear drawing"
                title="Clear drawing"
                className="rounded-md p-1.5 text-text-secondary hover:bg-red-50 hover:text-red-500"
              >
                <Trash2 className="h-4 w-4" />
              </button>

              <input
                type="range"
                min={1}
                max={12}
                value={penWidth}
                onChange={(e) => setPenWidth(Number(e.target.value))}
                className="ml-auto w-16 accent-primary"
                aria-label="Pen thickness"
                title="Pen thickness"
              />
            </div>

            <canvas
              ref={canvasRef}
              width={CANVAS_W}
              height={CANVAS_H}
              onPointerDown={penDown}
              onPointerMove={penMove}
              onPointerUp={penUp}
              onPointerLeave={penUp}
              className="w-full rounded-lg border border-border bg-white"
              style={{ touchAction: "none", height: CANVAS_H, aspectRatio: `${CANVAS_W} / ${CANVAS_H}` }}
            />
          </div>

          {/* Footer actions */}
          <div className="mt-3 flex items-center justify-between">
            <span className="text-[11px] text-text-muted">
              {dirty ? "Unsaved changes" : "All changes saved"}
            </span>
            <button
              onClick={() => saveActive()}
              disabled={saving || !activeId}
              className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-sm font-semibold text-white hover:bg-primary-dark disabled:opacity-50"
            >
              <Save className="h-4 w-4" />
              {saving ? "Saving…" : "Save"}
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
