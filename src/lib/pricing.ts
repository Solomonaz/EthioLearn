/**
 * Pricing computation helpers — the single source of truth for turning a plan
 * (+ a school's student count) into a concrete price. Pure functions with no
 * server dependencies, so the same logic runs on the admin UI for live previews
 * and on the API when a subscription is actually created.
 */

export type PlanAudience = "SCHOOL" | "STUDENT";
export type PricingModel = "FLAT" | "PER_STUDENT" | "TIERED" | "PER_TEACHER";
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
  /** School plans: added to the term price for every teacher. Null = teachers not charged. */
  pricePerTeacher?: number | null;
}

/** How the teachers of a school were priced. */
export interface TeacherCharge {
  /** Active teachers at the school (of the school's own level). */
  count: number;
  /** The plan's price per teacher. */
  rate: number;
  /** count × rate. */
  amount: number;
}

export interface PriceResult {
  /** Computed price. Null only when the plan is unpriceable (e.g. no tiers at all). */
  amount: number | null;
  /** The tier that was applied (TIERED plans only). */
  tier: TierLike | null;
  /**
   * The teacher part of `amount` (school plans with a per-teacher price only).
   * `amount` already includes it.
   */
  teachers?: TeacherCharge;
  /**
   * Human-readable note when the price needed explaining — either it could not
   * be determined, or no bracket contained the student count and the nearest
   * one was applied instead.
   */
  note?: string;
}

/**
 * Compute the price for a plan. `studentCount` is only used by the
 * student-based school models (PER_STUDENT, TIERED) and ignored for FLAT
 * student plans. `teacherCount` adds the plan's per-teacher price for each
 * teacher (see `teacherCharge`). PER_TEACHER plans — how elementary schools,
 * which have no students, are priced — charge `price` per teacher and nothing
 * else.
 */
export function computePlanPrice(
  plan: PlanLike,
  studentCount = 0,
  teacherCount = 0,
): PriceResult {
  if (plan.pricingModel === "PER_TEACHER") {
    const count = Math.max(0, Math.floor(teacherCount || 0));
    const rate = Math.max(0, plan.price ?? 0);
    const teachers = { count, rate, amount: count * rate };
    return { amount: teachers.amount, tier: null, teachers };
  }

  const base = studentPrice(plan, studentCount);
  if (base.amount === null || plan.pricingModel === "FLAT") return base;

  const teachers = teacherCharge(plan, teacherCount);
  if (!teachers) return base;
  return { ...base, amount: base.amount + teachers.amount, teachers };
}

/**
 * The teacher part of a school price: every teacher × the plan's per-teacher
 * price. Null when the plan sets no per-teacher price (teachers not charged —
 * how plans behaved before teachers were priced).
 */
export function teacherCharge(plan: PlanLike, teacherCount: number): TeacherCharge | null {
  if (plan.pricePerTeacher === null || plan.pricePerTeacher === undefined) return null;
  const count = Math.max(0, Math.floor(teacherCount || 0));
  const rate = Math.max(0, plan.pricePerTeacher);
  return { count, rate, amount: count * rate };
}

/** The price before teachers: the plan's own model applied to the student count. */
function studentPrice(plan: PlanLike, studentCount: number): PriceResult {
  const count = Math.max(0, Math.floor(studentCount || 0));

  switch (plan.pricingModel) {
    case "FLAT":
      return { amount: plan.price ?? 0, tier: null };

    case "PER_STUDENT":
      return { amount: (plan.price ?? 0) * count, tier: null };

    case "TIERED": {
      const tiers = plan.tiers ?? [];
      if (tiers.length === 0) {
        return { amount: null, tier: null, note: "This plan has no pricing brackets." };
      }

      const exact = matchTier(tiers, count);
      if (exact) return { amount: exact.price, tier: exact };

      // No bracket contains `count`. Pricing at nothing is never the right
      // answer — a subscription with a null amount reads as "—/month" and
      // silently bills zero — so fall back to the nearest bracket: the highest
      // one the count reaches, or the lowest when it reaches none (e.g. a
      // school with 0 students on a plan whose first bracket starts at 1).
      // `validateTiers` keeps new plans gap-free, so this only rescues plans
      // authored before that rule.
      const sorted = [...tiers].sort((a, b) => a.minStudents - b.minStudents);
      const nearest = [...sorted].reverse().find((t) => count >= t.minStudents) ?? sorted[0];
      const students = `${count} student${count === 1 ? "" : "s"}`;

      return {
        amount: nearest.price,
        tier: nearest,
        note: `No bracket covers ${students} — priced at the ${describeTier(nearest)} bracket.`,
      };
    }

    default:
      return { amount: null, tier: null, note: "Unknown pricing model." };
  }
}

