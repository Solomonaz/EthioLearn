/**
 * Plan-based entitlements — resolves which features (src/lib/features.ts) a
 * user may use.
 *
 * Rules, in order:
 *   • Pricing switched off platform-wide → every feature.
 *   • Super admins → every feature.
 *   • Independent students:
 *       - within the sign-up free trial → every feature;
 *       - a live subscription → that plan's features;
 *       - otherwise the free tier: the active free (price 0) student plan's
 *         features, or the old free defaults when there is none / it was never
 *         saved with per-feature access.
 *   • Anyone at a school (students, teachers, school admins) → the school's
 *     live plan's features. A school with no live plan keeps every feature, as
 *     before (teachers' AI is still stopped by lib/teacher-ai-allowance).
 *
 * On top of every plan, the platform switches (Admin → Settings) turn a
 * feature off for everyone. Solo quizzes and the free games are never gated.
 */

import { cache } from "react";
import type { NextResponse } from "next/server";
import { db } from "./db";
import { getPlatformSettings, effectiveAiFlags, type PlatformSettings } from "./platform-settings";
import {
  FEATURES,
  FEATURE_BY_KEY,
  LEGACY_FREE_TIER,
  allFeatures,
  planFeatureMap,
  type FeatureDef,
  type FeatureKey,
  type FeatureMap,
} from "./features";

export interface Entitlements {
  /** What the user may use now: plan access AND the platform switches. */
  features: FeatureMap;
  /** Plan access alone (before the platform switches). */
  planFeatures: FeatureMap;
  /** Platform switches alone — false = turned off for everyone. */
  available: FeatureMap;
  /** Anti-cheat tracking (tab-switch detection, clipboard lock). */
  antiCheat: boolean;
  /** Whiteboard lessons per day from the plan; undefined = the platform default. */
  whiteboardDailyLimit: number | null | undefined;
  /** Where access comes from. */
  source: "full" | "trial" | "plan" | "free" | "school";
  /** Name of the plan that decided it, when one did. */
  planName: string | null;
}

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

/** Platform switches per feature (Admin → Settings). */
export function platformAvailability(settings: PlatformSettings): FeatureMap {
  const ai = effectiveAiFlags(settings);
  const out = {} as FeatureMap;
  for (const f of FEATURES as readonly FeatureDef[]) {
    const key = f.key as FeatureKey;
    if (!f.platform) out[key] = true;
    else if (f.platform === "rewards") out[key] = settings.rewardsEnabled;
    else out[key] = ai[f.platform];
  }
  return out;
}

const PLAN_SELECT = {
  name: true,
  audience: true,
  featureAccess: true,
  whiteboardDailyLimit: true,
  allowAi: true,
  allowMultiplayer: true,
  allowRewards: true,
  allowLeaderboard: true,
  allowMathTools: true,
  allowGames: true,
} as const;

const liveWhere = () => ({
  status: { in: [...LIVE_STATUSES] },
  OR: [{ endDate: null }, { endDate: { gt: new Date() } }],
});

/**
 * The free tier's plan: the active student plan priced 0 (lowest sort order
 * first). Students without a paid plan get its features. Null when there is none.
 */
export const getFreePlan = cache(async () =>
  db.pricingPlan.findFirst({
    where: { audience: "STUDENT", isActive: true, OR: [{ price: 0 }, { price: null }] },
    orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
    select: { id: true, ...PLAN_SELECT },
  }),
);

/** The id of the free-tier plan (for the admin editor), or null. */
export async function getFreePlanId(): Promise<string | null> {
  return (await getFreePlan())?.id ?? null;
}

