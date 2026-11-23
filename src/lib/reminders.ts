import type { Prisma } from "@prisma/client";
import { db } from "./db";
import { siteUrl } from "./site";
import { sendPushToUser, pushConfigured } from "./push";
import { sendTelegramMessage, telegramConfigured } from "./telegram-bot";
import { settleBrokenStreaks, streakStateOf, viewStreak, type StreakView } from "./streak";
import { addisDayKey, addisHour, addisWeekday } from "./study-time";

/**
 * Study reminders — the loop that brings a student back after they leave.
 *
 *   Morning (07:00–10:00 Addis): today's Daily Challenge is ready, to anyone
 *     who has not studied yet today.
 *   Evening (19:00–21:00 Addis): "your streak ends at midnight", only to
 *     students with a live streak who have not studied today.
 *
 * Delivered by Telegram (students who signed in with or linked it) and web
 * push (devices that allowed notifications). Each delivered reminder the
 * student ignores counts as a miss; after MAX_MISSES in a row the reminders
 * pause with one last message saying so, and switch back on by themselves the
 * next time the student studies (lib/streak recordStudyActivity). Students in
 * grades 9–12 only — grades 1–8 use the /play games, which have no daily loop.
 */

export const MAX_MISSES = 7;
const MORNING = { from: 7, to: 10 };
const EVENING = { from: 19, to: 21 };
const TICK_MS = 10 * 60 * 1000;
const PAGE = 200;

export type ReminderKind = "morning" | "evening" | "paused";

export interface ReminderMessage {
  title: string;
  text: string;
  path: string;
}

function firstName(name: string): string {
  return (name || "").trim().split(/\s+/)[0] || "there";
}

/** The words of a reminder. Pure, so it is easy to test and to read. */
export function buildReminder(
  kind: ReminderKind,
  ctx: { name: string; grade: number | null; streak: StreakView; monday: boolean },
): ReminderMessage {
  const who = firstName(ctx.name);
  if (kind === "paused") {
    return {
      title: "Reminders paused",
      text: `Hi ${who}, it looks like these reminders aren't helping right now, so we've paused them. Open Abugida and study any time — they'll switch back on by themselves.`,
      path: "/student",
    };
  }
  if (kind === "evening") {
    const n = ctx.streak.days;
    const text =
      ctx.streak.freezes > 0
        ? `${who}, you haven't studied today. A streak freeze will cover it — but 5 minutes keeps your ${n}-day streak going without spending it.`
        : `${who}, your ${n}-day streak ends at midnight! One quick quiz keeps it alive.`;
    return { title: `🔥 ${n}-day streak at risk`, text, path: "/student" };
  }
  const parts: string[] = [`Good morning, ${who}!`];
  if (ctx.streak.atRisk && ctx.streak.days > 0) parts.push(`Keep your ${ctx.streak.days}-day streak going.`);
  if (ctx.monday) {
    parts.push(
      ctx.grade
        ? `New week: the Grade ${ctx.grade} leaderboard just reset — this is your chance to top it.`
        : "New week: the leaderboard just reset — this is your chance to top it.",
    );
  }
  parts.push("Today's Daily Challenge is ready: 5 quick questions.");
  return { title: "☀️ Today's Daily Challenge is ready", text: parts.join(" "), path: "/student" };
}

function linkFor(path: string, channel: "telegram" | "push", kind: ReminderKind): string {
  const q = new URLSearchParams({ utm_source: "reminder", utm_medium: channel, utm_campaign: kind });
  return `${siteUrl()}${path}?${q.toString()}`;
}

export function remindersSchedulerEnabled(): boolean {
  const flag = process.env.REMINDERS_ENABLED;
  if (flag === "true") return true;
  if (flag === "false") return false;
  // Production only by default: a dev database can hold real Telegram ids.
  return process.env.NODE_ENV === "production";
}

export interface PlannedReminder {
  userId: string;
  kind: ReminderKind;
  channels: string[];
  text: string;
}

export interface TickResult {
  window: "morning" | "evening" | null;
  settled: number;
  considered: number;
  sent: PlannedReminder[];
  telegramFailures: number;
  undelivered: number;
}

let lastSettledDay: string | null = null;
let ticking = false;

/**
 * One pass of the scheduler. Safe to call often: each student gets at most one
 * morning and one evening reminder per Addis day. `dryRun` decides and returns
 * what would be sent, without sending or writing anything.
 */
