import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getCurrentUser } from "@/lib/get-session";
import { validateCsrfOrigin } from "@/lib/csrf";
import { computePlanPrice } from "@/lib/pricing";

const STATUSES = ["TRIAL", "ACTIVE", "PAST_DUE", "CANCELED", "EXPIRED"] as const;
type SubStatus = (typeof STATUSES)[number];

// Statuses that count as a live/current subscription (only one allowed per target).
const LIVE_STATUSES: SubStatus[] = ["TRIAL", "ACTIVE", "PAST_DUE"];

// ─── GET: current subscription (+ history) for a school or student ──
export async function GET(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user || !["SUPER_ADMIN", "SCHOOL_ADMIN"].includes(user.role)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  }

  const { searchParams } = new URL(req.url);
  const schoolId = searchParams.get("schoolId");
  const studentId = searchParams.get("studentId");

  if (!schoolId && !studentId) {
    return NextResponse.json({ error: "schoolId or studentId is required" }, { status: 400 });
  }

  // A school admin may only view their own school's subscription.
  if (user.role === "SCHOOL_ADMIN") {
    if (studentId || !schoolId || schoolId !== user.schoolId) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
  }

  const where = schoolId ? { schoolId } : { studentId: studentId! };

  const subscriptions = await db.subscription.findMany({
    where,
    include: { plan: { include: { tiers: { orderBy: { minStudents: "asc" } } } } },
    orderBy: { createdAt: "desc" },
  });

  const current =
    subscriptions.find((s) => LIVE_STATUSES.includes(s.status as SubStatus)) ?? subscriptions[0] ?? null;

  // For schools, report the current enrolled-student count so the UI can preview
  // tiered / per-student pricing before assigning.
  let studentCount: number | undefined;
  if (schoolId) {
    studentCount = await db.user.count({ where: { schoolId, role: "STUDENT" } });
  }

  return NextResponse.json({ subscription: current, history: subscriptions, studentCount });
}

// ─── POST: assign a plan to a school or student (super-admin only) ──
export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user || user.role !== "SUPER_ADMIN") {
    return NextResponse.json(
      { error: "Only a super admin can assign plans" },
      { status: 403 }
    );
  }
  if (!validateCsrfOrigin(req)) {
    return NextResponse.json({ error: "Invalid request origin" }, { status: 403 });
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const planId = typeof body.planId === "string" ? body.planId : "";
  const schoolId = typeof body.schoolId === "string" && body.schoolId ? body.schoolId : null;
  const studentId = typeof body.studentId === "string" && body.studentId ? body.studentId : null;
  const status: SubStatus = STATUSES.includes(body.status as SubStatus)
    ? (body.status as SubStatus)
    : "ACTIVE";
  const notes = typeof body.notes === "string" && body.notes.trim() ? body.notes.trim() : null;

  if (!planId) return NextResponse.json({ error: "planId is required" }, { status: 400 });

  const plan = await db.pricingPlan.findUnique({
    where: { id: planId },
    include: { tiers: true },
  });
  if (!plan) return NextResponse.json({ error: "Plan not found" }, { status: 404 });

  // Target must match the plan's audience.
  if (plan.audience === "SCHOOL") {
    if (!schoolId) {
      return NextResponse.json({ error: "This is a school plan — schoolId is required" }, { status: 400 });
    }
    const school = await db.school.findUnique({ where: { id: schoolId }, select: { id: true } });
    if (!school) return NextResponse.json({ error: "School not found" }, { status: 404 });
  } else {
    if (!studentId) {
      return NextResponse.json({ error: "This is a student plan — studentId is required" }, { status: 400 });
    }
    const student = await db.user.findUnique({ where: { id: studentId }, select: { id: true, role: true } });
    if (!student) return NextResponse.json({ error: "Student not found" }, { status: 404 });
  }

  // Dates
  const startDate = body.startDate ? new Date(String(body.startDate)) : new Date();
  if (isNaN(startDate.getTime())) {
    return NextResponse.json({ error: "Invalid startDate" }, { status: 400 });
  }
  let endDate: Date | null = null;
  if (body.endDate) {
    endDate = new Date(String(body.endDate));
    if (isNaN(endDate.getTime())) {
      return NextResponse.json({ error: "Invalid endDate" }, { status: 400 });
    }
    if (endDate <= startDate) {
      return NextResponse.json({ error: "endDate must be after startDate" }, { status: 400 });
    }
  }

  // Compute the price snapshot.
  let studentCountSnapshot: number | null = null;
  if (plan.audience === "SCHOOL") {
    studentCountSnapshot = await db.user.count({ where: { schoolId: schoolId!, role: "STUDENT" } });
  }
  const priced = computePlanPrice(
    { pricingModel: plan.pricingModel, price: plan.price, tiers: plan.tiers },
    studentCountSnapshot ?? 0
  );

  // Record who created it — but only when the acting user is a real persisted
  // row. The super-admin shortcut session isn't backed by a users record, so
  // blindly setting createdById would violate the foreign key.
  const creatorExists = await db.user.findUnique({
    where: { id: user.id },
    select: { id: true },
  });
  const createdById = creatorExists ? user.id : null;

  // Replace any existing live subscription for this target, then create the new one.
  const targetWhere = plan.audience === "SCHOOL" ? { schoolId } : { studentId };

  const subscription = await db.$transaction(async (tx) => {
    await tx.subscription.updateMany({
      where: { ...targetWhere, status: { in: LIVE_STATUSES } },
      data: { status: "EXPIRED", endDate: new Date() },
    });

    return tx.subscription.create({
      data: {
        planId,
        schoolId: plan.audience === "SCHOOL" ? schoolId : null,
        studentId: plan.audience === "STUDENT" ? studentId : null,
        status,
        startDate,
        endDate,
        amount: priced.amount,
        currency: plan.currency,
        studentCountSnapshot,
        notes,
        createdById,
      },
      include: { plan: { include: { tiers: { orderBy: { minStudents: "asc" } } } } },
    });
  });

  return NextResponse.json({ subscription }, { status: 201 });
}
