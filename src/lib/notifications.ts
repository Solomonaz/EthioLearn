import { db } from "./db";

export async function createNotification(
  userId: string,
  type: string,
  title: string,
  message: string,
  data?: Record<string, unknown>
) {
  return db.notification.create({
    data: { userId, type, title, message, data: data ? (data as any) : undefined },
  });
}

// Helper functions for common notification types
export async function notifyAchievement(
  userId: string,
  achievementName: string
) {
  return createNotification(
    userId,
    "achievement",
    "Achievement Unlocked!",
    `You earned the "${achievementName}" badge. Keep it up!`,
    { achievementName }
  );
}

export async function notifyLevelUp(userId: string, newLevel: number) {
  return createNotification(
    userId,
    "level_up",
    "Level Up!",
    `Congratulations! You've reached Level ${newLevel}.`,
    { level: newLevel }
  );
}

export async function notifyStreak(userId: string, days: number) {
  return createNotification(
    userId,
    "streak",
    `${days}-Day Streak!`,
    `You've been studying for ${days} days in a row. Amazing!`,
    { days }
  );
}

export async function notifyRewardApproved(
  userId: string,
  rewardName: string
) {
  return createNotification(
    userId,
    "reward",
    "Reward Approved!",
    `Your redemption for "${rewardName}" has been approved.`,
    { rewardName }
  );
}

export async function notifyBattleInvite(
  userId: string,
  roomCode: string,
  hostName: string
) {
  return createNotification(
    userId,
    "battle_invite",
    "Battle Invitation!",
    `${hostName} invited you to a quiz battle. Room code: ${roomCode}`,
    { roomCode }
  );
}
