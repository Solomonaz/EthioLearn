/**
 * Plan-based entitlements — resolves what a given user is allowed to do.
 *
 * Rules:
 *   • Non-students (admins) → full access.
 *   • School-registered students (have a schoolId) → full access, always.
 *   • Individual students (no school) → determined by their current plan:
 *       - a plan with allowAi/allowMultiplayer flags, or
 *       - NO active plan → the free defaults (no AI, no multiplayer; solo only).
 *       - within the sign-up free trial (PlatformSettings.studentTrialDays,
 *         counted from account creation) → full access, whatever the plan.
 *
 * Solo quizzes/games are never gated — the "free" tier can always play solo.
 */

import { db } from "./db";
import { getPlatformSettings } from "./platform-settings";

export interface Entitlements {
  /** AI tutor, AI quiz generation. */
  ai: boolean;
  /** Battle / group (multiplayer) games. Solo is always allowed. */
  multiplayer: boolean;
  /** Rewards catalogue & redemption. */
  rewards: boolean;
  /** Leaderboard / rankings. */
  leaderboard: boolean;
  /** Graphing calculator & 3D geometry lab. */
  mathTools: boolean;
  /**
   * Every grades 1-8 game in the play area. Without it a grades 1-8 student
   * still has the free games (see FREE_PLAY_GAMES in lib/games/play).
   */
  games: boolean;
  /** Anti-cheat tracking (tab-switch detection, clipboard lock). */
  antiCheat: boolean;
}

export const FULL_ACCESS: Entitlements = {
  ai: true,
  multiplayer: true,
  rewards: true,
  leaderboard: true,
  mathTools: true,
  games: true,
  antiCheat: true,
};
// Individual student with no (or a free) plan: solo only — no AI, no multiplayer,
// no rewards, no leaderboard, no advanced math tools.
export const FREE_TIER: Entitlements = {
  ai: false,
  multiplayer: false,
  rewards: false,
  leaderboard: false,
  mathTools: false,
  games: false,
  antiCheat: false,
};

const LIVE_STATUSES = ["TRIAL", "ACTIVE", "PAST_DUE"] as const;

interface UserLike {
  id: string;
  role: string;
  schoolId: string | null;
  /** Account creation — the trial clock. Looked up when absent. */
  createdAt?: Date;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * When a self-registered student's sign-up trial ends, or null when there is
 * no trial (setting off). Anchored on account creation, so each account gets
 * exactly one trial and every sign-up path (email, Google, Telegram) is covered.
 */
export function trialEndsAt(createdAt: Date, trialDays: number | null): Date | null {
  if (!trialDays || trialDays <= 0) return null;
  return new Date(createdAt.getTime() + trialDays * DAY_MS);
}

/**
 * The sign-up trial for an independent student while pricing is on; null for
 * everyone else (school students, staff, pricing off, trial setting off).
 */
export async function getStudentTrial(
  user: UserLike | null | undefined,
): Promise<{ endsAt: Date; active: boolean } | null> {
  if (!user || user.role !== "STUDENT" || user.schoolId) return null;
  const settings = await getPlatformSettings();
  if (!settings.pricingEnabled || !settings.studentTrialDays) return null;
  let createdAt = user.createdAt;
  if (!createdAt) {
    const row = await db.user.findUnique({ where: { id: user.id }, select: { createdAt: true } });
    if (!row) return null;
    createdAt = row.createdAt;
  }
  const endsAt = trialEndsAt(createdAt, settings.studentTrialDays);
  if (!endsAt) return null;
  return { endsAt, active: endsAt.getTime() > Date.now() };
}

/**
 * Resolve the entitlements for a user. Reads their current subscription only
 * for individual students (the only ones whose access is plan-gated).
 */
export async function getEntitlements(user: UserLike | null | undefined): Promise<Entitlements> {
  const settings = await getPlatformSettings();
  // Global platform switches override individual plans:
  // - If AI is off platform-wide, nobody gets AI.
  // - If Rewards is off platform-wide, nobody gets rewards.
  // - Anti-cheat is active only when BOTH rewards and anti-cheat tracking are enabled.
  const gate = (e: Entitlements): Entitlements => ({
    ...e,
    ai: e.ai && settings.aiEnabled,
    rewards: e.rewards && settings.rewardsEnabled,
    antiCheat: settings.rewardsEnabled && settings.antiCheatEnabled,
  });

  if (!user) return gate(FREE_TIER);

  // Admins and other non-student roles are unrestricted (AI still master-gated).
  if (user.role !== "STUDENT") return gate(FULL_ACCESS);

  // Students who belong to a school always have full access (managed by school).
  if (user.schoolId) return gate(FULL_ACCESS);

  // Pricing turned OFF platform-wide → launch free: every individual student
  // gets the full (non-AI) feature set, no plan required.
  if (!settings.pricingEnabled) return gate(FULL_ACCESS);

  // Sign-up free trial: full access until it ends, then back to the plan below.
  const trial = await getStudentTrial(user);
  if (trial?.active) return gate(FULL_ACCESS);

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
          allowMathTools: true,
          allowGames: true,
        },
      },
    },
  });

  if (!sub?.plan) return gate(FREE_TIER);
  return gate({
    ai: sub.plan.allowAi,
    multiplayer: sub.plan.allowMultiplayer,
    rewards: sub.plan.allowRewards,
    leaderboard: sub.plan.allowLeaderboard,
    mathTools: sub.plan.allowMathTools,
    games: sub.plan.allowGames,
    antiCheat: true,
  });
}

// Human-readable messages returned by the API when a capability is locked.
export const UPGRADE_MESSAGES = {
  ai: "AI features aren't included in your current plan. Upgrade to a full-access plan to use the AI tutor and AI-generated quizzes.",
  multiplayer: "Battle mode isn't included in your current plan. Upgrade to a full-access plan to play against others.",
  rewards: "Rewards aren't included in your current plan. Upgrade to a full-access plan to earn and redeem rewards.",
  leaderboard: "The leaderboard isn't included in your current plan. Upgrade to a full-access plan to see rankings.",
  mathTools: "The graphing calculator and 3D geometry lab aren't included in your current plan. Upgrade to a full-access plan to use them.",
  games: "This game isn't included in your current plan. Upgrade to a full-access plan to play every game.",
} as const;

export type EntitlementKey = keyof Entitlements;
