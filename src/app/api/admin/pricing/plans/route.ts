import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getCurrentUser } from "@/lib/get-session";
import { validateCsrfOrigin } from "@/lib/csrf";
import { parsePlanInput, PLAN_AUDIENCES, type PlanAudience } from "@/lib/pricing";

// ─── GET: list plans (super-admin + school-admin can read) ──
export async function GET(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user || !["SUPER_ADMIN", "SCHOOL_ADMIN"].includes(user.role)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  }

  const { searchParams } = new URL(req.url);
  const audience = searchParams.get("audience");
  const activeOnly = searchParams.get("active") === "1";

  const plans = await db.pricingPlan.findMany({
    where: {
      ...(audience && PLAN_AUDIENCES.includes(audience as PlanAudience)
        ? { audience: audience as PlanAudience }
        : {}),
      ...(activeOnly ? { isActive: true } : {}),
    },
    include: {
      tiers: { orderBy: { minStudents: "asc" } },
      _count: { select: { subscriptions: true } },
    },
    orderBy: [{ audience: "asc" }, { sortOrder: "asc" }, { createdAt: "asc" }],
  });

  return NextResponse.json({ plans });
}

// ─── POST: create a plan (super-admin only) ──
export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user || user.role !== "SUPER_ADMIN") {
    return NextResponse.json(
      { error: "Only a super admin can create pricing plans" },
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

  const parsed = parsePlanInput(body);
  if ("error" in parsed) {
    return NextResponse.json({ error: parsed.error }, { status: 400 });
  }
  const { data, tiers } = parsed;

  const plan = await db.pricingPlan.create({
    data: {
      ...data,
      tiers: tiers ? { create: tiers } : undefined,
    },
    include: { tiers: { orderBy: { minStudents: "asc" } } },
  });

  return NextResponse.json({ plan }, { status: 201 });
}
