/**
 * The daily challenge: one chapter of the student's grade per day, picked on
 * the server. Shared by GET /api/students/me/daily-challenge (shows it) and the
 * quiz routes (a quiz only counts as the daily challenge when it is today's
 * chapter and today's challenge isn't done yet — never because the client
 * says so).
 */
import crypto from "node:crypto";
import { db } from "./db";
import { addDays, addisDayKey, addisDayStart } from "./study-time";
import { readableTextbookWhere } from "./library-access";

export const DAILY_CHALLENGE_QUESTIONS = 5;

/**
 * Today in Addis Ababa, as UTC instants [today, tomorrow) — the same day the
 * streak and reminders use (the server runs in UTC, where midnight is 3 AM
 * in Addis).
 */
export function getTodayRange() {
  const key = addisDayKey();
  return { today: addisDayStart(key), tomorrow: addisDayStart(addDays(key, 1)), key };
}

/**
 * The student's grade's chapters that have questions, with their subject —
 * from books they may read (the national library or their own school).
 */
export async function challengeChapters(user: { role: string; schoolId?: string | null; grade: number | null }) {
  return db.chapter.findMany({
    where: {
      questionCount: { gt: 0 },
      textbook: { processingStatus: "COMPLETED", grade: user.grade ?? undefined, ...readableTextbookWhere(user) },
    },
    select: { id: true, title: true, textbook: { select: { subject: true } } },
    orderBy: { id: "asc" },
  });
}

export function subjectsOf(chapters: { textbook: { subject: string } }[]): string[] {
  return [...new Set(chapters.map((c) => c.textbook.subject))].sort((a, b) => a.localeCompare(b));
}

/**
 * Today's challenge chapter for this student (stable for the day: a hash of
 * the student, the day and their chosen subject), or null when their grade has
 * no chapters with questions.
 */
export async function todaysChallenge(user: { id: string; role: string; schoolId?: string | null; grade: number | null }) {
  const { key: dayKey } = getTodayRange();
  const [chapters, me] = await Promise.all([
    challengeChapters(user),
    db.user.findUnique({ where: { id: user.id }, select: { dailyChallengeSubject: true } }),
  ]);
  if (chapters.length === 0) return null;
  const subjects = subjectsOf(chapters);
  // A saved subject that no longer has questions falls back to any subject.
  const chosen = me?.dailyChallengeSubject && subjects.includes(me.dailyChallengeSubject) ? me.dailyChallengeSubject : null;
  const pool = chosen ? chapters.filter((c) => c.textbook.subject === chosen) : chapters;
  const hash = crypto.createHash("sha256").update(`${user.id}|${dayKey}|${chosen ?? "*"}`).digest();
  return { chapter: pool[hash.readUInt32BE(0) % pool.length], subjects, chosen };
}

/** Whether today's challenge already counted (a completed daily-challenge quiz today). */
export async function challengeDoneToday(userId: string, exceptQuizId?: string): Promise<boolean> {
  const { today, tomorrow } = getTodayRange();
  const n = await db.quiz.count({
    where: {
      studentId: userId,
      isDailyChallenge: true,
      completedAt: { gte: today, lt: tomorrow },
      ...(exceptQuizId ? { id: { not: exceptQuizId } } : {}),
    },
  });
  return n > 0;
}

/**
 * The server's answer to "may this new quiz be the daily challenge?": only for
 * today's chapter, and only while today's challenge hasn't been completed.
 */
export async function isDailyChallengeQuiz(
  user: { id: string; role: string; schoolId?: string | null; grade: number | null },
  chapterId: unknown,
): Promise<boolean> {
  if (typeof chapterId !== "string") return false;
  const pick = await todaysChallenge(user);
  if (!pick || pick.chapter.id !== chapterId) return false;
  return !(await challengeDoneToday(user.id));
}
