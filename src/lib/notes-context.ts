"use client";

/**
 * What the student is studying right now, so a new note can be tagged with it
 * ("Genetics · biology") and found again later.
 *
 * A page that knows something more specific than its own name — the tutor
 * knows the chapter — calls `useNotesContext(label)`. Every other page falls
 * back to a name derived from its path (`pageLabel`).
 */

import { useEffect, useSyncExternalStore } from "react";

let current: string | null = null;
const listeners = new Set<() => void>();

function set(label: string | null) {
  current = label;
  listeners.forEach((l) => l());
}

/** Publish a specific context (e.g. the selected chapter) while mounted. */
export function useNotesContext(label: string | null) {
  useEffect(() => {
    set(label);
    return () => set(null);
  }, [label]);
}

/** The context a page published, or null. */
export function usePublishedNotesContext(): string | null {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => current,
    () => null
  );
}

const PAGE_NAMES: Record<string, string> = {
  "/student": "Dashboard",
  "/student/quiz": "Quiz",
  "/student/battle": "Battle",
  "/student/tutor": "AI Tutor",
  "/student/geometry": "3D Geometry",
  "/student/grapher": "Graphing",
  "/student/activities": "Activities",
  "/student/history": "Quiz history",
  "/student/progress": "My progress",
  "/student/leaderboard": "Leaderboard",
  "/student/rewards": "Rewards",
};

/** A readable name for a student page path. */
export function pageLabel(path: string): string {
  const clean = path.replace(/\/+$/, "") || "/";
  // Longest known prefix wins, so /student/quiz/123 is still "Quiz".
  const match = Object.keys(PAGE_NAMES)
    .filter((p) => clean === p || clean.startsWith(p + "/"))
    .sort((a, b) => b.length - a.length)[0];
  if (match) return PAGE_NAMES[match];
  const last = clean.split("/").filter(Boolean).pop() ?? "Home";
  return last.charAt(0).toUpperCase() + last.slice(1).replace(/-/g, " ");
}
