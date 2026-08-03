import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getCurrentUser } from "@/lib/get-session";
import { validateCsrfOrigin } from "@/lib/csrf";
import { parsePlanInput } from "@/lib/pricing";

interface RouteParams {
  params: Promise<{ id: string }>;
}

// ─── GET: single plan ──
export async function GET(_req: NextRequest, { params }: RouteParams) {
  const user = await getCurrentUser();
  if (!user || !["SUPER_ADMIN", "SCHOOL_ADMIN"].includes(user.role)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  }

  const { id } = await params;
  const plan = await db.pricingPlan.findUnique({
    where: { id },
    include: {
      tiers: { orderBy: { minStudents: "asc" } },
      _count: { select: { subscriptions: true } },
    },
  });

  if (!plan) return NextResponse.json({ error: "Plan not found" }, { status: 404 });
  return NextResponse.json({ plan });
}

// ─── PATCH: update a plan (super-admin only) ──
export async function PATCH(req: NextRequest, { params }: RouteParams) {
  const user = await getCurrentUser();
  if (!user || user.role !== "SUPER_ADMIN") {
    return NextResponse.json(
      { error: "Only a super admin can update pricing plans" },
      { status: 403 }
    );
  }
  if (!validateCsrfOrigin(req)) {
    return NextResponse.json({ error: "Invalid request origin" }, { status: 403 });
  }

  const { id } = await params;
  const existing = await db.pricingPlan.findUnique({ where: { id } });
  if (!existing) return NextResponse.json({ error: "Plan not found" }, { status: 404 });

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  // The audience of an existing plan can't change (subscriptions depend on it).
  const parsed = parsePlanInput({ ...body, audience: existing.audience });
  if ("error" in parsed) {
    return NextResponse.json({ error: parsed.error }, { status: 400 });
  }
  const { data, tiers } = parsed;

  // Replace tiers wholesale for TIERED plans; clear them otherwise.
  const plan = await db.$transaction(async (tx) => {
    await tx.pricingTier.deleteMany({ where: { planId: id } });
    return tx.pricingPlan.update({
      where: { id },
      data: {
        ...data,
        tiers: tiers && tiers.length > 0 ? { create: tiers } : undefined,
      },
      include: { tiers: { orderBy: { minStudents: "asc" } } },
    });
  });

  return NextResponse.json({ plan });
}

// ─── DELETE: remove a plan (super-admin only) ──
export async function DELETE(req: NextRequest, { params }: RouteParams) {
  const user = await getCurrentUser();
  if (!user || user.role !== "SUPER_ADMIN") {
    return NextResponse.json(
      { error: "Only a super admin can delete pricing plans" },
      { status: 403 }
    );
  }
  if (!validateCsrfOrigin(req)) {
    return NextResponse.json({ error: "Invalid request origin" }, { status: 403 });
  }

  const { id } = await params;

  const subCount = await db.subscription.count({ where: { planId: id } });
  if (subCount > 0) {
    return NextResponse.json(
      {
        error:
          `This plan has ${subCount} subscription${subCount === 1 ? "" : "s"} attached. ` +
          "Deactivate it instead of deleting so existing assignments keep their history.",
      },
      { status: 409 }
    );
  }

  // Tiers cascade-delete with the plan.
  await db.pricingPlan.delete({ where: { id } });
  return NextResponse.json({ success: true });
}
