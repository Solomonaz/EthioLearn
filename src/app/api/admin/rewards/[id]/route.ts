import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getCurrentUser } from "@/lib/get-session";
import { RewardTier } from "@prisma/client";

interface RouteParams {
  params: Promise<{ id: string }>;
}

interface UpdateRewardBody {
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

export async function PATCH(request: NextRequest, { params }: RouteParams) {
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

  const { id } = await params;

  const existing = await db.reward.findUnique({ where: { id } });

  if (!existing) {
    return NextResponse.json({ error: "Reward not found" }, { status: 404 });
  }

  if (existing.schoolId !== user.schoolId) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  let body: UpdateRewardBody;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const validTiers: RewardTier[] = ["BRONZE", "SILVER", "GOLD", "PLATINUM"];

  const updateData: {
    name?: string;
    description?: string;
    tier?: RewardTier;
    pointsCost?: number;
    inventoryCount?: number;
    imageUrl?: string | null;
    redemptionWindow?: any;
    windowStartDate?: Date | null;
    windowEndDate?: Date | null;
    maxRedemptionsPerWindow?: number | null;
    unitCost?: number | null;
  } = {};

  if (body.name !== undefined) {
    if (typeof body.name !== "string" || body.name.trim() === "") {
      return NextResponse.json({ error: "Name cannot be empty" }, { status: 400 });
    }
    updateData.name = body.name.trim();
  }

  if (body.description !== undefined) {
    if (typeof body.description !== "string" || body.description.trim() === "") {
      return NextResponse.json({ error: "Description cannot be empty" }, { status: 400 });
    }
    updateData.description = body.description.trim();
  }

  if (body.tier !== undefined) {
    if (!validTiers.includes(body.tier as RewardTier)) {
      return NextResponse.json({ error: "Invalid tier value" }, { status: 400 });
    }
    updateData.tier = body.tier as RewardTier;
  }

  if (body.pointsCost !== undefined) {
    if (typeof body.pointsCost !== "number" || body.pointsCost < 0) {
      return NextResponse.json({ error: "pointsCost must be a non-negative number" }, { status: 400 });
    }
    updateData.pointsCost = body.pointsCost;
  }

  if (body.inventoryCount !== undefined) {
    if (typeof body.inventoryCount !== "number" || body.inventoryCount < 0) {
      return NextResponse.json({ error: "inventoryCount must be a non-negative number" }, { status: 400 });
    }
    updateData.inventoryCount = body.inventoryCount;
  }

  if (body.imageUrl !== undefined) {
    updateData.imageUrl = body.imageUrl?.trim() || null;
  }

  if (body.redemptionWindow !== undefined) {
    const validWindows = ["ANYTIME", "MONTHLY", "QUARTERLY", "SEMESTER"];
    if (!validWindows.includes(body.redemptionWindow)) {
      return NextResponse.json(
        { error: "Invalid redemptionWindow. Must be ANYTIME, MONTHLY, QUARTERLY, or SEMESTER" },
        { status: 400 }
      );
    }
    updateData.redemptionWindow = body.redemptionWindow;
  }

  if (body.windowStartDate !== undefined) {
    updateData.windowStartDate = body.windowStartDate ? new Date(body.windowStartDate) : null;
  }

  if (body.windowEndDate !== undefined) {
    updateData.windowEndDate = body.windowEndDate ? new Date(body.windowEndDate) : null;
  }

  if (body.maxRedemptionsPerWindow !== undefined) {
    if (body.maxRedemptionsPerWindow !== null && (typeof body.maxRedemptionsPerWindow !== "number" || body.maxRedemptionsPerWindow < 1)) {
      return NextResponse.json({ error: "maxRedemptionsPerWindow must be a positive integer" }, { status: 400 });
    }
    updateData.maxRedemptionsPerWindow = body.maxRedemptionsPerWindow ?? null;
  }

  if (body.unitCost !== undefined) {
    if (body.unitCost !== null && (typeof body.unitCost !== "number" || body.unitCost < 0)) {
      return NextResponse.json({ error: "unitCost must be a non-negative number" }, { status: 400 });
    }
    updateData.unitCost = body.unitCost ?? null;
  }

  const reward = await db.reward.update({
    where: { id },
    data: updateData,
  });

  return NextResponse.json({ reward });
}

export async function DELETE(_request: NextRequest, { params }: RouteParams) {
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

  const { id } = await params;

  const existing = await db.reward.findUnique({
    where: { id },
    include: {
      _count: {
        select: {
          redemptions: {
            where: { status: { in: ["PENDING", "APPROVED"] } },
          },
        },
      },
    },
  });

  if (!existing) {
    return NextResponse.json({ error: "Reward not found" }, { status: 404 });
  }

  if (existing.schoolId !== user.schoolId) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  if (existing._count.redemptions > 0) {
    return NextResponse.json(
      {
        error: "Cannot delete reward with pending or approved redemptions. Resolve them first.",
      },
      { status: 409 }
    );
  }

  await db.reward.delete({ where: { id } });

  return NextResponse.json({ success: true });
}
