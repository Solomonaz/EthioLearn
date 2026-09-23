"use client";

import { useEffect, type RefObject } from "react";

/**
 * Sizes a board so it ends at the bottom of the screen instead of below it —
 * a fixed `80vh` ignores the header and toolbar above the board, which pushed
 * its bottom-corner tools off-screen. Height = viewport height minus the
 * board's distance from the top of the page, never below `min` (short
 * screens scroll instead of squashing the board). Full screen is unaffected:
 * the browser's :fullscreen styles override the inline height.
 */
export function useFitViewport(
  ref: RefObject<HTMLElement | null>,
  { min = 420, gap = 16 }: { min?: number; gap?: number } = {}
) {
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const fit = () => {
      if (document.fullscreenElement === el) return;
      const top = el.getBoundingClientRect().top + window.scrollY;
      const h = `${Math.max(min, Math.floor(window.innerHeight - top - gap))}px`;
      if (el.style.height !== h) el.style.height = h;
    };
    fit();
    window.addEventListener("resize", fit);
    document.addEventListener("fullscreenchange", fit);
    // Content above the board (toolbars, banners) can change height after load.
    const ro = new ResizeObserver(fit);
    if (el.parentElement) ro.observe(el.parentElement);
    return () => {
      window.removeEventListener("resize", fit);
      document.removeEventListener("fullscreenchange", fit);
      ro.disconnect();
    };
  }, [ref, min, gap]);
}
