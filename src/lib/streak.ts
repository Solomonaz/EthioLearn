import { db } from "./db";
import { createNotification } from "./notifications";
import { addDays, addisDayKey, dayDiff } from "./study-time";

/**
 * Study streaks.
 *
 * A streak counts consecutive Addis Ababa days with real study — any of a
 * quiz, the Daily Challenge, the AI tutor, a battle, a national exam paper or
 * a class activity, not only quiz submission. Streak freezes forgive missed
 * days: one is earned every FREEZE_EVERY days in a row (banked up to
 * MAX_FREEZES) and spent automatically, one per missed day, when the student
 * comes back. Not enough freezes for the gap → the streak starts again at 1.
 *
 * The rules are pure functions (advanceStreak / viewStreak) so they can be
 * tested without a database; recordStudyActivity applies them.
 */

export const FREEZE_EVERY = 7;
export const MAX_FREEZES = 2;

export type StudySource =
  | "quiz"
  | "daily_challenge"
  | "tutor"
  | "battle"
  | "national_exam"
  | "activity";

export interface StreakState {
  streakDays: number;
  lastStudyDay: string | null;
  streakFreezes: number;
  longestStreak: number;
}

export interface StreakAdvance extends StreakState {
  /** False when today was already counted. */
  changed: boolean;
  /** Missed days a freeze covered on the way to today. */
  frozenDays: string[];
  earnedFreeze: boolean;
}

/** The streak after studying on `today`. */
export function advanceStreak(state: StreakState, today: string): StreakAdvance {
  const same = { ...state, changed: false, frozenDays: [], earnedFreeze: false };
  let streak: number;
  let freezes = state.streakFreezes;
  const frozenDays: string[] = [];

  if (!state.lastStudyDay) {
    streak = 1;
  } else {
    const gap = dayDiff(state.lastStudyDay, today);
    if (gap <= 0) return same; // already counted today (or clock skew)
    if (gap === 1) {
      streak = state.streakDays + 1;
    } else {
      const missed = gap - 1;
      if (state.streakDays > 0 && missed <= freezes) {
        freezes -= missed;
        for (let i = 1; i <= missed; i++) frozenDays.push(addDays(state.lastStudyDay, i));
        streak = state.streakDays + 1;
      } else {
        streak = 1;
      }
    }
  }

  let earnedFreeze = false;
  if (streak % FREEZE_EVERY === 0 && freezes < MAX_FREEZES) {
    freezes += 1;
    earnedFreeze = true;
  }

  return {
    streakDays: streak,
    lastStudyDay: today,
    streakFreezes: freezes,
    longestStreak: Math.max(state.longestStreak, streak),
    changed: true,
    frozenDays,
    earnedFreeze,
  };
}

export interface StreakView {
  /** The streak as it stands now: 0 once it can no longer be saved. */
  days: number;
  studiedToday: boolean;
  /** Alive but today still needs study (or a freeze) to keep it. */
  atRisk: boolean;
  /** Freezes left after covering the days already missed. */
  freezes: number;
  longest: number;
}

/** What the streak looks like on `today`, without changing anything. */
export function viewStreak(state: StreakState, today: string): StreakView {
  const longest = Math.max(state.longestStreak, state.streakDays);
  if (!state.lastStudyDay || state.streakDays <= 0) {
    return { days: 0, studiedToday: false, atRisk: false, freezes: state.streakFreezes, longest };
  }
  const gap = dayDiff(state.lastStudyDay, today);
  if (gap <= 0) {
    return { days: state.streakDays, studiedToday: true, atRisk: false, freezes: state.streakFreezes, longest };
  }
  const missed = gap - 1;
  if (missed <= state.streakFreezes) {
    return {
      days: state.streakDays,
      studiedToday: false,
      atRisk: true,
      freezes: state.streakFreezes - missed,
      longest,
    };
  }
  return { days: 0, studiedToday: false, atRisk: false, freezes: state.streakFreezes, longest };
}

/** Streak state from a user row; older accounts fall back to lastActiveAt. */
export function streakStateOf(user: {
  streakDays: number;
  lastStudyDay?: string | null;
  streakFreezes?: number | null;
  longestStreak?: number | null;
  lastActiveAt?: Date | string | null;
}): StreakState {
  const legacyDay =
    user.streakDays > 0 && user.lastActiveAt ? addisDayKey(new Date(user.lastActiveAt)) : null;
  return {
    streakDays: user.streakDays ?? 0,
    lastStudyDay: user.lastStudyDay ?? legacyDay,
    streakFreezes: user.streakFreezes ?? 0,
    longestStreak: user.longestStreak ?? 0,
  };
}

export interface RecordedStudy {
  streakDays: number;
  firstToday: boolean;
  earnedFreeze: boolean;
  usedFreezes: number;
}

/**
 * Count real study for a student today: logs the StudyDay, advances the
 * streak once per day, and switches paused reminders back on. Never throws —
 * a streak hiccup must not fail the quiz, tutor reply or battle that called it.
 * Returns null for non-students or on error.
 */
