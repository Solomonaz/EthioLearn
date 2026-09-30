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
 * Check-then-record is not atomic, so two requests racing on the last message
 * can both pass. The per-minute rate limit bounds that to one or two messages,
 * which is not worth a lock.
 */

import { db } from "./db";
import { getPlatformSettings } from "./platform-settings";

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

export async function getTutorDailyStatus(userId: string): Promise<TutorDailyStatus> {
  const [settings, row] = await Promise.all([
    getPlatformSettings(),
    db.tutorDailyUse.findUnique({
      where: { userId_day: { userId, day: addisDay() } },
      select: { count: true },
    }),
  ]);
  return { used: row?.count ?? 0, limit: settings.tutorDailyMessageLimit };
}

export function tutorLimitReached(status: TutorDailyStatus): boolean {
  return status.limit !== null && status.used >= status.limit;
}

export function tutorLimitMessage(limit: number): string {
  return (
    `You have used all ${limit} AI tutor messages for today. ` +
    "They renew at midnight. Your quizzes, games and other tools still work."
  );
}

/** Count one delivered tutor reply. Returns the new total for today. */
export async function recordTutorMessage(userId: string): Promise<number> {
  const day = addisDay();
  const row = await db.tutorDailyUse.upsert({
    where: { userId_day: { userId, day } },
    create: { userId, day, count: 1 },
    update: { count: { increment: 1 } },
    select: { count: true },
  });
  return row.count;
}
