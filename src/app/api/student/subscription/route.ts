import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getCurrentUser } from "@/lib/get-session";
import { validateCsrfOrigin } from "@/lib/csrf";

// Statuses that count as a live/current subscription.
const LIVE_STATUSES = ["TRIAL", "ACTIVE", "PAST_DUE"] as const;

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

  const current =
    subscriptions.find((s) => (LIVE_STATUSES as readonly string[]).includes(s.status)) ??
    subscriptions[0] ??
    null;

  return NextResponse.json({ eligible: true, subscription: current, plans });
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

  const subscription = await db.$transaction(async (tx) => {
    // End any current live subscription before starting the new one.
    await tx.subscription.updateMany({
      where: { studentId: user.id, status: { in: [...LIVE_STATUSES] } },
      data: { status: "EXPIRED", endDate: new Date() },
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
      include: { plan: { include: { tiers: { orderBy: { minStudents: "asc" } } } } },
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
    where: { studentId: user.id, status: { in: [...LIVE_STATUSES] } },
    orderBy: { createdAt: "desc" },
  });

  if (!current) {
    return NextResponse.json({ error: "No active subscription to cancel" }, { status: 404 });
  }

  await db.subscription.update({
    where: { id: current.id },
    data: { status: "CANCELED", endDate: new Date() },
  });

  return NextResponse.json({ success: true });
}
