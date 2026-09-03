/**
 * Pricing computation helpers — the single source of truth for turning a plan
 * (+ a school's student count) into a concrete price. Pure functions with no
 * server dependencies, so the same logic runs on the admin UI for live previews
 * and on the API when a subscription is actually created.
 */

export type PlanAudience = "SCHOOL" | "STUDENT";
export type PricingModel = "FLAT" | "PER_STUDENT" | "TIERED";
export type BillingInterval =
  | "MONTHLY"
  | "QUARTERLY"
  | "SEMESTER"
  | "YEARLY"
  | "ONE_TIME";

export interface TierLike {
  minStudents: number;
  maxStudents: number | null;
  price: number;
}

export interface PlanLike {
  pricingModel: PricingModel;
  price?: number | null;
  tiers?: TierLike[];
}

export interface PriceResult {
  /** Computed price, or null when no tier matches the given student count. */
  amount: number | null;
  /** The tier that matched (TIERED plans only). */
  tier: TierLike | null;
  /** Human-readable note when a price could not be determined. */
  note?: string;
}

/**
 * Compute the price for a plan. `studentCount` is only used by school pricing
 * models (PER_STUDENT, TIERED) and ignored for FLAT student plans.
 */
export function computePlanPrice(plan: PlanLike, studentCount = 0): PriceResult {
  const count = Math.max(0, Math.floor(studentCount || 0));

  switch (plan.pricingModel) {
    case "FLAT":
      return { amount: plan.price ?? 0, tier: null };

    case "PER_STUDENT":
      return { amount: (plan.price ?? 0) * count, tier: null };

    case "TIERED": {
      const tier = matchTier(plan.tiers ?? [], count);
      if (!tier) {
        return {
          amount: null,
          tier: null,
          note: `No pricing tier covers ${count} student${count === 1 ? "" : "s"}.`,
        };
      }
      return { amount: tier.price, tier };
    }

    default:
      return { amount: null, tier: null, note: "Unknown pricing model." };
  }
}

/** Find the tier whose [minStudents, maxStudents] range contains `count`. */
export function matchTier(tiers: TierLike[], count: number): TierLike | null {
  return (
    tiers.find(
      (t) =>
        count >= t.minStudents &&
        (t.maxStudents === null || t.maxStudents === undefined || count <= t.maxStudents)
    ) ?? null
  );
}

/**
 * Validate a set of tiers for a TIERED plan. Returns an error string describing
 * the first problem found, or null when the tiers are well-formed. Tiers must
 * have min ≤ max, be non-overlapping, and each carry a non-negative price.
 */
export function validateTiers(tiers: TierLike[]): string | null {
  if (!Array.isArray(tiers) || tiers.length === 0) {
    return "At least one pricing tier is required.";
  }

  for (const t of tiers) {
    if (!Number.isFinite(t.minStudents) || t.minStudents < 0) {
      return "Each tier needs a valid minimum student count (0 or more).";
    }
    if (t.maxStudents !== null && t.maxStudents !== undefined) {
      if (!Number.isFinite(t.maxStudents) || t.maxStudents < t.minStudents) {
        return "Each tier's maximum must be a number greater than or equal to its minimum.";
      }
    }
    if (!Number.isFinite(t.price) || t.price < 0) {
      return "Each tier needs a valid price (0 or more).";
    }
  }

  // Check for overlaps by scanning in min order.
  const sorted = [...tiers].sort((a, b) => a.minStudents - b.minStudents);
  for (let i = 1; i < sorted.length; i++) {
    const prev = sorted[i - 1];
    const cur = sorted[i];
    const prevMax = prev.maxStudents ?? Infinity;
    if (cur.minStudents <= prevMax) {
      return "Pricing tiers overlap. Each student-count range must be distinct.";
    }
  }

  return null;
}

const INTERVAL_LABELS: Record<BillingInterval, string> = {
  MONTHLY: "/month",
  QUARTERLY: "/quarter",
  SEMESTER: "/semester",
  YEARLY: "/year",
  ONE_TIME: " one-time",
};

export function billingIntervalLabel(interval: BillingInterval): string {
  return INTERVAL_LABELS[interval] ?? "";
}

// Months per billing period (null = non-recurring, e.g. ONE_TIME).
const INTERVAL_MONTHS: Record<BillingInterval, number | null> = {
  MONTHLY: 1,
  QUARTERLY: 3,
  SEMESTER: 6,
  YEARLY: 12,
  ONE_TIME: null,
};

/** True when the interval recurs (so it has a "current period" to end). */
export function intervalRecurs(interval: BillingInterval): boolean {
  return INTERVAL_MONTHS[interval] != null;
}

/**
 * The end of the billing period that currently contains `now`, computed by
 * advancing from `startDate` one interval at a time until strictly after `now`.
 * Returns null for non-recurring intervals (ONE_TIME).
 *
 * Used for "cancel at period end": access continues until this date.
 */
export function computeCurrentPeriodEnd(
  startDate: Date | string,
  interval: BillingInterval,
  now: Date = new Date()
): Date | null {
  const months = INTERVAL_MONTHS[interval];
  if (months == null) return null;

  const d = new Date(startDate);
  // Guard against a bad/absent start date.
  if (isNaN(d.getTime())) return null;

  let guard = 0;
  while (d <= now && guard < 1200) {
    d.setMonth(d.getMonth() + months);
    guard++;
  }
  return d;
}

