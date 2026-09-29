import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function generateRoomCode(): string {
  return Math.floor(1000 + Math.random() * 9000).toString();
}

export function getPointsForDifficulty(difficulty: "EASY" | "MEDIUM" | "HARD"): number {
  const points = { EASY: 10, MEDIUM: 20, HARD: 30 };
  return points[difficulty];
}

/**
 * Format an ISO date string for display.
 * @param iso  ISO 8601 string (or null/undefined)
 * @param opts Intl.DateTimeFormatOptions — defaults to short month + day + year
 */
export function formatDate(
  iso: string | null | undefined,
  opts: Intl.DateTimeFormatOptions = { month: "short", day: "numeric", year: "numeric" },
): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-US", opts);
}

/**
 * Normalizes a question option that may be stored as a plain string
 * OR as an object `{ text: string; label: string }` (older AI generation format).
 */
export function normalizeOption(option: unknown): string {
  if (typeof option === "string") return option;
  if (option && typeof option === "object" && "text" in option) {
    return String((option as { text: unknown }).text);
  }
  return String(option);
}

/**
 * Returns a NEW array with the elements Fisher-Yates shuffled (does not mutate
 * the input). Used to randomise MCQ answer order so the correct choice isn't
 * always in slot A — safe because quiz grading matches by option TEXT, not by
 * position. Never apply to MATCH_PAIRS / ORDERING options: their array order
 * carries meaning.
 */
export function shuffleArray<T>(arr: readonly T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/**
 * Quick-pick question-count presets that scale with how many questions are
 * available. Uses familiar round numbers (5/10/20…) when at least two fit below
 * the max; for a small selection it falls back to proportional quarter/half
 * points so there's never a lone, arbitrary preset next to "Max (N)". All
 * presets are strictly below max — the "Max" button already covers the top.
 */
export function buildQuickPresets(max: number): number[] {
  if (max <= 3) return []; // "Max (N)" alone is enough
  const rounds = [5, 10, 20, 30, 50].filter((n) => n < max);
  if (rounds.length >= 2) return rounds.slice(0, 3);
  const nice = (x: number) => (x < 10 ? Math.max(2, Math.round(x)) : Math.round(x / 5) * 5);
  return [...new Set([nice(max / 4), nice(max / 2)])]
    .filter((n) => n >= 2 && n < max)
    .sort((a, b) => a - b);
}

/** Maps a quiz score percentage to a Badge variant. */
export function scoreVariant(score: number): "success" | "warning" | "error" {
  if (score >= 70) return "success";
  if (score >= 40) return "warning";
  return "error";
}
