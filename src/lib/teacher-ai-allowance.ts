/**
 * Teachers' AI access (both bands), tied to their school's plan.
 *
 * Two rules:
 *   1. The school must have a live subscription (skipped while pricing is
 *      switched off platform-wide). A school that has not paid, or whose term
 *      has ended, keeps every non-AI teacher tool — only the AI that costs
 *      money stops.
 *   2. Each teacher gets a monthly budget of CREDITS (calendar month, UTC):
 *      the school plan's `teacherAiMonthlyLimit`, or — when the plan sets none,
 *      or pricing is off — the platform default. Only a null default means no
 *      cap, so launching free no longer means launching uncapped.
 *
 * Credits are weighted by what a generation costs (`TEACHER_AI_CREDITS`), not
 * counted one per request: measured Sep 2026, one assistant reply was about
 * $0.007 while each AI-written quiz question cost about $0.009 through the
 * full verify/quality pipeline, so a flat count let one 25-question paper
 * spend what 30 assistant replies do. Each thing the teacher asked for is one
 * `TeacherAiUse` row carrying its credits. Documents served from the shared
 * library never count: they cost nothing.
 *
 * Check-then-record is not atomic, so two requests racing on the last unit can
 * both pass. The per-minute rate limits bound that to a unit or two, which is
 * not worth a lock.
 */

import { db } from "./db";
import { getPlatformSettings } from "./platform-settings";

const LIVE_STATUSES = ["TRIAL", "ACTIVE", "PAST_DUE"] as const;

export type TeacherAiKind = "assistant" | "workout" | "questions" | "merge";

/**
 * Credits per generation. One credit ≈ one assistant reply. Workouts and
 * merges are one model call each but with a much longer output (up to 30
 * worked problems) or input (several whole documents), so they count double.
 * AI quiz questions are priced per question — see `questionCredits`.
 */
export const TEACHER_AI_CREDITS: Record<Exclude<TeacherAiKind, "questions">, number> = {
  assistant: 1,
  workout: 2,
  merge: 2,
};

/** Credits for AI-writing `count` quiz questions: one per question. */
export function questionCredits(count: number): number {
  return Math.max(1, Math.ceil(count));
}

export interface TeacherAiStatus {
  /** False when pricing is on and the school has no live subscription. */
  schoolActive: boolean;
  /** Credits this teacher has spent this month. */
  used: number;
  /** Monthly credit budget (plan, else platform default); null = unlimited. */
  limit: number | null;
  /** When `used` starts again from zero. */
  resetsAt: Date;
}

function monthBounds(now = new Date()): { start: Date; end: Date } {
  return {
    start: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)),
    end: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1)),
  };
}

export async function getTeacherAiStatus(user: {
  id: string;
  schoolId: string | null;
}): Promise<TeacherAiStatus> {
  const { start, end } = monthBounds();
  const settings = await getPlatformSettings();

  const [sub, used] = await Promise.all([
    settings.pricingEnabled && user.schoolId
      ? db.subscription.findFirst({
          where: {
            schoolId: user.schoolId,
            status: { in: [...LIVE_STATUSES] },
            OR: [{ endDate: null }, { endDate: { gt: new Date() } }],
          },
          orderBy: { createdAt: "desc" },
          select: { plan: { select: { teacherAiMonthlyLimit: true } } },
        })
      : null,
    db.teacherAiUse.aggregate({
      where: { teacherId: user.id, createdAt: { gte: start } },
      _sum: { credits: true },
    }),
  ]);
  const spent = used._sum.credits ?? 0;
  const platformDefault = settings.teacherAiDefaultMonthlyCredits;

  if (!settings.pricingEnabled) {
    return { schoolActive: true, used: spent, limit: platformDefault, resetsAt: end };
  }
  return {
    schoolActive: Boolean(sub),
    used: spent,
    limit: sub?.plan.teacherAiMonthlyLimit ?? platformDefault,
    resetsAt: end,
  };
}

/**
 * Why this teacher may not use AI right now, or null when they may.
 * `credits` is what the generation about to run will cost — pass 0 for the
 * cheap lookups that run before the shared library is tried, so a library hit
 * is still served to a teacher who has used their allowance.
 */
export function teacherAiDenial(
  status: TeacherAiStatus,
  credits: number,
): { error: string; status: 402 | 429 } | null {
  if (!status.schoolActive) {
    return {
      status: 402,
      error:
        "Your school's EthioLearn subscription is not active, so AI writing is paused. " +
        "Everything else you use in class still works — ask your school admin to renew.",
    };
  }
  if (credits > 0 && status.limit !== null && status.used + credits > status.limit) {
    const left = Math.max(0, status.limit - status.used);
    const resets = status.resetsAt.toLocaleDateString("en-GB", {
      day: "numeric",
      month: "long",
      timeZone: "UTC",
    });
    return {
      status: 429,
      error:
        left === 0
          ? `You have used all ${status.limit} AI credits for this month. ` +
            `They reset on ${resets}. Materials already in the library can still be used.`
          : `This needs ${credits} AI credits and you have ${left} left this month ` +
            `(they reset on ${resets}). Try a smaller request, or use materials already in the library.`,
    };
  }
  return null;
}

/**
 * Charge one generation. Call only after the AI actually produced something,
 * with the credits it actually used (a question run is charged for the
 * questions it delivered, not the number asked for).
 */
export async function recordTeacherAiUse(
  user: { id: string; schoolId: string | null },
  kind: TeacherAiKind,
  credits: number,
): Promise<void> {
  if (!user.schoolId || credits <= 0) return;
  await db.teacherAiUse
    .create({ data: { teacherId: user.id, schoolId: user.schoolId, kind, credits } })
    // Accounting must never fail a result the teacher already has.
    .catch((err) => console.warn("[TeacherAi] Failed to record use:", err));
}