/** Describe a bracket's range the way the UI writes it, e.g. "1–100" or "101+". */
export function describeTier(t: TierLike): string {
  return t.maxStudents === null || t.maxStudents === undefined
    ? `${t.minStudents}+`
    : `${t.minStudents}–${t.maxStudents}`;
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
 * have min ≤ max, each carry a non-negative price, and together cover every
 * student count without overlaps or gaps — only the highest bracket may be
 * open-ended, and it must be, so no school size is left unpriced.
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

  // Scan in min order to check the brackets form one continuous range.
  const sorted = [...tiers].sort((a, b) => a.minStudents - b.minStudents);

  // Only the last bracket may be open-ended; a blank max anywhere else would
  // swallow every bracket above it.
  for (let i = 0; i < sorted.length - 1; i++) {
    if (sorted[i].maxStudents === null || sorted[i].maxStudents === undefined) {
      return "Only the highest bracket may leave its maximum blank.";
    }
  }

  for (let i = 1; i < sorted.length; i++) {
    const prevMax = sorted[i - 1].maxStudents as number;
    const curMin = sorted[i].minStudents;
    if (curMin <= prevMax) {
      return "Pricing tiers overlap. Each student-count range must be distinct.";
    }
    if (curMin > prevMax + 1) {
      return `Pricing tiers leave a gap — nothing covers ${prevMax + 1}–${curMin - 1} students.`;
    }
  }

  // The top bracket must be open-ended, otherwise a school that grows past it
  // has no price at all.
  const top = sorted[sorted.length - 1];
  if (top.maxStudents !== null && top.maxStudents !== undefined) {
    return "The highest bracket must leave its maximum blank, so schools of any size are covered.";
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

// ─── Student multi-cycle pricing ───────────────────────────────
// A student plan is priced monthly; students may pay for a longer cycle at a
// configured discount. These are the cycles offered in the student billing UI.
export const STUDENT_BILLING_INTERVALS = ["MONTHLY", "QUARTERLY", "YEARLY"] as const;
export type StudentBillingInterval = (typeof STUDENT_BILLING_INTERVALS)[number];

export interface IntervalPrice {
  interval: BillingInterval;
  months: number;
  /** Straight monthly × months, before any discount. */
  undiscounted: number;
  /** Discount percent applied for this cycle (0 for monthly). */
  discountPct: number;
  /** Amount actually charged for the whole cycle. */
  total: number;
  /** Money saved versus paying monthly across the same span. */
  savings: number;
}

/** Clamp a percentage to a whole number in [0, 100]. */
export function clampPercent(v: unknown): number {
  const n = Math.round(Number(v));
  if (!Number.isFinite(n)) return 0;
  return Math.min(100, Math.max(0, n));
}

/**
 * Price a STUDENT plan for a chosen billing cycle. `monthlyPrice` is the plan's
 * base (monthly) price; quarterly and yearly apply their configured % discount
 * off the straight multiple. Monthly is always full price.
 */
export function studentIntervalPrice(
  monthlyPrice: number | null | undefined,
  interval: BillingInterval,
  quarterlyDiscountPct = 0,
  yearlyDiscountPct = 0,
): IntervalPrice {
  const months = INTERVAL_MONTHS[interval] ?? 1;
  const base = Math.max(0, monthlyPrice ?? 0) * months;
  const pct =
    interval === "QUARTERLY"
      ? clampPercent(quarterlyDiscountPct)
      : interval === "YEARLY"
        ? clampPercent(yearlyDiscountPct)
        : 0;
  const total = Math.round(base * (1 - pct / 100));
  return { interval, months, undiscounted: base, discountPct: pct, total, savings: base - total };
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
export const PRICING_MODELS = ["FLAT", "PER_STUDENT", "TIERED", "PER_TEACHER"] as const;
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
  quarterlyDiscountPct: number;
  yearlyDiscountPct: number;
  pricePerTeacher: number | null;
  teacherAiMonthlyLimit: number | null;
}

/**
 * Validate and normalise a plan-creation/update payload. Enforces the
 * audience→model rules (student = FLAT, school = PER_STUDENT | TIERED |
 * PER_TEACHER) and
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
  } else if (!["PER_STUDENT", "TIERED", "PER_TEACHER"].includes(pricingModel)) {
    return { error: "School plans must use PER_STUDENT, TIERED or PER_TEACHER pricing" };
  }

  // Student plans are priced MONTHLY at the base — longer cycles are derived from
  // the discounts below, so the base interval is always monthly for them.
  const billingInterval: BillingInterval =
    audience === "STUDENT"
      ? "MONTHLY"
      : BILLING_INTERVALS.includes(body.billingInterval as BillingInterval)
        ? (body.billingInterval as BillingInterval)
        : "MONTHLY";

  // Multi-cycle discounts (student plans only; harmless 0 for school plans).
  const quarterlyDiscountPct = clampPercent(body.quarterlyDiscountPct);
  const yearlyDiscountPct = clampPercent(body.yearlyDiscountPct);

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

  // Secondary teachers — school plans only. A blank price means teachers are
  // not charged.
  let pricePerTeacher: number | null = null;
  let teacherAiMonthlyLimit: number | null = null;
  if (audience === "SCHOOL") {
    // A PER_TEACHER plan's `price` already IS the per-teacher rate; a second
    // per-teacher charge on top would bill every teacher twice.
    if (pricingModel !== "PER_TEACHER" && !isBlank(body.pricePerTeacher)) {
      const rate = Number(body.pricePerTeacher);
      if (!Number.isFinite(rate) || rate < 0) {
        return { error: "The price per teacher must be 0 or more" };
      }
      pricePerTeacher = rate;
    }
    if (!isBlank(body.teacherAiMonthlyLimit)) {
      const limit = Number(body.teacherAiMonthlyLimit);
      if (!Number.isInteger(limit) || limit < 0) {
        return { error: "The monthly AI credits per teacher must be a whole number (0 or more)" };
      }
      teacherAiMonthlyLimit = limit;
    }
  }

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
    // FLAT, PER_STUDENT or PER_TEACHER — a single price value is required.
    const p = Number(body.price);
    if (!Number.isFinite(p) || p < 0) {
      return {
        error:
          pricingModel === "PER_STUDENT"
            ? "A price per student (0 or more) is required"
            : pricingModel === "PER_TEACHER"
              ? "A price per teacher (0 or more) is required"
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
      quarterlyDiscountPct,
      yearlyDiscountPct,
      pricePerTeacher,
      teacherAiMonthlyLimit,
    },
    tiers,
  };
}

/** An optional numeric form field left empty (null, undefined or ""). */
function isBlank(v: unknown): boolean {
  return v === null || v === undefined || (typeof v === "string" && v.trim() === "");
}
