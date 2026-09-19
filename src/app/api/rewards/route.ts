import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getCurrentUser } from "@/lib/get-session";
import { getEntitlements, UPGRADE_MESSAGES } from "@/lib/entitlements";

export async function GET() {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { getPlatformSettings } = await import("@/lib/platform-settings");
  const settings = await getPlatformSettings();
  if (!settings.rewardsEnabled) {
    return NextResponse.json({
      rewards: [],
      userPoints: 0,
      redemptions: [],
      disabled: true,
      message: "The rewards system is currently disabled on the platform.",
    });
  }

  const ent = await getEntitlements(user);
  if (!ent.rewards) {
    return NextResponse.json(
      { error: UPGRADE_MESSAGES.rewards, code: "UPGRADE_REQUIRED" },
      { status: 403 }
    );
  }

  // Get all rewards for the user's school, ordered by pointsCost ASC
  // If user has no school, return all rewards (fallback for dev/testing)
  const rewardsWhere = user.schoolId ? { schoolId: user.schoolId } : {};

  const rewards = await db.reward.findMany({
    where: rewardsWhere,
    orderBy: { pointsCost: "asc" },
    select: {
      id: true,
      name: true,
      description: true,
      pointsCost: true,
      tier: true,
      imageUrl: true,
      inventoryCount: true,
      createdAt: true,
    },
  });

  // Get this user's existing redemptions
  const redemptions = await db.redemption.findMany({
    where: { studentId: user.id },
    select: {
      id: true,
      rewardId: true,
      status: true,
      createdAt: true,
    },
    orderBy: { createdAt: "desc" },
  });

  return NextResponse.json({
    rewards,
    // Spendable balance = redeemablePoints (earned only from quality quizzes).
    // totalPoints is the leaderboard score and is shown separately for context.
    userPoints: user.redeemablePoints,
    totalPoints: user.totalPoints,
    qualityThreshold: 60,
    redemptions,
  });
}
