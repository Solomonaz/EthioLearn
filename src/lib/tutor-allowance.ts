/**
 * Daily cap on AI tutor messages, per user.
 *
 * The tutor is the one AI feature whose cost grows with how much a single
 * student chats, and before this it had only a 20-per-minute rate limit. At
 * about $0.0015 per paid reply, one student chatting all day could cost more
 * than their plan earns; a daily cap puts a ceiling on that, the way monthly
 * credits do for teachers (lib/teacher-ai-allowance).
 *
 * The limit is `PlatformSettings.tutorDailyMessageLimit` (null = no cap). The
 * day runs midnight to midnight in Addis Ababa (UTC+3, no daylight saving), so
 * a student's allowance renews overnight rather than mid-morning at UTC
 * midnight. Only replies actually delivered count, so a failed call never
 * uses up a message.
 *
 * The Whiteboard has its own, smaller allowance (the user's plan's
 * `whiteboardDailyLimit`, else `PlatformSettings.whiteboardDailyLimit`;
 * counted in the same row's `whiteboard` column): a new lesson, practice set or practice "Explain" —
 * read aloud by a paid voice — costs several times a chat reply, so it is
 * capped on its own instead of sharing the tutor's messages.
 *
 * Check-then-record is not atomic, so two requests racing on the last message
 * can both pass. The per-minute rate limit bounds that to one or two messages,
 * which is not worth a lock.
 */

import { db } from "./db";
import { getPlatformSettings } from "./platform-settings";
import { getEntitlements } from "./entitlements";

const ADDIS_OFFSET_MS = 3 * 60 * 60 * 1000;

export interface TutorDailyStatus {
  used: number;
  /** Null = no daily cap. */
  limit: number | null;
}

/** Today's date in Addis Ababa, as a UTC-midnight Date for a `@db.Date` column. */
function addisDay(now = new Date()): Date {
  const local = new Date(now.getTime() + ADDIS_OFFSET_MS);
  return new Date(Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate()));
}

/** Which daily allowance: tutor messages (chat, "Why was I wrong?") or Whiteboard lessons. */
export type AllowanceKind = "tutor" | "whiteboard";

type AllowanceUser = { id: string; role: string; schoolId: string | null; createdAt?: Date };

export async function getTutorDailyStatus(user: AllowanceUser, kind: AllowanceKind = "tutor"): Promise<TutorDailyStatus> {
  const [settings, row, ent] = await Promise.all([
    getPlatformSettings(),
    db.tutorDailyUse.findUnique({
      where: { userId_day: { userId: user.id, day: addisDay() } },
      select: { count: true, whiteboard: true },
    }),
    kind === "whiteboard" ? getEntitlements(user) : null,
  ]);
  if (kind === "whiteboard") {
    // The plan's limit wins; a plan that sets none uses the platform default.
    const planLimit = ent?.whiteboardDailyLimit;
    return { used: row?.whiteboard ?? 0, limit: planLimit !== undefined ? planLimit : settings.whiteboardDailyLimit };
  }
  return { used: row?.count ?? 0, limit: settings.tutorDailyMessageLimit };
}

export function tutorLimitReached(status: TutorDailyStatus): boolean {
  return status.limit !== null && status.used >= status.limit;
}

export function tutorLimitMessage(limit: number, kind: AllowanceKind = "tutor"): string {
  if (kind === "whiteboard") {
    return (
      `You have used all ${limit} Whiteboard lessons for today. ` +
      "They renew at midnight. Lessons you already made replay for free, and Textbook Chat still works."
    );
  }
  return (
    `You have used all ${limit} AI tutor messages for today. ` +
    "They renew at midnight. Your quizzes, games and other tools still work."
  );
}

/** Count one delivered tutor reply (or Whiteboard lesson). Returns the new total for today. */
export async function recordTutorMessage(userId: string, kind: AllowanceKind = "tutor"): Promise<number> {
  const day = addisDay();
  const field = kind === "whiteboard" ? "whiteboard" : "count";
  const row = await db.tutorDailyUse.upsert({
    where: { userId_day: { userId, day } },
    create: { userId, day, [field]: 1 },
    update: { [field]: { increment: 1 } },
    select: { count: true, whiteboard: true },
  });
  return kind === "whiteboard" ? row.whiteboard : row.count;
}
