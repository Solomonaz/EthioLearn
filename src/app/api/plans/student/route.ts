import { NextResponse } from "next/server";
import { db } from "@/lib/db";

/**
 * Public list of active STUDENT plans — used by the registration flow so a new
 * independent student can pick a plan while signing up (before they have a
 * session). Only non-sensitive pricing fields are exposed.
 */
export async function GET() {
  const plans = await db.pricingPlan.findMany({
    where: { audience: "STUDENT", isActive: true },
    orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
    select: {
      id: true,
      name: true,
      description: true,
      price: true,
      currency: true,
      billingInterval: true,
      trialDays: true,
      features: true,
    },
  });

  return NextResponse.json({ plans });
}
