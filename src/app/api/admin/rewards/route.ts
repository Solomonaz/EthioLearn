import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getCurrentUser } from "@/lib/get-session";
import { RewardTier } from "@prisma/client";

export async function GET() {
  const user = await getCurrentUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!["SUPER_ADMIN", "SCHOOL_ADMIN"].includes(user.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  if (!user.schoolId) {
    return NextResponse.json({ error: "No school associated with this account" }, { status: 400 });
  }

  const rewards = await db.reward.findMany({
    where: { schoolId: user.schoolId },
    orderBy: [{ tier: "asc" }, { pointsCost: "asc" }],
    include: {
      _count: {
        select: { redemptions: true },
      },
    },
  });

  return NextResponse.json({ rewards });
}

interface CreateRewardBody {
  name?: string;
  description?: string;
  tier?: string;
  pointsCost?: number;
  inventoryCount?: number;
  imageUrl?: string;
  redemptionWindow?: string;
  windowStartDate?: string;
  windowEndDate?: string;
  maxRedemptionsPerWindow?: number;
  unitCost?: number;
}

export async function POST(request: NextRequest) {
  const user = await getCurrentUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!["SUPER_ADMIN", "SCHOOL_ADMIN"].includes(user.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  if (!user.schoolId) {
    return NextResponse.json({ error: "No school associated with this account" }, { status: 400 });
  }

  let body: CreateRewardBody;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const {
    name,
    description,
    tier,
    pointsCost,
    inventoryCount,
    imageUrl,
    redemptionWindow,
    windowStartDate,
    windowEndDate,
    maxRedemptionsPerWindow,
    unitCost,
  } = body;

  if (!name || typeof name !== "string" || name.trim() === "") {
    return NextResponse.json({ error: "Name is required" }, { status: 400 });
  }

  if (!description || typeof description !== "string" || description.trim() === "") {
    return NextResponse.json({ error: "Description is required" }, { status: 400 });
  }

  const validTiers: RewardTier[] = ["BRONZE", "SILVER", "GOLD", "PLATINUM"];
  if (!tier || !validTiers.includes(tier as RewardTier)) {
    return NextResponse.json({ error: "Valid tier is required (BRONZE, SILVER, GOLD, PLATINUM)" }, { status: 400 });
  }

  if (pointsCost === undefined || pointsCost === null || typeof pointsCost !== "number" || pointsCost < 0) {
    return NextResponse.json({ error: "Valid pointsCost is required" }, { status: 400 });
  }

  const validWindows = ["ANYTIME", "MONTHLY", "QUARTERLY", "SEMESTER"];
  if (redemptionWindow && !validWindows.includes(redemptionWindow)) {
    return NextResponse.json(
      { error: "Invalid redemptionWindow. Must be ANYTIME, MONTHLY, QUARTERLY, or SEMESTER" },
      { status: 400 }
    );
  }

  if (maxRedemptionsPerWindow !== undefined && (typeof maxRedemptionsPerWindow !== "number" || maxRedemptionsPerWindow < 1)) {
    return NextResponse.json({ error: "maxRedemptionsPerWindow must be a positive integer" }, { status: 400 });
  }

  if (unitCost !== undefined && (typeof unitCost !== "number" || unitCost < 0)) {
    return NextResponse.json({ error: "unitCost must be a non-negative number" }, { status: 400 });
  }

  const reward = await db.reward.create({
    data: {
      name: name.trim(),
      description: description.trim(),
      tier: tier as RewardTier,
      pointsCost,
      inventoryCount: inventoryCount ?? 10,
      imageUrl: imageUrl?.trim() || null,
      schoolId: user.schoolId,
      redemptionWindow: (redemptionWindow as any) ?? "ANYTIME",
      windowStartDate: windowStartDate ? new Date(windowStartDate) : null,
      windowEndDate: windowEndDate ? new Date(windowEndDate) : null,
      maxRedemptionsPerWindow: maxRedemptionsPerWindow ?? null,
      unitCost: unitCost ?? null,
    },
  });

  return NextResponse.json({ reward }, { status: 201 });
}
