/**
 * Calendar helpers pinned to Ethiopian time (Africa/Addis_Ababa, UTC+3, no
 * daylight saving). Streaks, reminders and the weekly leaderboard all mean the
 * student's day, not the server's — the server runs in UTC, so a quiz at 01:00
 * in Addis would otherwise count for "yesterday".
 */

const ADDIS_OFFSET_MS = 3 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

/** "YYYY-MM-DD" of the Addis Ababa calendar day containing `d`. */
export function addisDayKey(d: Date = new Date()): string {
  return new Date(d.getTime() + ADDIS_OFFSET_MS).toISOString().slice(0, 10);
}

/** Hour of day (0–23) in Addis Ababa. */
export function addisHour(d: Date = new Date()): number {
  return new Date(d.getTime() + ADDIS_OFFSET_MS).getUTCHours();
}

/** Day of week in Addis Ababa: 0 = Sunday … 6 = Saturday. */
export function addisWeekday(d: Date = new Date()): number {
  return new Date(d.getTime() + ADDIS_OFFSET_MS).getUTCDay();
}

/** Whole days from day key `a` to day key `b` (b − a). */
export function dayDiff(a: string, b: string): number {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / DAY_MS);
}

/** The day key `n` days after `day` (negative = before). */
export function addDays(day: string, n: number): string {
  return new Date(Date.parse(`${day}T00:00:00Z`) + n * DAY_MS).toISOString().slice(0, 10);
}

/** The UTC instant at which Addis day `day` begins. */
export function addisDayStart(day: string): Date {
  return new Date(Date.parse(`${day}T00:00:00Z`) - ADDIS_OFFSET_MS);
}

/** Start (Monday 00:00 Addis) of the week containing `d`, as a UTC instant. */
export function addisWeekStart(d: Date = new Date()): Date {
  const today = addisDayKey(d);
  const sinceMonday = (addisWeekday(d) + 6) % 7;
  return addisDayStart(addDays(today, -sinceMonday));
}
