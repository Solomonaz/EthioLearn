"use client";

/**
 * Study notes — a floating panel available on every student page.
 *
 * Design choices (2026-09-23 redesign):
 * - AUTO-SAVE. Changes save ~1s after the student stops typing or drawing, and
 *   again when the tab is hidden or closed. There is no Save button to forget.
 * - One title, edited in place in the header. A list view (search + "from here"
 *   section) replaces the old tab row, which did not scale past a few notes.
 * - Notes remember what the student was studying when they were created (a
 *   chapter from the tutor, otherwise the page name — lib/notes-context).
 * - Write supports light formatting (bold, lists, headings, maths symbols and
 *   $formulas$) with a Preview; Draw is a sketch canvas.
 * - Destructive actions live in the ⋯ menu, behind an inline confirmation.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import {
  StickyNote,
  X,
  Pencil,
  Eraser,
  Trash2,
  Type,
  Plus,
  List,
  Search,
  MoreHorizontal,
  Maximize2,
  Minimize2,
  Check,
  AlertTriangle,
  Eye,
  Bold,
  ListOrdered,
  Heading2,
  Sigma,
  MapPin,
  ChevronLeft,
} from "lucide-react";
import { toast } from "@/components/ui/sonner";
import { MarkdownView } from "@/components/ui/markdown-view";
import { cn } from "@/lib/utils";
import { pageLabel, usePublishedNotesContext } from "@/lib/notes-context";

const COLORS = ["#1f2937", "#dc2626", "#2563eb", "#16a34a", "#d97706", "#7c3aed"];
const SYMBOLS = ["π", "√", "²", "³", "°", "±", "×", "÷", "≤", "≥", "≠", "≈", "∞", "θ", "Δ", "α", "β", "λ", "µ", "→", "∑", "∫"];
const UI_KEY = "abugida:student-notes:v1";
const PANEL_W = 380;
const PANEL_W_LARGE = 680;
const CANVAS_W = 640;
const CANVAS_H = 480;
const AUTOSAVE_MS = 1000;
const JSON_HEADERS = { "Content-Type": "application/json" };

type Mode = "write" | "preview" | "draw";
type Tool = "pen" | "eraser";
type View = "note" | "list";
type Status = "saved" | "saving" | "unsaved" | "error";
type NoteMeta = {
  id: string;
  title: string;
  updatedAt: string;
  contextLabel: string | null;
  contextPath: string | null;
  snippet: string | null;
};

function panelWidth(expanded: boolean) {
  const vw = typeof window !== "undefined" ? window.innerWidth : 1200;
  return Math.min(expanded ? PANEL_W_LARGE : PANEL_W, vw * 0.94);
}

function clampPos(x: number, y: number, expanded: boolean) {
  const pad = 8;
  const w = typeof window !== "undefined" ? window.innerWidth : 1200;
  const h = typeof window !== "undefined" ? window.innerHeight : 800;
  const maxX = Math.max(pad, w - panelWidth(expanded) - pad);
  const maxY = Math.max(pad, h - 80 - pad); // keep the header on-screen
  return { x: Math.max(pad, Math.min(x, maxX)), y: Math.max(pad, Math.min(y, maxY)) };
}

/** Paint a saved sketch (or clear) onto the canvas. */
function paintCanvas(c: HTMLCanvasElement | null, drawing: string | null) {
  if (!c) return;
  const ctx = c.getContext("2d");
  if (!ctx) return;
  ctx.clearRect(0, 0, c.width, c.height);
  if (drawing) {
    const img = new Image();
    img.onload = () => ctx.drawImage(img, 0, 0, c.width, c.height);
    img.src = drawing;
  }
}

