import { db } from "./db";
import { computeCurrentPeriodEnd, type BillingInterval } from "./pricing";

// Statuses that count as a live/current subscription.
const LIVE_STATUSES = ["TRIAL", "ACTIVE", "PAST_DUE"] as const;

interface ActivateArgs {
  studentId: string;
  planId: string;
  billingInterval: BillingInterval;
  /** The amount actually charged for the term (0 for the free plan). */
  amount: number;
  currency: string;
  /** Trial length in days; a trial ends when the trial does, not at the term end. */
  trialDays?: number;
  createdById?: string | null;
}

/**
 * Create a live subscription for a student, ending any current live one first.
 *
 * A paid plan is a FIXED TERM: it runs until the end of the chosen cycle, then
 * lapses (the student billing route expires it) and the student drops back to
 * Free. A free plan (amount 0) is indefinite; a trial ends when the trial does.
 *
 * This is the single place a paid subscription is created — used when an admin
 * approves a manual payment, and for the free/instant path.
 */
export async function activateSubscription(args: ActivateArgs) {
  const {
    studentId,
    planId,
    billingInterval,
    amount,
    currency,
    trialDays = 0,
    createdById = null,
  } = args;

  const startDate = new Date();
  let status: "ACTIVE" | "TRIAL" = "ACTIVE";
  let endDate: Date | null = null;
  if (trialDays > 0) {
    status = "TRIAL";
    endDate = new Date(startDate.getTime() + trialDays * 24 * 60 * 60 * 1000);
  } else if (amount > 0) {
    endDate = computeCurrentPeriodEnd(startDate, billingInterval);
  }

  const planInclude = { plan: { include: { tiers: { orderBy: { minStudents: "asc" as const } } } } };

  return db.$transaction(async (tx) => {
    await tx.subscription.updateMany({
      where: { studentId, status: { in: [...LIVE_STATUSES] } },
      data: { status: "EXPIRED", endDate: new Date(), cancelAtPeriodEnd: false },
    });

    return tx.subscription.create({
      data: {
        planId,
        studentId,
        status,
        startDate,
        endDate,
        billingInterval,
        amount,
        currency,
        createdById,
      },
      include: planInclude,
    });
  });
}