/** Format a money amount with its currency, e.g. formatMoney(5000, "ETB") → "5,000 ETB". */
export function formatMoney(amount: number | null | undefined, currency = "ETB"): string {
  if (amount === null || amount === undefined || !Number.isFinite(amount)) {
    return "—";
  }
  const rounded = Math.round(amount * 100) / 100;
  const formatted = rounded.toLocaleString("en-US", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  });
  return `${formatted} ${currency}`;
}

// ─── Plan input validation (shared by create + update routes) ──

export const PLAN_AUDIENCES = ["SCHOOL", "STUDENT"] as const;
export const PRICING_MODELS = ["FLAT", "PER_STUDENT", "TIERED"] as const;
export const BILLING_INTERVALS = ["MONTHLY", "QUARTERLY", "SEMESTER", "YEARLY", "ONE_TIME"] as const;

export interface PlanInputData {
  name: string;
  description: string | null;
  audience: PlanAudience;
  pricingModel: PricingModel;
  price: number | null;
  currency: string;
  billingInterval: BillingInterval;
  trialDays: number;
  features: string[];
  isActive: boolean;
  sortOrder: number;
  allowAi: boolean;
  allowMultiplayer: boolean;
  allowRewards: boolean;
  allowLeaderboard: boolean;
  allowMathTools: boolean;
}

/**
 * Validate and normalise a plan-creation/update payload. Enforces the
 * audience→model rules (student = FLAT, school = PER_STUDENT | TIERED) and
 * returns either `{ error }` or the clean `{ data, tiers }` ready for Prisma.
 */
export function parsePlanInput(
  body: Record<string, unknown>
): { data: PlanInputData; tiers: TierLike[] | null } | { error: string } {
  const name = typeof body.name === "string" ? body.name.trim() : "";
  if (!name) return { error: "Plan name is required" };

  const audience = String(body.audience);
  if (!PLAN_AUDIENCES.includes(audience as PlanAudience)) {
    return { error: "audience must be SCHOOL or STUDENT" };
  }

  let pricingModel = String(body.pricingModel) as PricingModel;

  // Enforce which models are valid for each audience.
  if (audience === "STUDENT") {
    pricingModel = "FLAT"; // Student plans are always a flat price.
  } else if (!["PER_STUDENT", "TIERED"].includes(pricingModel)) {
    return { error: "School plans must use PER_STUDENT or TIERED pricing" };
  }

  const billingInterval = BILLING_INTERVALS.includes(body.billingInterval as BillingInterval)
    ? (body.billingInterval as BillingInterval)
    : "MONTHLY";

  const currency =
    typeof body.currency === "string" && body.currency.trim() ? body.currency.trim() : "ETB";
  const trialDays = Number.isFinite(Number(body.trialDays))
    ? Math.max(0, Math.floor(Number(body.trialDays)))
    : 0;
  const sortOrder = Number.isFinite(Number(body.sortOrder)) ? Math.floor(Number(body.sortOrder)) : 0;
  const isActive = body.isActive === undefined ? true : Boolean(body.isActive);
  // Entitlements — default to full access (true) when unspecified.
  const allowAi = body.allowAi === undefined ? true : Boolean(body.allowAi);
  const allowMultiplayer = body.allowMultiplayer === undefined ? true : Boolean(body.allowMultiplayer);
  const allowRewards = body.allowRewards === undefined ? true : Boolean(body.allowRewards);
  const allowLeaderboard = body.allowLeaderboard === undefined ? true : Boolean(body.allowLeaderboard);
  const allowMathTools = body.allowMathTools === undefined ? true : Boolean(body.allowMathTools);
  const features = Array.isArray(body.features)
    ? body.features.map((f) => String(f).trim()).filter(Boolean)
    : [];

  let price: number | null = null;
  let tiers: TierLike[] | null = null;

  if (pricingModel === "TIERED") {
    const rawTiers = Array.isArray(body.tiers) ? body.tiers : [];
    tiers = rawTiers.map((t) => {
      const tier = t as Record<string, unknown>;
      const maxRaw = tier.maxStudents;
      return {
        minStudents: Math.floor(Number(tier.minStudents)),
        maxStudents:
          maxRaw === null || maxRaw === undefined || maxRaw === "" ? null : Math.floor(Number(maxRaw)),
        price: Number(tier.price),
      };
    });
    const tierError = validateTiers(tiers);
    if (tierError) return { error: tierError };
  } else {
    // FLAT or PER_STUDENT — a single price value is required.
    const p = Number(body.price);
    if (!Number.isFinite(p) || p < 0) {
      return {
        error:
          pricingModel === "PER_STUDENT"
            ? "A price per student (0 or more) is required"
            : "A price (0 or more) is required",
      };
    }
    price = p;
  }

  return {
    data: {
      name,
      description:
        typeof body.description === "string" && body.description.trim()
          ? body.description.trim()
          : null,
      audience: audience as PlanAudience,
      pricingModel,
      price,
      currency,
      billingInterval,
      trialDays,
      features,
      isActive,
      sortOrder,
      allowAi,
      allowMultiplayer,
      allowRewards,
      allowLeaderboard,
      allowMathTools,
    },
    tiers,
  };
}