/** The title to show: the note's own title, else its first line. */
function displayTitle(title: string, snippet: string | null) {
  if (title.trim()) return title.trim();
  const first = (snippet ?? "").split("\n").map((l) => l.replace(/^[#>*\-\d.\s]+/, "").trim()).find(Boolean);
  return first ? first.slice(0, 60) : "Untitled note";
}

function timeAgo(iso: string) {
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  if (s < 7 * 86400) return `${Math.floor(s / 86400)}d ago`;
  return new Date(iso).toLocaleDateString();
}

export function StudentNotes() {
  const pathname = usePathname() ?? "/student";
  const published = usePublishedNotesContext();
  const currentContext = published ?? pageLabel(pathname);

  const [open, setOpen] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [pos, setPos] = useState({ x: 24, y: 96 });
  const [view, setView] = useState<View>("note");
  const [mode, setMode] = useState<Mode>("write");

  const [notes, setNotes] = useState<NoteMeta[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [text, setText] = useState("");
  const [activeContext, setActiveContext] = useState<string | null>(null);
  const [status, setStatus] = useState<Status>("saved");
  const [loaded, setLoaded] = useState(false);
  const [query, setQuery] = useState("");

  const [menuOpen, setMenuOpen] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [symbolsOpen, setSymbolsOpen] = useState(false);

  const [color, setColor] = useState(COLORS[0]);
  const [tool, setTool] = useState<Tool>("pen");
  const [penWidth, setPenWidth] = useState(3);
  const [dragging, setDragging] = useState(false);

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const drawingRef = useRef(false);
  const lastRef = useRef<{ x: number; y: number } | null>(null);
  const dragRef = useRef<{ sx: number; sy: number; ox: number; oy: number } | null>(null);
  const busyRef = useRef(false); // serialises open/create/delete

  // ── Auto-save bookkeeping (refs, so timers and unload handlers see the latest) ──
  const activeIdRef = useRef<string | null>(null);
  const titleRef = useRef("");
  const textRef = useRef("");
  const dirtyRef = useRef({ title: false, text: false, drawing: false });
  const versionRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const savingRef = useRef<Promise<void> | null>(null);
  activeIdRef.current = activeId;
  titleRef.current = title;
  textRef.current = text;

  const flush = useCallback(async (): Promise<void> => {
    if (timerRef.current) clearTimeout(timerRef.current);
    if (savingRef.current) await savingRef.current;
    const id = activeIdRef.current;
    const d = dirtyRef.current;
    if (!id || (!d.title && !d.text && !d.drawing)) return;

    const body: Record<string, string | null> = {};
    if (d.title) body.title = titleRef.current;
    if (d.text) body.content = textRef.current;
    if (d.drawing) body.drawing = canvasRef.current?.toDataURL("image/png") ?? null;
    const version = versionRef.current;
    const sent = { ...d };
    dirtyRef.current = { title: false, text: false, drawing: false };
    setStatus("saving");

    const run = (async () => {
      try {
        const res = await fetch(`/api/students/me/notes/${id}`, {
          method: "PATCH",
          headers: JSON_HEADERS,
          body: JSON.stringify(body),
        });
        if (!res.ok) throw new Error(String(res.status));
        setNotes((prev) =>
          prev
            .map((n) =>
              n.id === id
                ? {
                    ...n,
                    title: sent.title ? (body.title as string) : n.title,
                    snippet: sent.text ? ((body.content as string) ?? "").slice(0, 160) : n.snippet,
                    updatedAt: new Date().toISOString(),
                  }
                : n
            )
            .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
        );
        // Edits made while this save was in flight keep the status "unsaved"
        // and have their own save scheduled.
        if (versionRef.current === version) setStatus("saved");
      } catch {
        // Put the unsent changes back so the next attempt includes them.
        dirtyRef.current = {
          title: dirtyRef.current.title || sent.title,
          text: dirtyRef.current.text || sent.text,
          drawing: dirtyRef.current.drawing || sent.drawing,
        };
        setStatus("error");
      }
    })();
    savingRef.current = run;
    await run;
    savingRef.current = null;
  }, []);

  const markDirty = useCallback(
    (kind: "title" | "text" | "drawing") => {
      dirtyRef.current[kind] = true;
      versionRef.current += 1;
      setStatus("unsaved");
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => void flush(), AUTOSAVE_MS);
    },
    [flush]
  );

  // Save when the tab is hidden; on close, send the text with keepalive (a
  // drawing can exceed keepalive's 64 KB limit, so it relies on the earlier saves).
  useEffect(() => {
    const onHidden = () => {
      if (document.visibilityState === "hidden") void flush();
    };
    const onPageHide = () => {
      const id = activeIdRef.current;
      const d = dirtyRef.current;
      if (!id || (!d.title && !d.text)) return;
      const body: Record<string, string> = {};
      if (d.title) body.title = titleRef.current;
      if (d.text) body.content = textRef.current;
      try {
        fetch(`/api/students/me/notes/${id}`, {
          method: "PATCH",
          headers: JSON_HEADERS,
          body: JSON.stringify(body),
          keepalive: true,
        });
      } catch {
        /* best effort */
      }
    };
    document.addEventListener("visibilitychange", onHidden);
    window.addEventListener("pagehide", onPageHide);
    return () => {
      document.removeEventListener("visibilitychange", onHidden);
      window.removeEventListener("pagehide", onPageHide);
    };
  }, [flush]);

  // ── Load a note into the editor ──
  const openNote = useCallback(async (id: string) => {
    try {
      const d = await fetch(`/api/students/me/notes/${id}`).then((r) => (r.ok ? r.json() : null));
      const note = d?.note;
      if (!note) return;
      setActiveId(id);
      activeIdRef.current = id;
      setTitle(note.title ?? "");
      setText(note.content ?? "");
      setActiveContext(note.contextLabel ?? null);
      paintCanvas(canvasRef.current, note.drawing ?? null);
      dirtyRef.current = { title: false, text: false, drawing: false };
      setStatus("saved");
      setConfirmingDelete(false);
      setMenuOpen(false);
      setView("note");
    } catch {
      /* keep whatever is on screen */
    }
  }, []);

  // ── Load persisted UI state + the note list (once) ──
  useEffect(() => {
    let savedActiveId: string | null = null;
    let savedExpanded = false;
    try {
      const raw = localStorage.getItem(UI_KEY);
      if (raw) {
        const s = JSON.parse(raw);
        savedExpanded = s.expanded === true;
        setExpanded(savedExpanded);
        if (typeof s.x === "number" && typeof s.y === "number") setPos(clampPos(s.x, s.y, savedExpanded));
        if (s.open) setOpen(true);
        if (s.mode === "draw" || s.mode === "write" || s.mode === "preview") setMode(s.mode);
        if (typeof s.activeId === "string") savedActiveId = s.activeId;
      } else {
        setPos(clampPos(window.innerWidth - PANEL_W - 24, window.innerHeight - 520, false));
      }
    } catch {
      /* ignore */
    }

    (async () => {
      try {
        const list = await fetch("/api/students/me/notes").then((r) => (r.ok ? r.json() : { notes: [] }));
        const items: NoteMeta[] = (list.notes ?? []).map((n: NoteMeta) => ({
          ...n,
          updatedAt: new Date(n.updatedAt).toISOString(),
        }));
        setNotes(items);
        if (items.length > 0) {
          const pick = items.find((n) => n.id === savedActiveId) ?? items[0];
          await openNote(pick.id);
        } else {
          setView("list");
        }
      } catch {
        /* ignore */
      } finally {
        setLoaded(true);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Persist UI state ──
  useEffect(() => {
    try {
      localStorage.setItem(UI_KEY, JSON.stringify({ open, x: pos.x, y: pos.y, mode, activeId, expanded }));
    } catch {
      /* ignore */
    }
  }, [open, pos, mode, activeId, expanded]);

  // Keep the panel on-screen when it grows.
  useEffect(() => {
    setPos((p) => clampPos(p.x, p.y, expanded));
  }, [expanded]);

  // ── Dragging (window-level so it keeps up with a fast pointer) ──
  useEffect(() => {
    if (!dragging) return;
    const move = (e: PointerEvent) => {
      const d = dragRef.current;
      if (!d) return;
      setPos(clampPos(d.ox + (e.clientX - d.sx), d.oy + (e.clientY - d.sy), expanded));
    };
    const up = () => setDragging(false);
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
  }, [dragging, expanded]);

  function startDrag(e: React.PointerEvent) {
    // Only the empty parts of the header drag — not its inputs and buttons.
    if ((e.target as HTMLElement).closest("button, input")) return;
    dragRef.current = { sx: e.clientX, sy: e.clientY, ox: pos.x, oy: pos.y };
    setDragging(true);
  }

  // ── Note actions ──
  async function switchTo(id: string) {
    if (busyRef.current) return;
    if (id === activeId) {
      setView("note");
      return;
    }
    busyRef.current = true;
    try {
      await flush();
      await openNote(id);
    } finally {
      busyRef.current = false;
    }
  }

  async function createNote() {
    if (busyRef.current) return;
    busyRef.current = true;
    try {
      await flush();
      const res = await fetch("/api/students/me/notes", {
        method: "POST",
        headers: JSON_HEADERS,
        body: JSON.stringify({ title: "", contextLabel: currentContext, contextPath: pathname }),
      });
      const created = await res.json().catch(() => null);
      if (!res.ok || !created?.note) {
        toast.error(created?.error ?? "Couldn't create a new note.");
        return;
      }
      const meta: NoteMeta = { ...created.note, updatedAt: new Date(created.note.updatedAt).toISOString() };
      setNotes((prev) => [meta, ...prev]);
      setQuery("");
      await openNote(meta.id);
      setMode("write");
      requestAnimationFrame(() => textareaRef.current?.focus());
    } finally {
      busyRef.current = false;
    }
  }

  async function deleteActive() {
    if (!activeId || busyRef.current) return;
    setConfirmingDelete(false);
    setMenuOpen(false);
    busyRef.current = true;
    try {
      if (timerRef.current) clearTimeout(timerRef.current);
      if (savingRef.current) await savingRef.current;
      const res = await fetch(`/api/students/me/notes/${activeId}`, { method: "DELETE" });
      if (!res.ok) {
        toast.error("Couldn't delete the note.");
        return;
      }
      dirtyRef.current = { title: false, text: false, drawing: false };
      const remaining = notes.filter((n) => n.id !== activeId);
      setNotes(remaining);
      if (remaining.length > 0) {
        await openNote(remaining[0].id);
      } else {
        setActiveId(null);
        activeIdRef.current = null;
        setTitle("");
        setText("");
        setActiveContext(null);
        paintCanvas(canvasRef.current, null);
        setStatus("saved");
        setView("list");
      }
      toast.success("Note deleted.");
    } finally {
      busyRef.current = false;
    }
  }

  function closePanel() {
    setOpen(false);
    setMenuOpen(false);
    setSymbolsOpen(false);
    void flush();
  }

  // ── Writing helpers (formatting toolbar) ──
  function updateText(next: string, selStart?: number, selEnd?: number) {
    setText(next);
    textRef.current = next;
    markDirty("text");
    if (selStart != null) {
      requestAnimationFrame(() => {
        const ta = textareaRef.current;
        if (!ta) return;
        ta.focus();
        ta.setSelectionRange(selStart, selEnd ?? selStart);
      });
    }
  }
  function wrapSelection(before: string, after = before) {
    const ta = textareaRef.current;
    if (!ta) return;
    const { selectionStart: a, selectionEnd: b } = ta;
    const inner = text.slice(a, b) || "text";
    updateText(text.slice(0, a) + before + inner + after + text.slice(b), a + before.length, a + before.length + inner.length);
  }
  function prefixLines(kind: "bullet" | "number" | "heading") {
    const ta = textareaRef.current;
    if (!ta) return;
    const { selectionStart: a, selectionEnd: b } = ta;
    const lineStart = text.lastIndexOf("\n", a - 1) + 1;
    const lineEndIdx = text.indexOf("\n", b);
    const lineEnd = lineEndIdx === -1 ? text.length : lineEndIdx;
    const lines = text.slice(lineStart, lineEnd).split("\n");
    const out = lines
      .map((l, i) => (kind === "bullet" ? `- ${l}` : kind === "number" ? `${i + 1}. ${l}` : `## ${l}`))
      .join("\n");
    updateText(text.slice(0, lineStart) + out + text.slice(lineEnd), lineStart + out.length);
  }
  function insertSymbol(sym: string) {
    const ta = textareaRef.current;
    const a = ta?.selectionStart ?? text.length;
    const b = ta?.selectionEnd ?? text.length;
    updateText(text.slice(0, a) + sym + text.slice(b), a + sym.length);
  }

  // ── Canvas drawing (Pointer Events → mouse / pen / touch) ──
  function canvasPos(e: React.PointerEvent<HTMLCanvasElement>) {
    const c = canvasRef.current!;
    const r = c.getBoundingClientRect();
    return { x: (e.clientX - r.left) * (c.width / r.width), y: (e.clientY - r.top) * (c.height / r.height) };
  }
  function penDown(e: React.PointerEvent<HTMLCanvasElement>) {
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      /* best-effort */
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
      ctx.lineWidth = 36;
    } else {
      ctx.globalCompositeOperation = "source-over";
      ctx.strokeStyle = color;
      ctx.lineWidth = penWidth * 2; // canvas is 2x its display size
    }
    ctx.beginPath();
    ctx.moveTo(from.x, from.y);
    ctx.lineTo(p.x, p.y);
    ctx.stroke();
    lastRef.current = p;
  }
  function penUp(e: React.PointerEvent<HTMLCanvasElement>) {
    if (drawingRef.current) markDirty("drawing");
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
    markDirty("drawing");
  }

  // ── List view data ──
  const q = query.trim().toLowerCase();
  const filtered = useMemo(
    () =>
      q
        ? notes.filter((n) =>
            [n.title, n.snippet ?? "", n.contextLabel ?? ""].some((f) => f.toLowerCase().includes(q))
          )
        : notes,
    [notes, q]
  );
  const fromHere = q ? [] : filtered.filter((n) => n.contextLabel === currentContext);
  const others = q ? filtered : filtered.filter((n) => n.contextLabel !== currentContext);

  const activeMeta = notes.find((n) => n.id === activeId);
  const statusView = {
    saved: { icon: <Check className="h-3.5 w-3.5" />, text: "Saved", cls: "text-text-muted" },
    saving: { icon: <span className="h-3 w-3 animate-spin rounded-full border-2 border-current border-t-transparent" />, text: "Saving…", cls: "text-text-muted" },
    unsaved: { icon: <span className="h-1.5 w-1.5 rounded-full bg-current" />, text: "Editing", cls: "text-text-muted" },
    error: { icon: <AlertTriangle className="h-3.5 w-3.5" />, text: "Not saved — retry", cls: "text-error" },
  }[status];

  const iconBtn =
    "inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-text-secondary transition-colors hover:bg-border/60 hover:text-text-primary";

  const renderRow = (n: NoteMeta) => (
    <button
      key={n.id}
      onClick={() => switchTo(n.id)}
      className={cn(
        "w-full rounded-lg px-3 py-2 text-left transition-colors hover:bg-border/40",
        n.id === activeId && "bg-primary/5 ring-1 ring-primary/20"
      )}
    >
      <div className="flex items-baseline justify-between gap-2">
        <span className="truncate text-sm font-semibold text-text-primary">{displayTitle(n.title, n.snippet)}</span>
        <span className="shrink-0 text-[11px] text-text-muted">{timeAgo(n.updatedAt)}</span>
      </div>
      {n.snippet && n.title.trim() && (
        <p className="mt-0.5 truncate text-xs text-text-secondary">
          {n.snippet.replace(/[*#>`]/g, "").replace(/^\s*(?:-|\d+\.)\s/gm, "").replace(/\s+/g, " ").trim()}
        </p>
      )}
      {n.contextLabel && (
        <span className="mt-1 inline-flex max-w-full items-center gap-1 truncate rounded-full bg-border/40 px-2 py-0.5 text-[10px] font-medium text-text-secondary">
          <MapPin className="h-2.5 w-2.5 shrink-0" />
          <span className="truncate">{n.contextLabel}</span>
        </span>
      )}
    </button>
  );

  return (
    <>
      {/* Floating launcher — shown when the panel is closed */}
      {!open && (
        <button
          onClick={() => setOpen(true)}
          aria-label="Open study notes"
          title="Notes"
          className="fixed bottom-5 right-5 z-[60] flex h-12 w-12 items-center justify-center rounded-full bg-primary text-white shadow-lg transition-transform hover:scale-105"
        >
          <StickyNote className="h-5 w-5" />
        </button>
      )}

      {/* The panel — always mounted (text + sketch survive close/open and page
          navigation), just hidden when closed. */}
      <div
        className={cn(
          "fixed z-[60] flex flex-col overflow-hidden rounded-2xl border border-border bg-surface shadow-2xl",
          !open && "hidden"
        )}
        style={{ left: pos.x, top: pos.y, width: panelWidth(expanded) }}
      >
        {/* ── Header: drag area, title / list title, status, actions ── */}
        <div
          onPointerDown={startDrag}
          className="flex cursor-grab items-center gap-1 border-b border-border px-2 py-1.5 active:cursor-grabbing"
          style={{ touchAction: "none" }}
        >
          {view === "note" ? (
            <>
              <button onClick={() => { setView("list"); setMenuOpen(false); }} className={iconBtn} aria-label="All notes" title="All notes">
                <List className="h-4 w-4" />
              </button>
              <input
                value={title}
                onChange={(e) => {
                  setTitle(e.target.value);
                  titleRef.current = e.target.value;
                  markDirty("title");
                }}
                placeholder={activeMeta ? displayTitle("", text.slice(0, 160)) : "Untitled note"}
                aria-label="Note title"
                disabled={!activeId}
                maxLength={120}
                className="min-w-0 flex-1 cursor-text rounded-md bg-transparent px-1.5 py-1 text-sm font-semibold text-text-primary outline-none placeholder:text-text-muted hover:bg-border/30 focus:bg-background focus:ring-1 focus:ring-primary"
              />
            </>
          ) : (
            <div className="flex min-w-0 flex-1 items-center gap-1">
              {activeId && (
                <button onClick={() => setView("note")} className={iconBtn} aria-label="Back to note" title="Back to note">
                  <ChevronLeft className="h-4 w-4" />
                </button>
              )}
              <StickyNote className="ml-1 h-4 w-4 shrink-0 text-primary" />
              <span className="truncate px-1 text-sm font-semibold text-text-primary">My notes</span>
              <span className="text-xs text-text-muted">{notes.length}</span>
            </div>
          )}

          {view === "note" && activeId && (
            <button
              onClick={() => status === "error" && void flush()}
              className={cn("inline-flex shrink-0 items-center gap-1 px-1 text-[11px] font-medium", statusView.cls, status !== "error" && "cursor-default")}
              aria-live="polite"
              title={status === "error" ? "Try saving again" : undefined}
            >
              {statusView.icon}
              <span className="hidden sm:inline">{statusView.text}</span>
            </button>
          )}
          <button onClick={() => setExpanded((v) => !v)} className={iconBtn} aria-label={expanded ? "Make smaller" : "Make bigger"} title={expanded ? "Make smaller" : "Make bigger"}>
            {expanded ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
          </button>
          {view === "note" && activeId && (
            <div className="relative">
              <button onClick={() => { setMenuOpen((v) => !v); setConfirmingDelete(false); }} className={iconBtn} aria-label="More actions" title="More">
                <MoreHorizontal className="h-4 w-4" />
              </button>
              {menuOpen && (
                <div className="absolute right-0 top-full z-10 mt-1 w-40 rounded-xl border border-border bg-surface p-1 shadow-xl">
                  <button onClick={() => { setMenuOpen(false); void createNote(); }} className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-sm text-text-primary hover:bg-border/40">
                    <Plus className="h-4 w-4" /> New note
                  </button>
                  <button onClick={() => { setMenuOpen(false); setConfirmingDelete(true); }} className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-sm text-error hover:bg-red-50 dark:hover:bg-red-500/10">
                    <Trash2 className="h-4 w-4" /> Delete note
                  </button>
                </div>
              )}
            </div>
          )}
          <button onClick={closePanel} className={iconBtn} aria-label="Close notes" title="Close">
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Inline delete confirmation */}
        {confirmingDelete && view === "note" && (
          <div className="flex items-center gap-2 border-b border-border bg-red-50 px-3 py-2 dark:bg-red-500/10">
            <span className="min-w-0 flex-1 truncate text-xs font-medium text-error">
              Delete “{displayTitle(title, text)}”? This can’t be undone.
            </span>
            <button onClick={deleteActive} className="shrink-0 rounded-md bg-red-600 px-2.5 py-1 text-xs font-semibold text-white hover:bg-red-700">
              Delete
            </button>
            <button onClick={() => setConfirmingDelete(false)} className="shrink-0 rounded-md px-2 py-1 text-xs font-medium text-text-secondary hover:bg-border/50">
              Cancel
            </button>
          </div>
        )}

        {/* ── List view ── */}
        {view === "list" && (
          <div className="flex flex-col" style={{ height: expanded ? "70vh" : 440 }}>
            <div className="flex items-center gap-2 border-b border-border p-2">
              <div className="flex min-w-0 flex-1 items-center gap-1.5 rounded-lg bg-background px-2 ring-1 ring-border focus-within:ring-primary">
                <Search className="h-4 w-4 shrink-0 text-text-muted" />
                <input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Search notes"
                  aria-label="Search notes"
                  className="min-w-0 flex-1 bg-transparent py-1.5 text-sm text-text-primary outline-none placeholder:text-text-muted"
                />
              </div>
              <button onClick={createNote} className="inline-flex shrink-0 items-center gap-1 rounded-lg bg-primary px-2.5 py-1.5 text-sm font-semibold text-white hover:bg-primary-dark">
                <Plus className="h-4 w-4" /> New
              </button>
            </div>
            <div className="flex-1 space-y-3 overflow-y-auto p-2">
              {loaded && notes.length === 0 ? (
                <div className="flex h-full flex-col items-center justify-center gap-2 px-6 text-center">
                  <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-primary/10 text-primary">
                    <StickyNote className="h-5 w-5" />
                  </span>
                  <p className="text-sm font-semibold text-text-primary">No notes yet</p>
                  <p className="text-xs text-text-secondary">Jot down ideas, formulas or sketches while you study. They save automatically.</p>
                  <button onClick={createNote} className="mt-1 inline-flex items-center gap-1 rounded-lg bg-primary px-3 py-1.5 text-sm font-semibold text-white hover:bg-primary-dark">
                    <Plus className="h-4 w-4" /> New note
                  </button>
                </div>
              ) : filtered.length === 0 ? (
                <p className="px-2 py-6 text-center text-sm text-text-muted">No notes match “{query}”.</p>
              ) : (
                <>
                  {fromHere.length > 0 && (
                    <div>
                      <p className="flex items-center gap-1 px-2 pb-1 text-[11px] font-bold uppercase tracking-wide text-text-muted">
                        <MapPin className="h-3 w-3" /> From here · <span className="truncate normal-case">{currentContext}</span>
                      </p>
                      <div className="space-y-1">{fromHere.map(renderRow)}</div>
                    </div>
                  )}
                  {others.length > 0 && (
                    <div>
                      {fromHere.length > 0 && (
                        <p className="px-2 pb-1 text-[11px] font-bold uppercase tracking-wide text-text-muted">All notes</p>
                      )}
                      <div className="space-y-1">{others.map(renderRow)}</div>
                    </div>
                  )}
                </>
              )}
            </div>
          </div>
        )}

        {/* ── Note view (kept mounted so the canvas keeps its sketch) ── */}
        <div className={cn("flex flex-col", view !== "note" && "hidden")}>
          {/* Mode switch + contextual tools */}
          <div className="flex flex-wrap items-center gap-2 border-b border-border px-2 py-1.5">
            <div className="flex rounded-lg bg-background p-0.5 ring-1 ring-border">
              {([["write", Type, "Write"], ["preview", Eye, "Preview"], ["draw", Pencil, "Draw"]] as const).map(([m, Icon, label]) => (
                <button
                  key={m}
                  onClick={() => { setMode(m); setSymbolsOpen(false); }}
                  className={cn(
                    "inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium transition-colors",
                    mode === m ? "bg-surface text-primary shadow-sm" : "text-text-secondary hover:text-text-primary"
                  )}
                >
                  <Icon className="h-3.5 w-3.5" /> {label}
                </button>
              ))}
            </div>

            {mode === "write" && (
              <div className="relative ml-auto flex items-center">
                <button onClick={() => wrapSelection("**")} className={iconBtn} title="Bold (Ctrl+B)" aria-label="Bold"><Bold className="h-4 w-4" /></button>
                <button onClick={() => prefixLines("bullet")} className={iconBtn} title="Bullet list" aria-label="Bullet list"><List className="h-4 w-4" /></button>
                <button onClick={() => prefixLines("number")} className={iconBtn} title="Numbered list" aria-label="Numbered list"><ListOrdered className="h-4 w-4" /></button>
                <button onClick={() => prefixLines("heading")} className={iconBtn} title="Heading" aria-label="Heading"><Heading2 className="h-4 w-4" /></button>
                <button onClick={() => setSymbolsOpen((v) => !v)} className={cn(iconBtn, symbolsOpen && "bg-primary/10 text-primary")} title="Maths symbols" aria-label="Maths symbols"><Sigma className="h-4 w-4" /></button>
                {symbolsOpen && (
                  <div className="absolute right-0 top-full z-10 mt-1 w-56 rounded-xl border border-border bg-surface p-2 shadow-xl">
                    <div className="grid grid-cols-8 gap-0.5">
                      {SYMBOLS.map((s) => (
                        <button key={s} onClick={() => insertSymbol(s)} className="rounded-md py-1 text-sm text-text-primary hover:bg-primary/10">{s}</button>
                      ))}
                    </div>
                    <p className="mt-1.5 text-[10px] leading-snug text-text-muted">
                      Tip: write formulas like <code className="font-mono">$x^2 + 1$</code> — Preview shows them properly.
                    </p>
                  </div>
                )}
              </div>
            )}

            {mode === "draw" && (
              <div className="ml-auto flex flex-wrap items-center gap-1">
                {COLORS.map((c) => (
                  <button
                    key={c}
                    onClick={() => { setColor(c); setTool("pen"); }}
                    aria-label={`Colour ${c}`}
                    className={cn("h-5 w-5 rounded-full border border-border transition-transform hover:scale-110", tool === "pen" && color === c && "ring-2 ring-primary ring-offset-1")}
                    style={{ backgroundColor: c }}
                  />
                ))}
                <span className="mx-0.5 h-4 w-px bg-border" />
                <button onClick={() => setTool("pen")} className={cn(iconBtn, tool === "pen" && "bg-primary/10 text-primary")} aria-label="Pen" title="Pen"><Pencil className="h-4 w-4" /></button>
                <button onClick={() => setTool("eraser")} className={cn(iconBtn, tool === "eraser" && "bg-primary/10 text-primary")} aria-label="Eraser" title="Eraser"><Eraser className="h-4 w-4" /></button>
                <input type="range" min={1} max={10} value={penWidth} onChange={(e) => setPenWidth(Number(e.target.value))} className="w-14 accent-primary" aria-label="Pen thickness" title="Pen thickness" />
                <button onClick={clearCanvas} className={cn(iconBtn, "hover:text-error")} aria-label="Clear drawing" title="Clear drawing"><Trash2 className="h-4 w-4" /></button>
              </div>
            )}
          </div>

          {activeContext && (
            <div className="flex items-center gap-1 px-3 pt-2 text-[11px] text-text-muted">
              <MapPin className="h-3 w-3 shrink-0" />
              <span className="truncate">{activeContext}</span>
            </div>
          )}

          <div className="p-3">
            <textarea
              ref={textareaRef}
              value={text}
              onChange={(e) => {
                setText(e.target.value);
                textRef.current = e.target.value;
                markDirty("text");
              }}
              onKeyDown={(e) => {
                if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "b") {
                  e.preventDefault();
                  wrapSelection("**");
                }
              }}
              placeholder="Jot down anything while you study…"
              disabled={!activeId}
              className={cn(
                "w-full resize-none rounded-lg border border-border bg-background p-3 text-sm leading-relaxed text-text-primary outline-none focus:border-primary focus:ring-1 focus:ring-primary",
                mode !== "write" && "hidden"
              )}
              style={{ height: expanded ? "58vh" : 300 }}
            />
            {mode === "preview" && (
              <div className="overflow-y-auto rounded-lg border border-border bg-background p-3 text-sm" style={{ height: expanded ? "58vh" : 300 }}>
                {text.trim() ? (
                  <MarkdownView markdown={text} />
                ) : (
                  <p className="text-text-muted">Nothing to preview yet.</p>
                )}
              </div>
            )}
            <div className={cn(mode !== "draw" && "hidden")}>
              <canvas
                ref={canvasRef}
                width={CANVAS_W}
                height={CANVAS_H}
                onPointerDown={penDown}
                onPointerMove={penMove}
                onPointerUp={penUp}
                onPointerLeave={penUp}
                className="w-full rounded-lg border border-border bg-white"
                style={{ touchAction: "none", aspectRatio: `${CANVAS_W} / ${CANVAS_H}` }}
              />
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