async function resolve(user: UserLike | null | undefined): Promise<Omit<Entitlements, "features" | "available" | "antiCheat">> {
  const full = { planFeatures: allFeatures(true), whiteboardDailyLimit: undefined, source: "full" as const, planName: null };
  const settings = await getPlatformSettings();
  if (!user) return { ...full, planFeatures: { ...LEGACY_FREE_TIER }, source: "free" };
  if (!settings.pricingEnabled || user.role === "SUPER_ADMIN") return full;

  if (user.schoolId) {
    const sub = await db.subscription.findFirst({
      where: { schoolId: user.schoolId, ...liveWhere() },
      orderBy: { createdAt: "desc" },
      select: { plan: { select: PLAN_SELECT } },
    });
    if (!sub?.plan) return full;
    return {
      planFeatures: planFeatureMap(sub.plan),
      whiteboardDailyLimit: sub.plan.whiteboardDailyLimit ?? undefined,
      source: "school",
      planName: sub.plan.name,
    };
  }

  if (user.role !== "STUDENT") return full;

  const trial = await getStudentTrial(user);
  if (trial?.active) return { ...full, source: "trial" };

  // A sub counts as live only while its status is live AND it hasn't passed
  // its endDate (the paid-through date for a canceled-at-period-end sub).
  const sub = await db.subscription.findFirst({
    where: { studentId: user.id, ...liveWhere() },
    orderBy: { createdAt: "desc" },
    select: { plan: { select: PLAN_SELECT } },
  });
  if (sub?.plan) {
    return {
      planFeatures: planFeatureMap(sub.plan),
      whiteboardDailyLimit: sub.plan.whiteboardDailyLimit ?? undefined,
      source: "plan",
      planName: sub.plan.name,
    };
  }

  const free = await getFreePlan();
  if (!free) return { ...full, planFeatures: { ...LEGACY_FREE_TIER }, source: "free" };
  return {
    planFeatures: planFeatureMap(free, LEGACY_FREE_TIER),
    whiteboardDailyLimit: free.whiteboardDailyLimit ?? undefined,
    source: "free",
    planName: free.name,
  };
}

// One resolution per user per request (several gates often run in one route).
const resolveCached = cache((id: string, role: string, schoolId: string | null, createdAt: number | undefined) =>
  resolve({ id, role, schoolId, createdAt: createdAt === undefined ? undefined : new Date(createdAt) }),
);

/** Resolve the entitlements for a user (null = signed out → free defaults). */
export async function getEntitlements(user: UserLike | null | undefined): Promise<Entitlements> {
  const settings = await getPlatformSettings();
  const base = user
    ? await resolveCached(user.id, user.role, user.schoolId, user.createdAt?.getTime())
    : await resolve(null);
  const available = platformAvailability(settings);
  const features = {} as FeatureMap;
  for (const k of Object.keys(available) as FeatureKey[]) features[k] = base.planFeatures[k] && available[k];
  return {
    ...base,
    features,
    available,
    antiCheat: settings.rewardsEnabled && settings.antiCheatEnabled,
  };
}

/** The message for a feature the user's plan doesn't include. */
export function upgradeMessage(key: FeatureKey, viaSchool: boolean): string {
  const label = FEATURE_BY_KEY[key].label;
  return viaSchool
    ? `${label} isn't included in your school's plan. Ask your school's Abugida administrator.`
    : `${label} isn't included in your current plan. Upgrade to use it.`;
}

/**
 * The server gate for a feature: null when the user may use it, else the
 * refusal — 503 AI_DISABLED / FEATURE_DISABLED when an admin switched it off
 * platform-wide, 403 UPGRADE_REQUIRED when their plan doesn't include it.
 */
export async function featureDenial(
  user: UserLike | null | undefined,
  key: FeatureKey,
): Promise<NextResponse | null> {
  const ent = await getEntitlements(user);
  if (ent.features[key]) return null;
  // Loaded here, not at the top: the custom server (server.ts) and the
  // reminder scheduler import this file before Next is up, and a top-level
  // next/server import crashes them (AsyncLocalStorage invariant).
  const { NextResponse } = await import("next/server");
  const def = FEATURE_BY_KEY[key];
  if (!ent.planFeatures[key]) {
    return NextResponse.json(
      { error: upgradeMessage(key, ent.source === "school"), code: "UPGRADE_REQUIRED", feature: key },
      { status: 403 },
    );
  }
  return NextResponse.json(
    {
      error: `${def.label} is currently turned off.`,
      code: def.ai ? "AI_DISABLED" : "FEATURE_DISABLED",
      feature: key,
    },
    { status: 503 },
  );
}

export type { FeatureKey, FeatureMap } from "./features";
