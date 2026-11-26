import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getCurrentUser } from "@/lib/get-session";
import { createNotification } from "@/lib/notifications";
import { validateCsrfOrigin } from "@/lib/csrf";
import { featureDenial } from "@/lib/entitlements";

export async function POST(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!validateCsrfOrigin(request)) {
    return NextResponse.json({ error: "Invalid request origin" }, { status: 403 });
  }

  const { getPlatformSettings } = await import("@/lib/platform-settings");
  const settings = await getPlatformSettings();
  if (!settings.rewardsEnabled) {
    return NextResponse.json(
      { error: "The rewards system is currently disabled on the platform.", code: "REWARDS_DISABLED" },
      { status: 403 }
    );
  }

  const denied = await featureDenial(user, "rewards");
  if (denied) return denied;

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

  // Only a reward of the student's own school (another school's is "not found").
  if (!reward || !user.schoolId || reward.schoolId !== user.schoolId) {
    return NextResponse.json({ error: "Reward not found" }, { status: 404 });
  }

  // Redemption window: a SEMESTER reward is open only between its dates, and
  // maxRedemptionsPerWindow caps how often one student redeems it per window
  // (month, quarter, semester, or ever for ANYTIME). Denied ones don't count.
  const now = new Date();
  let windowStart: Date | null = null;
  if (reward.redemptionWindow === "SEMESTER") {
    if ((reward.windowStartDate && now < reward.windowStartDate) || (reward.windowEndDate && now > reward.windowEndDate)) {
      return NextResponse.json({ error: "This reward can't be redeemed right now." }, { status: 400 });
    }
    windowStart = reward.windowStartDate;
  } else if (reward.redemptionWindow === "MONTHLY") {
    windowStart = new Date(now.getFullYear(), now.getMonth(), 1);
  } else if (reward.redemptionWindow === "QUARTERLY") {
    windowStart = new Date(now.getFullYear(), Math.floor(now.getMonth() / 3) * 3, 1);
  }
  if (reward.maxRedemptionsPerWindow != null && reward.maxRedemptionsPerWindow > 0) {
    const usedInWindow = await db.redemption.count({
      where: {
        studentId: user.id,
        rewardId: reward.id,
        status: { not: "DENIED" },
        ...(windowStart ? { createdAt: { gte: windowStart } } : {}),
      },
    });
    if (usedInWindow >= reward.maxRedemptionsPerWindow) {
      return NextResponse.json(
        { error: `You can redeem this reward ${reward.maxRedemptionsPerWindow} time${reward.maxRedemptionsPerWindow === 1 ? "" : "s"} per ${reward.redemptionWindow === "ANYTIME" ? "student" : reward.redemptionWindow.toLowerCase().replace("ly", "")}.` },
        { status: 400 },
      );
    }
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
  // The balance and stock are re-checked INSIDE the transaction with
  // conditional updates, so two quick requests can't push either below zero.
  const OUT_OF_STOCK = "OUT_OF_STOCK";
  const NOT_ENOUGH = "NOT_ENOUGH_POINTS";
  let updatedUser: { redeemablePoints: number };
  let redemption: { id: string; rewardId: string; status: string; createdAt: Date };
  try {
    ({ updatedUser, redemption } = await db.$transaction(async (tx) => {
      const paid = await tx.user.updateMany({
        where: { id: user.id, redeemablePoints: { gte: reward.pointsCost } },
        data: { redeemablePoints: { decrement: reward.pointsCost } },
      });
      if (paid.count === 0) throw new Error(NOT_ENOUGH);
      const taken = await tx.reward.updateMany({
        where: { id: rewardId, inventoryCount: { gt: 0 } },
        data: { inventoryCount: { decrement: 1 } },
      });
      if (taken.count === 0) throw new Error(OUT_OF_STOCK);
      const created = await tx.redemption.create({
        data: { studentId: user.id, rewardId, status: "PENDING" },
        select: { id: true, rewardId: true, status: true, createdAt: true },
      });
      await tx.pointLedger.create({
        data: {
          userId: user.id,
          actionType: "REWARD_REDEMPTION",
          points: -reward.pointsCost,
          description: `Redeemed reward: ${reward.name}`,
          quizId: null,
        },
      });
      const balance = await tx.user.findUniqueOrThrow({ where: { id: user.id }, select: { redeemablePoints: true } });
      return { updatedUser: balance, redemption: created };
    }));
  } catch (err) {
    if (err instanceof Error && err.message === OUT_OF_STOCK) {
      return NextResponse.json({ error: "This reward is currently out of stock" }, { status: 400 });
    }
    if (err instanceof Error && err.message === NOT_ENOUGH) {
      return NextResponse.json({ error: "Insufficient points", required: reward.pointsCost }, { status: 400 });
    }
    throw err;
  }

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
