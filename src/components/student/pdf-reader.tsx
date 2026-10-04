"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ZoomIn, ZoomOut, ChevronUp, ChevronDown, Maximize2 } from "lucide-react";
import { Spinner } from "@/components/ui/spinner";
import { Button } from "@/components/ui/button";

/* pdf.js types, kept loose: the library is loaded on demand in the browser. */
type PdfDoc = { numPages: number; getPage: (n: number) => Promise<PdfPage>; destroy: () => Promise<void> };
type PdfPage = {
  getViewport: (o: { scale: number }) => { width: number; height: number };
  render: (o: { canvasContext: CanvasRenderingContext2D; viewport: unknown }) => { promise: Promise<void>; cancel: () => void };
};

const MIN_ZOOM = 0.5;
const MAX_ZOOM = 3;
/** Pages kept rendered either side of the visible one; the rest are cleared to save memory on phones. */
const KEEP_AROUND = 4;

/**
 * Read-only in-app PDF reader. Pages render lazily as they scroll into view,
 * and the PDF is fetched in ranges, so a 40 MB book opens on a slow
 * connection without downloading the whole file first. There is no download
 * button; the last page read is remembered per book on this device.
 */
export function PdfReader({ url, storageKey }: { url: string; storageKey: string }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const docRef = useRef<PdfDoc | null>(null);
  const baseSizeRef = useRef<{ width: number; height: number } | null>(null);
  const canvasRefs = useRef<(HTMLCanvasElement | null)[]>([]);
  const rendered = useRef<Map<number, number>>(new Map()); // page → zoom it was rendered at
  const tasks = useRef<Map<number, { cancel: () => void }>>(new Map());

  const [numPages, setNumPages] = useState(0);
  const [zoom, setZoom] = useState(1); // 1 = fit width
  const [fitScale, setFitScale] = useState(1);
  const [current, setCurrent] = useState(1);
  const [pageInput, setPageInput] = useState("1");
  const [error, setError] = useState<string | null>(null);

  // Load the document.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
        pdfjs.GlobalWorkerOptions.workerSrc = "/api/pdf-worker";
        const doc = (await pdfjs.getDocument({ url, disableAutoFetch: true, rangeChunkSize: 262144 }).promise) as unknown as PdfDoc;
        if (cancelled) {
          doc.destroy();
          return;
        }
        const first = await doc.getPage(1);
        baseSizeRef.current = first.getViewport({ scale: 1 });
        docRef.current = doc;
        setNumPages(doc.numPages);
      } catch (err) {
        console.error("[PdfReader]", err);
        if (!cancelled) setError("This book could not be opened. Check your connection and try again.");
      }
    })();
    return () => {
      cancelled = true;
      docRef.current?.destroy();
      docRef.current = null;
    };
  }, [url]);

  // Fit-to-width scale follows the container's width.
  useEffect(() => {
    const el = containerRef.current;
    if (!el || !numPages) return;
    const update = () => {
      const base = baseSizeRef.current;
      if (base) setFitScale(Math.max(0.2, (el.clientWidth - 32) / base.width));
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, [numPages]);

  const scale = fitScale * zoom;

  const renderPage = useCallback(
    async (n: number) => {
      const doc = docRef.current;
      const canvas = canvasRefs.current[n - 1];
      if (!doc || !canvas || rendered.current.get(n) === scale) return;
      tasks.current.get(n)?.cancel();
      try {
        const page = await doc.getPage(n);
        const viewport = page.getViewport({ scale });
        const ratio = Math.min(window.devicePixelRatio || 1, 2);
        canvas.width = Math.floor(viewport.width * ratio);
        canvas.height = Math.floor(viewport.height * ratio);
        canvas.style.width = `${viewport.width}px`;
        canvas.style.height = `${viewport.height}px`;
        const ctx = canvas.getContext("2d");
        if (!ctx) return;
        ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
        const task = page.render({ canvasContext: ctx, viewport });
        tasks.current.set(n, task);
        await task.promise;
        rendered.current.set(n, scale);
      } catch {
        /* cancelled by a newer render or a zoom change */
      } finally {
        tasks.current.delete(n);
      }
    },
    [scale],
  );

  const clearPage = (n: number) => {
    const canvas = canvasRefs.current[n - 1];
    if (canvas && rendered.current.has(n)) {
      canvas.width = 0;
      canvas.height = 0;
      rendered.current.delete(n);
    }
  };

  // Track the page in view; render it and its neighbours, clear the rest.
  useEffect(() => {
    if (!numPages) return;
    rendered.current.clear();
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries.filter((e) => e.isIntersecting).map((e) => Number((e.target as HTMLElement).dataset.page));
        if (visible.length === 0) return;
        const page = Math.min(...visible);
        setCurrent(page);
        setPageInput(String(page));
        for (let n = 1; n <= numPages; n++) {
          if (Math.abs(n - page) <= KEEP_AROUND) renderPage(n);
          else clearPage(n);
        }
      },
      { root: containerRef.current, threshold: 0.15 },
    );
    containerRef.current?.querySelectorAll("[data-page]").forEach((el) => observer.observe(el));
    return () => observer.disconnect();
  }, [numPages, renderPage]);

  const goTo = useCallback((n: number) => {
    const target = containerRef.current?.querySelector(`[data-page="${n}"]`);
    target?.scrollIntoView({ block: "start" });
  }, []);

  // Restore the last page read, once the pages exist.
  useEffect(() => {
    if (!numPages) return;
    let saved = 1;
    try {
      saved = Number(localStorage.getItem(storageKey)) || 1;
    } catch {
      /* storage unavailable */
    }
    if (saved > 1 && saved <= numPages) setTimeout(() => goTo(saved), 50);
  }, [numPages, storageKey, goTo]);

  useEffect(() => {
    if (!numPages) return;
    try {
      localStorage.setItem(storageKey, String(current));
    } catch {
      /* storage unavailable */
    }
  }, [current, numPages, storageKey]);

  if (error) {
    return <div className="flex flex-1 items-center justify-center p-8 text-center text-text-secondary">{error}</div>;
  }

  const base = baseSizeRef.current;
  const placeholderH = base ? base.height * scale : 0;
  const placeholderW = base ? base.width * scale : 0;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border bg-surface px-3 py-2">
        <div className="flex items-center gap-1">
          <Button variant="ghost" size="sm" aria-label="Previous page" onClick={() => goTo(Math.max(1, current - 1))} disabled={current <= 1}>
            <ChevronUp className="h-4 w-4" />
          </Button>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              const n = Math.min(Math.max(1, Number(pageInput) || 1), numPages || 1);
              goTo(n);
            }}
            className="flex items-center gap-1 text-sm text-text-secondary"
          >
            <input
              value={pageInput}
              onChange={(e) => setPageInput(e.target.value.replace(/\D/g, ""))}
              className="w-12 rounded border border-border bg-surface px-1 py-0.5 text-center text-text-primary"
              aria-label="Page number"
              inputMode="numeric"
            />
            <span>/ {numPages || "…"}</span>
          </form>
          <Button variant="ghost" size="sm" aria-label="Next page" onClick={() => goTo(Math.min(numPages, current + 1))} disabled={current >= numPages}>
            <ChevronDown className="h-4 w-4" />
          </Button>
        </div>
        <div className="flex items-center gap-1">
          <Button variant="ghost" size="sm" aria-label="Zoom out" onClick={() => setZoom((z) => Math.max(MIN_ZOOM, +(z - 0.25).toFixed(2)))} disabled={zoom <= MIN_ZOOM}>
            <ZoomOut className="h-4 w-4" />
          </Button>
          <span className="w-12 text-center text-sm text-text-secondary">{Math.round(zoom * 100)}%</span>
          <Button variant="ghost" size="sm" aria-label="Zoom in" onClick={() => setZoom((z) => Math.min(MAX_ZOOM, +(z + 0.25).toFixed(2)))} disabled={zoom >= MAX_ZOOM}>
            <ZoomIn className="h-4 w-4" />
          </Button>
          <Button variant="ghost" size="sm" aria-label="Fit width" onClick={() => setZoom(1)}>
            <Maximize2 className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {/* Pages */}
      <div ref={containerRef} className="min-h-0 flex-1 overflow-auto bg-gray-100 px-4 py-4 dark:bg-gray-900">
        {!numPages ? (
          <div className="flex h-full items-center justify-center">
            <Spinner size="lg" className="text-primary" />
          </div>
        ) : (
          Array.from({ length: numPages }, (_, i) => (
            <div
              key={i}
              data-page={i + 1}
              className="relative mx-auto mb-4 bg-white shadow"
              style={{ width: placeholderW, minHeight: placeholderH }}
            >
              <canvas
                ref={(el) => {
                  canvasRefs.current[i] = el;
                }}
                className="block"
                onContextMenu={(e) => e.preventDefault()}
              />
            </div>
          ))
        )}
      </div>
    </div>
  );
}