export async function runReminderTick(
  opts: { now?: Date; dryRun?: boolean; userIds?: string[] } = {},
): Promise<TickResult> {
  const now = opts.now ?? new Date();
  const today = addisDayKey(now);
  const hour = addisHour(now);
  const result: TickResult = { window: null, settled: 0, considered: 0, sent: [], telegramFailures: 0, undelivered: 0 };

  // Once per day: zero streaks that can no longer be saved.
  if (!opts.dryRun && lastSettledDay !== today) {
    result.settled = await settleBrokenStreaks(now);
    lastSettledDay = today;
  }

  const window =
    hour >= MORNING.from && hour < MORNING.to ? "morning" : hour >= EVENING.from && hour < EVENING.to ? "evening" : null;
  result.window = window;
  if (!window) return result;

  const tgOn = telegramConfigured();
  const pushOn = pushConfigured();
  if (!tgOn && !pushOn) return result;

  const channelFilter: Prisma.UserWhereInput[] = [];
  if (tgOn) channelFilter.push({ telegramId: { not: null }, telegramBlockedAt: null });
  if (pushOn) channelFilter.push({ pushSubscriptions: { some: {} } });

  const where: Prisma.UserWhereInput = {
    role: "STUDENT",
    isActive: true,
    suspendedAt: null,
    grade: { gte: 9, lte: 12 },
    remindersEnabled: true,
    remindersPausedAt: null,
    OR: channelFilter,
    AND: [
      { OR: [{ lastStudyDay: null }, { lastStudyDay: { not: today } }] },
      window === "morning"
        ? { OR: [{ lastMorningReminderDay: null }, { lastMorningReminderDay: { not: today } }] }
        : { OR: [{ lastEveningReminderDay: null }, { lastEveningReminderDay: { not: today } }] },
    ],
    ...(opts.userIds ? { id: { in: opts.userIds } } : {}),
  };

  const monday = addisWeekday(now) === 1;
  let telegramHalted = false;
  let cursor: string | undefined;

  for (;;) {
    // Keyset paging on id: updated rows leave the filter, so an offset/cursor
    // skip would jump over students.
    const users = await db.user.findMany({
      where: cursor ? { AND: [where, { id: { gt: cursor } }] } : where,
      select: {
        id: true,
        name: true,
        grade: true,
        telegramId: true,
        telegramBlockedAt: true,
        streakDays: true,
        lastStudyDay: true,
        streakFreezes: true,
        longestStreak: true,
        lastActiveAt: true,
        reminderMisses: true,
        _count: { select: { pushSubscriptions: true } },
      },
      orderBy: { id: "asc" },
      take: PAGE,
    });
    if (users.length === 0) break;
    cursor = users[users.length - 1].id;

    for (const u of users) {
      result.considered++;
      const streak = viewStreak(streakStateOf(u), today);
      if (window === "evening" && !(streak.atRisk && streak.days > 0)) continue;

      const kind: ReminderKind = u.reminderMisses >= MAX_MISSES ? "paused" : window;
      const msg = buildReminder(kind, { name: u.name, grade: u.grade, streak, monday });
      const canTelegram = tgOn && !telegramHalted && !!u.telegramId && !u.telegramBlockedAt;
      const canPush = pushOn && u._count.pushSubscriptions > 0;
      const channels = [canTelegram && "telegram", canPush && "push"].filter(Boolean) as string[];
      if (channels.length === 0) continue;

      if (opts.dryRun) {
        result.sent.push({ userId: u.id, kind, channels, text: msg.text });
        continue;
      }

      let delivered = false;
      const userUpdate: Prisma.UserUpdateInput = {};

      if (canTelegram) {
        const r = await sendTelegramMessage(u.telegramId!, msg.text, {
          label: kind === "paused" ? "Open Abugida" : "Start now",
          url: linkFor(msg.path, "telegram", kind),
        });
        if (r.ok) delivered = true;
        else {
          result.telegramFailures++;
          if ("unreachable" in r) userUpdate.telegramBlockedAt = now;
          else if ("retryAfterSec" in r) telegramHalted = true; // flood limit: rest of this tick goes by push only
          else console.error(`[reminders] Telegram send failed for ${u.id}: ${r.error}`);
        }
        await new Promise((res) => setTimeout(res, 40)); // stay well under Telegram's 30 msg/s
      }
      if (canPush) {
        const n = await sendPushToUser(u.id, {
          title: msg.title,
          body: msg.text,
          url: linkFor(msg.path, "push", kind),
          tag: `reminder-${kind}`,
        });
        if (n > 0) delivered = true;
      }

      // Mark the slot used even when nothing got through, so a broken channel
      // is not retried every ten minutes all morning.
      if (window === "morning") userUpdate.lastMorningReminderDay = today;
      else userUpdate.lastEveningReminderDay = today;
      if (delivered) {
        if (kind === "paused") userUpdate.remindersPausedAt = now;
        else userUpdate.reminderMisses = { increment: 1 };
        result.sent.push({ userId: u.id, kind, channels, text: msg.text });
      } else {
        result.undelivered++;
      }
      await db.user.update({ where: { id: u.id }, data: userUpdate });
    }
    if (users.length < PAGE) break;
  }

  return result;
}

/** Start the background scheduler (called once from server.ts). */
export function startReminderScheduler(): void {
  if (!remindersSchedulerEnabled()) {
    console.log("[reminders] Scheduler off (set REMINDERS_ENABLED=true to run it outside production).");
    return;
  }
  const tick = async () => {
    if (ticking) return;
    ticking = true;
    try {
      const r = await runReminderTick();
      if (r.settled || r.sent.length || r.telegramFailures || r.undelivered) {
        console.log(
          `[reminders] ${r.window ?? "no window"}: sent ${r.sent.length}, settled ${r.settled} streak(s), ` +
            `${r.telegramFailures} Telegram failure(s), ${r.undelivered} undelivered.`,
        );
      }
    } catch (err) {
      console.error("[reminders] Tick failed:", err);
    } finally {
      ticking = false;
    }
  };
  setTimeout(tick, 90_000);
  setInterval(tick, TICK_MS);
  console.log("[reminders] Scheduler on.");
}
