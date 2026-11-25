/**
 * "Contact us": messages from users to the Abugida team.
 *
 * Any signed-in user except the super admin can write (students, grades 1-8
 * players, teachers, school admins). The super admin reads and answers them in
 * Admin → Messages; the answer shows on the user's contact page and arrives
 * as a notification. Pure helpers here — shared by the API routes and pages.
 */
import { homeRouteForRole } from "./teacher-band";

export const SUPPORT_TOPICS = ["payment", "account", "bug", "content", "idea", "other"] as const;
export type SupportTopic = (typeof SUPPORT_TOPICS)[number];
export const isSupportTopic = (v: unknown): v is SupportTopic =>
  typeof v === "string" && (SUPPORT_TOPICS as readonly string[]).includes(v);

export const SUPPORT_STATUSES = ["open", "answered", "closed"] as const;
export type SupportStatus = (typeof SUPPORT_STATUSES)[number];
export const isSupportStatus = (v: unknown): v is SupportStatus =>
  typeof v === "string" && (SUPPORT_STATUSES as readonly string[]).includes(v);

export const SUPPORT_MIN_CHARS = 10;
export const SUPPORT_MAX_CHARS = 1000;
export const SUPPORT_REPLY_MAX_CHARS = 2000;
/** Messages one user may send per day, and in a short burst (counted from saved messages). */
export const SUPPORT_DAILY_LIMIT = 10;
export const SUPPORT_BURST_LIMIT = 5;
export const SUPPORT_BURST_WINDOW_MS = 10 * 60_000;

/** Plain text: no control characters (keeps line breaks), trimmed. */
export function cleanSupportText(v: unknown, max: number): string {
  if (typeof v !== "string") return "";
  return v
    .replace(/\r\n?/g, "\n")
    .replace(/[\u0000-\u0009\u000b-\u001f\u007f]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
    .slice(0, max);
}

/** The contact page in this user's own area of the site. */
export function contactHref(role: string | null | undefined, grade?: number | null): string {
  return `${homeRouteForRole(role, grade)}/contact`;
}
