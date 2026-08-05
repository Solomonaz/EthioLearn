import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getCurrentUser } from "@/lib/get-session";
import { validateCsrfOrigin } from "@/lib/csrf";
import { computeCurrentPeriodEnd, intervalRecurs } from "@/lib/pricing";

// Statuses that count as a live/current subscription.
const LIVE_STATUSES = ["TRIAL", "ACTIVE", "PAST_DUE"] as const;

// A subscription is only "live" while its status is live AND it hasn't passed
// its endDate (the paid-through date for a canceled-at-period-end sub, or a
// trial's end). Free/indefinite subs have endDate === null.
function isLive(s: { status: string; endDate: Date | string | null }): boolean {
  if (!(LIVE_STATUSES as readonly string[]).includes(s.status)) return false;
  return !s.endDate || new Date(s.endDate) > new Date();
}

// A student may self-manage a plan ONLY when they don't belong to a school —
// school-registered students have their plan managed by the school.
function isIndependentStudent(user: { role: string; schoolId: string | null }) {
  return user.role === "STUDENT" && !user.schoolId;
}

// ─── GET: eligibility + current plan + available student plans ──
export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  if (!isIndependentStudent(user)) {
    // Not eligible (school-managed student, or non-student) — no billing UI.
    return NextResponse.json({ eligible: false });
  }

  // Lazily flip any live sub whose paid period has ended to EXPIRED, so the
  // current plan reflects reality without needing a background job.
  await db.subscription.updateMany({
    where: {
      studentId: user.id,
      status: { in: [...LIVE_STATUSES] },
      endDate: { lte: new Date() },
    },
    data: { status: "EXPIRED", cancelAtPeriodEnd: false },
  });

  const [subscriptions, plans] = await Promise.all([
    db.subscription.findMany({
      where: { studentId: user.id },
      include: { plan: { include: { tiers: { orderBy: { minStudents: "asc" } } } } },
      orderBy: { createdAt: "desc" },
    }),
    db.pricingPlan.findMany({
      where: { audience: "STUDENT", isActive: true },
      include: { tiers: { orderBy: { minStudents: "asc" } } },
      orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
    }),
  ]);

  const liveSub = subscriptions.find(isLive);
  const current = liveSub ?? null;

  // The default (free) plan — what every student is on until they upgrade.
  // Prefer a plan that matches the free-tier entitlements (no AI, no multiplayer);
  // fall back to the cheapest active plan.
  const defaultPlan =
    plans.find((p) => !p.allowAi && !p.allowMultiplayer) ??
    [...plans].sort((a, b) => (a.price ?? 0) - (b.price ?? 0))[0] ??
    null;

  return NextResponse.json({
    eligible: true,
    subscription: current,
    plans,
    defaultPlanId: defaultPlan?.id ?? null,
    hasPaidSubscription: !!liveSub,
  });
}

// ─── POST: subscribe to / switch to a student plan ──
export async function POST(req: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!isIndependentStudent(user)) {
    return NextResponse.json(
      { error: "Your plan is managed by your school." },
      { status: 403 }
    );
  }
  if (!validateCsrfOrigin(req)) {
    return NextResponse.json({ error: "Invalid request origin" }, { status: 403 });
  }

  let body: { planId?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const planId = typeof body.planId === "string" ? body.planId : "";
  if (!planId) return NextResponse.json({ error: "planId is required" }, { status: 400 });

  const plan = await db.pricingPlan.findUnique({ where: { id: planId } });
  if (!plan || plan.audience !== "STUDENT" || !plan.isActive) {
    return NextResponse.json({ error: "That plan is not available" }, { status: 404 });
  }

  const startDate = new Date();
  let status: "ACTIVE" | "TRIAL" = "ACTIVE";
  let endDate: Date | null = null;
  if (plan.trialDays > 0) {
    status = "TRIAL";
    endDate = new Date(startDate.getTime() + plan.trialDays * 24 * 60 * 60 * 1000);
  }

  const planInclude = { plan: { include: { tiers: { orderBy: { minStudents: "asc" as const } } } } };

  const subscription = await db.$transaction(async (tx) => {
    // Re-selecting the plan you're already on clears any pending cancellation
    // (i.e. "Resume subscription") instead of starting a brand-new one.
    const currentLive = await tx.subscription.findFirst({
      where: {
        studentId: user.id,
        status: { in: [...LIVE_STATUSES] },
        OR: [{ endDate: null }, { endDate: { gt: new Date() } }],
      },
      orderBy: { createdAt: "desc" },
    });

    if (currentLive && currentLive.planId === plan.id) {
      return tx.subscription.update({
        where: { id: currentLive.id },
        data: { cancelAtPeriodEnd: false, status: "ACTIVE", endDate: null },
        include: planInclude,
      });
    }

    // Switching to a different plan → end current live subscriptions first.
    await tx.subscription.updateMany({
      where: { studentId: user.id, status: { in: [...LIVE_STATUSES] } },
      data: { status: "EXPIRED", endDate: new Date(), cancelAtPeriodEnd: false },
    });

    return tx.subscription.create({
      data: {
        planId: plan.id,
        studentId: user.id,
        status,
        startDate,
        endDate,
        amount: plan.price, // student plans are FLAT
        currency: plan.currency,
        createdById: user.id,
      },
      include: planInclude,
    });
  });

  return NextResponse.json({ subscription }, { status: 201 });
}

// ─── DELETE: cancel the current plan ──
export async function DELETE(req: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!isIndependentStudent(user)) {
    return NextResponse.json(
      { error: "Your plan is managed by your school." },
      { status: 403 }
    );
  }
  if (!validateCsrfOrigin(req)) {
    return NextResponse.json({ error: "Invalid request origin" }, { status: 403 });
  }

  const current = await db.subscription.findFirst({
    where: {
      studentId: user.id,
      status: { in: [...LIVE_STATUSES] },
      OR: [{ endDate: null }, { endDate: { gt: new Date() } }],
    },
    orderBy: { createdAt: "desc" },
    include: { plan: { select: { billingInterval: true, price: true } } },
  });

  if (!current) {
    return NextResponse.json({ error: "No active subscription to cancel" }, { status: 404 });
  }

  // Decide when the cancellation takes effect.
  // - Trial → keep access until the trial ends (its existing endDate).
  // - Paid recurring plan → keep access until the end of the current paid period.
  // - Free / one-time → nothing paid to preserve, so end immediately.
  const isPaid = (current.amount ?? current.plan.price ?? 0) > 0;
  let effectiveEnd: Date | null;
  if (current.status === "TRIAL") {
    effectiveEnd = current.endDate ?? new Date();
  } else if (isPaid && intervalRecurs(current.plan.billingInterval)) {
    effectiveEnd = computeCurrentPeriodEnd(current.startDate, current.plan.billingInterval);
  } else {
    effectiveEnd = null; // cancel immediately
  }

  if (effectiveEnd && effectiveEnd > new Date()) {
    // Cancel at period end — the subscription stays live (full access) until then.
    await db.subscription.update({
      where: { id: current.id },
      data: { cancelAtPeriodEnd: true, endDate: effectiveEnd },
    });
    return NextResponse.json({ success: true, cancelAtPeriodEnd: true, endsAt: effectiveEnd });
  }

  // Nothing paid to preserve → end now.
  await db.subscription.update({
    where: { id: current.id },
    data: { status: "CANCELED", endDate: new Date(), cancelAtPeriodEnd: false },
  });
  return NextResponse.json({ success: true, cancelAtPeriodEnd: false });
}
