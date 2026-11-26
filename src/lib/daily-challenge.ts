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
export function getTodayRange(now: Date = new Date()) {
  const key = addisDayKey(now);
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

/** The student's chosen challenge subjects (new list, else the old single choice). */
export function chosenSubjectsOf(me: { dailyChallengeSubjects?: string[] | null; dailyChallengeSubject?: string | null } | null): string[] {
  if (me?.dailyChallengeSubjects?.length) return me.dailyChallengeSubjects;
  return me?.dailyChallengeSubject ? [me.dailyChallengeSubject] : [];
}

/**
 * Today's challenge chapter for this student, or null when their grade has no
 * chapters with questions. Stable for the day (a hash of the student and the
 * day): first one of their chosen subjects, so every subject gets its turn
 * whatever its chapter count, then a chapter of it.
 */
export async function todaysChallenge(
  user: { id: string; role: string; schoolId?: string | null; grade: number | null },
  now: Date = new Date(),
) {
  const { key: dayKey } = getTodayRange(now);
  const [chapters, me] = await Promise.all([
    challengeChapters(user),
    db.user.findUnique({ where: { id: user.id }, select: { dailyChallengeSubject: true, dailyChallengeSubjects: true } }),
  ]);
  if (chapters.length === 0) return null;
  const subjects = subjectsOf(chapters);
  // Chosen subjects that no longer have questions are skipped; none left =
  // any subject.
  const chosen = chosenSubjectsOf(me).filter((s) => subjects.includes(s));
  const candidates = chosen.length ? chosen : subjects;
  const hash = crypto.createHash("sha256").update(`${user.id}|${dayKey}|${chosen.join(",") || "*"}`).digest();
  const subject = candidates[hash.readUInt32BE(0) % candidates.length];
  const pool = chapters.filter((c) => c.textbook.subject === subject);
  return { chapter: pool[hash.readUInt32BE(4) % pool.length], subjects, chosen };
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
