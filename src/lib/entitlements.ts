/**
 * Plan-based entitlements — resolves what a given user is allowed to do.
 *
 * Rules:
 *   • Non-students (admins) → full access.
 *   • School-registered students (have a schoolId) → full access, always.
 *   • Individual students (no school) → determined by their current plan:
 *       - a plan with allowAi/allowMultiplayer flags, or
 *       - NO active plan → the free defaults (no AI, no multiplayer; solo only).
 *
 * Solo quizzes/games are never gated — the "free" tier can always play solo.
 */

import { db } from "./db";

export interface Entitlements {
  /** AI tutor, AI video tutorials, AI quiz generation. */
  ai: boolean;
  /** Battle / group (multiplayer) games. Solo is always allowed. */
  multiplayer: boolean;
  /** Rewards catalogue & redemption. */
  rewards: boolean;
  /** Leaderboard / rankings. */
  leaderboard: boolean;
}

export const FULL_ACCESS: Entitlements = {
  ai: true,
  multiplayer: true,
  rewards: true,
  leaderboard: true,
};
// Individual student with no (or a free) plan: solo only — no AI, no multiplayer,
// no rewards, no leaderboard.
export const FREE_TIER: Entitlements = {
  ai: false,
  multiplayer: false,
  rewards: false,
  leaderboard: false,
};

const LIVE_STATUSES = ["TRIAL", "ACTIVE", "PAST_DUE"] as const;

interface UserLike {
  id: string;
  role: string;
  schoolId: string | null;
}

/**
 * Resolve the entitlements for a user. Reads their current subscription only
 * for individual students (the only ones whose access is plan-gated).
 */
export async function getEntitlements(user: UserLike | null | undefined): Promise<Entitlements> {
  if (!user) return FREE_TIER;

  // Admins and other non-student roles are unrestricted.
  if (user.role !== "STUDENT") return FULL_ACCESS;

  // Students who belong to a school always have full access (managed by school).
  if (user.schoolId) return FULL_ACCESS;

  // Individual student → look up their current plan. A sub counts as live only
  // while its status is live AND it hasn't passed its endDate (the paid-through
  // date for a canceled-at-period-end sub, or a trial's end).
  const sub = await db.subscription.findFirst({
    where: {
      studentId: user.id,
      status: { in: [...LIVE_STATUSES] },
      OR: [{ endDate: null }, { endDate: { gt: new Date() } }],
    },
    orderBy: { createdAt: "desc" },
    select: {
      plan: {
        select: {
          allowAi: true,
          allowMultiplayer: true,
          allowRewards: true,
          allowLeaderboard: true,
        },
      },
    },
  });

  if (!sub?.plan) return FREE_TIER;
  return {
    ai: sub.plan.allowAi,
    multiplayer: sub.plan.allowMultiplayer,
    rewards: sub.plan.allowRewards,
    leaderboard: sub.plan.allowLeaderboard,
  };
}

// Human-readable messages returned by the API when a capability is locked.
export const UPGRADE_MESSAGES = {
  ai: "AI features aren't included in your current plan. Upgrade to a full-access plan to use the AI tutor, AI videos, and AI-generated quizzes.",
  multiplayer: "Battle mode isn't included in your current plan. Upgrade to a full-access plan to play against others.",
  rewards: "Rewards aren't included in your current plan. Upgrade to a full-access plan to earn and redeem rewards.",
  leaderboard: "The leaderboard isn't included in your current plan. Upgrade to a full-access plan to see rankings.",
} as const;

export type EntitlementKey = keyof Entitlements;
