import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getCurrentUser } from "@/lib/get-session";
import { createNotification } from "@/lib/notifications";
import { validateCsrfOrigin } from "@/lib/csrf";
import { getEntitlements, UPGRADE_MESSAGES } from "@/lib/entitlements";

export async function POST(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!validateCsrfOrigin(request)) {
    return NextResponse.json({ error: "Invalid request origin" }, { status: 403 });
  }

  const ent = await getEntitlements(user);
  if (!ent.rewards) {
    return NextResponse.json(
      { error: UPGRADE_MESSAGES.rewards, code: "UPGRADE_REQUIRED" },
      { status: 403 }
    );
  }

  let body: { rewardId?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const { rewardId } = body;
  if (!rewardId || typeof rewardId !== "string") {
    return NextResponse.json({ error: "rewardId is required" }, { status: 400 });
  }

  // Fetch the reward
  const reward = await db.reward.findUnique({
    where: { id: rewardId },
  });

  if (!reward) {
    return NextResponse.json({ error: "Reward not found" }, { status: 404 });
  }

  // Check inventory (inventoryCount <= 0 means out of stock)
  if (reward.inventoryCount <= 0) {
    return NextResponse.json(
      { error: "This reward is currently out of stock" },
      { status: 400 }
    );
  }

  // Check user has enough *redeemable* points (re-fetch to get latest value).
  // Rewards are bought with redeemablePoints — the prize-eligible balance earned
  // only from quality quizzes — not the raw leaderboard total.
  const freshUser = await db.user.findUnique({
    where: { id: user.id },
    select: { redeemablePoints: true },
  });

  if (!freshUser) {
    return NextResponse.json({ error: "User not found" }, { status: 404 });
  }

  if (freshUser.redeemablePoints < reward.pointsCost) {
    return NextResponse.json(
      {
        error: "Insufficient points",
        required: reward.pointsCost,
        available: freshUser.redeemablePoints,
      },
      { status: 400 }
    );
  }

  // Check for existing pending or approved redemption (prevent duplicates)
  const existingRedemption = await db.redemption.findFirst({
    where: {
      studentId: user.id,
      rewardId,
      status: { in: ["PENDING", "APPROVED"] },
    },
  });

  if (existingRedemption) {
    return NextResponse.json(
      { error: "You already have an active redemption for this reward" },
      { status: 409 }
    );
  }

  // Perform atomically: deduct redeemable points, decrement inventory, create
  // redemption, log ledger. totalPoints (leaderboard/XP) is intentionally left
  // untouched so spending prizes never lowers a student's rank or level.
  const [updatedUser, , redemption] = await db.$transaction([
    db.user.update({
      where: { id: user.id },
      data: { redeemablePoints: { decrement: reward.pointsCost } },
      select: { redeemablePoints: true },
    }),
    db.reward.update({
      where: { id: rewardId },
      data: { inventoryCount: { decrement: 1 } },
    }),
    db.redemption.create({
      data: {
        studentId: user.id,
        rewardId,
        status: "PENDING",
      },
      select: {
        id: true,
        rewardId: true,
        status: true,
        createdAt: true,
      },
    }),
    db.pointLedger.create({
      data: {
        userId: user.id,
        actionType: "REWARD_REDEMPTION",
        points: -reward.pointsCost,
        description: `Redeemed reward: ${reward.name}`,
        quizId: null,
      },
    }),
  ]);

  // Notify school admins about pending redemption (fire-and-forget)
  if (reward.schoolId) {
    db.user
      .findMany({
        where: { schoolId: reward.schoolId, role: { in: ["SCHOOL_ADMIN", "SUPER_ADMIN"] } },
        select: { id: true },
      })
      .then((admins) =>
        Promise.allSettled(
          admins.map((a) =>
            createNotification(
              a.id,
              "redemption_pending",
              "New Reward Redemption",
              `${user.name ?? "A student"} redeemed "${reward.name}" (${reward.pointsCost} pts).`,
              { redemptionId: redemption.id, studentId: user.id }
            )
          )
        )
      )
      .catch(console.error);
  }

  return NextResponse.json({
    success: true,
    redemption,
    newPoints: updatedUser.redeemablePoints,
  });
}
