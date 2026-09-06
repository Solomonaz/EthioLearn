"use client";
import { useEffect } from "react";

/**
 * Registers the PWA service worker — in PRODUCTION ONLY.
 *
 * In development the worker does more harm than good: it serves a cached copy
 * of the app shell while Turbopack is rebuilding chunks on every edit, so the
 * browser asks for chunk files that no longer exist and the page dies with
 * `ChunkLoadError`. (A hard reload "fixes" it only because it bypasses the
 * worker.) So in dev we don't register — and we actively tear down any worker
 * and cache left behind from a previous run, otherwise a worker installed
 * before this guard existed would keep hijacking localhost forever.
 */
export function PWAInit() {
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;

    if (process.env.NODE_ENV === "production") {
      navigator.serviceWorker.register("/sw.js").catch(console.error);
      return;
    }

    // Development: unregister anything already installed and drop its caches.
    navigator.serviceWorker
      .getRegistrations()
      .then((regs) => Promise.all(regs.map((r) => r.unregister())))
      .catch(console.error);

    if ("caches" in window) {
      caches
        .keys()
        .then((keys) => Promise.all(keys.map((k) => caches.delete(k))))
        .catch(console.error);
    }
  }, []);

  return null;
}