export async function recordStudyActivity(
  userId: string,
  source: StudySource,
  now: Date = new Date(),
): Promise<RecordedStudy | null> {
  try {
    const today = addisDayKey(now);
    const user = await db.user.findUnique({
      where: { id: userId },
      select: {
        role: true,
        streakDays: true,
        lastStudyDay: true,
        streakFreezes: true,
        longestStreak: true,
        lastActiveAt: true,
      },
    });
    if (!user || user.role !== "STUDENT") return null;

    // Day log (one row per day; count every activity, keep distinct sources).
    const existing = await db.studyDay.findUnique({
      where: { userId_day: { userId, day: today } },
      select: { id: true, sources: true, frozen: true },
    });
    if (existing) {
      await db.studyDay.update({
        where: { id: existing.id },
        data: {
          activities: { increment: 1 },
          frozen: false,
          ...(existing.sources.includes(source) ? {} : { sources: { push: source } }),
        },
      });
    } else {
      await db.studyDay
        .create({ data: { userId, day: today, sources: [source] } })
        .catch(async () => {
          // A concurrent request created it first.
          await db.studyDay.update({
            where: { userId_day: { userId, day: today } },
            data: { activities: { increment: 1 } },
          });
        });
    }

    const next = advanceStreak(streakStateOf(user), today);
    if (!next.changed) {
      await db.user.update({ where: { id: userId }, data: { lastActiveAt: now } });
      return { streakDays: user.streakDays, firstToday: false, earnedFreeze: false, usedFreezes: 0 };
    }

    // Conditional on today not being counted yet, so two simultaneous
    // first-of-the-day requests cannot both add a day.
    const updated = await db.user.updateMany({
      where: { id: userId, OR: [{ lastStudyDay: null }, { lastStudyDay: { not: today } }] },
      data: {
        streakDays: next.streakDays,
        lastStudyDay: today,
        streakFreezes: next.streakFreezes,
        longestStreak: next.longestStreak,
        lastActiveAt: now,
        reminderMisses: 0,
        remindersPausedAt: null,
      },
    });
    if (updated.count === 0) {
      const fresh = await db.user.findUnique({ where: { id: userId }, select: { streakDays: true } });
      return { streakDays: fresh?.streakDays ?? next.streakDays, firstToday: false, earnedFreeze: false, usedFreezes: 0 };
    }

    if (next.frozenDays.length) {
      await db.studyDay.createMany({
        data: next.frozenDays.map((day) => ({ userId, day, activities: 0, frozen: true })),
        skipDuplicates: true,
      });
    }

    if (next.frozenDays.length) {
      createNotification(
        userId,
        "streak",
        "Streak saved!",
        `A streak freeze covered ${next.frozenDays.length === 1 ? "the day you missed" : `the ${next.frozenDays.length} days you missed`}. Your streak is now ${next.streakDays} days.`,
        { days: next.streakDays },
      ).catch(console.error);
    }
    if (next.earnedFreeze) {
      createNotification(
        userId,
        "streak",
        "Streak freeze earned",
        `You now have ${next.streakFreezes} streak freeze${next.streakFreezes === 1 ? "" : "s"}. A freeze saves your streak automatically if you miss a day.`,
        { days: next.streakDays },
      ).catch(console.error);
    }

    return {
      streakDays: next.streakDays,
      firstToday: true,
      earnedFreeze: next.earnedFreeze,
      usedFreezes: next.frozenDays.length,
    };
  } catch (err) {
    console.error("[streak] recordStudyActivity failed:", err);
    return null;
  }
}

/** Last `n` days (oldest first) with what happened on each, for the streak calendar. */
export async function recentStudyCalendar(userId: string, n = 7, now: Date = new Date()) {
  const today = addisDayKey(now);
  const from = addDays(today, -(n - 1));
  const rows = await db.studyDay.findMany({
    where: { userId, day: { gte: from, lte: today } },
    select: { day: true, frozen: true },
  });
  const byDay = new Map(rows.map((r) => [r.day, r]));
  return Array.from({ length: n }, (_, i) => {
    const day = addDays(from, i);
    const row = byDay.get(day);
    return { day, status: row ? (row.frozen ? "frozen" : "studied") : "none" } as const;
  });
}

/**
 * Zero the stored streak of anyone whose streak can no longer be saved, so
 * admin and teacher views (which read streakDays directly) stay honest.
 * Freezes are untouched. Returns how many streaks were reset.
 */
export async function settleBrokenStreaks(now: Date = new Date()): Promise<number> {
  const today = addisDayKey(now);
  // Broken when the days missed (gap − 1) exceed the banked freezes.
  const n = await db.$executeRaw`
    UPDATE users SET "streakDays" = 0
    WHERE "streakDays" > 0
      AND COALESCE("lastStudyDay", to_char("lastActiveAt" + interval '3 hours', 'YYYY-MM-DD')) IS NOT NULL
      AND (${today}::date - COALESCE("lastStudyDay", to_char("lastActiveAt" + interval '3 hours', 'YYYY-MM-DD'))::date) - 1 > "streakFreezes"`;
  return Number(n);
}
