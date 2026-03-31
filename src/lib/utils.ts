import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function generateRoomCode(): string {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

export function formatPhoneNumber(phone: string): string {
  if (phone.startsWith("0")) {
    return "+251" + phone.slice(1);
  }
  if (phone.startsWith("251")) {
    return "+" + phone;
  }
  return phone;
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

/** Maps a quiz score percentage to a Badge variant. */
export function scoreVariant(score: number): "success" | "warning" | "error" {
  if (score >= 70) return "success";
  if (score >= 40) return "warning";
  return "error";
}
