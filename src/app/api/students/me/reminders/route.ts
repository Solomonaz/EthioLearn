import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getCurrentUser } from "@/lib/get-session";
import { featureDenial, getEntitlements } from "@/lib/entitlements";
import { validateCsrfOrigin } from "@/lib/csrf";
import { pushConfigured, vapidPublicKey } from "@/lib/push";
import { telegramConfigured } from "@/lib/telegram-bot";

/**
 * GET   /api/students/me/reminders — the student's study-reminder status.
 * PATCH /api/students/me/reminders — { enabled?: boolean, resume?: true }
 */

async function status(userId: string) {
  const u = await db.user.findUnique({
    where: { id: userId },
    select: {
      remindersEnabled: true,
      remindersPausedAt: true,
      telegramId: true,
      telegramBlockedAt: true,
      _count: { select: { pushSubscriptions: true } },
    },
  });
  if (!u) return null;
  return {
    enabled: u.remindersEnabled,
    paused: !!u.remindersPausedAt,
    telegram: {
      available: telegramConfigured(),
      linked: !!u.telegramId,
      reachable: !!u.telegramId && !u.telegramBlockedAt,
    },
    push: {
      available: pushConfigured(),
      vapidPublicKey: vapidPublicKey(),
      devices: u._count.pushSubscriptions,
    },
  };
}

export async function GET() {
  const user = await getCurrentUser();
  if (!user || user.role !== "STUDENT") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const s = await status(user.id);
  if (!s) return NextResponse.json({ error: "Not found" }, { status: 404 });
  // Reminders are a plan feature: the settings card shows it locked.
  const included = (await getEntitlements(user)).features.reminders;
  return NextResponse.json({ ...s, included });
}

export async function PATCH(req: Request) {
  const user = await getCurrentUser();
  if (!user || user.role !== "STUDENT") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!validateCsrfOrigin(req)) {
    return NextResponse.json({ error: "Invalid request origin" }, { status: 403 });
  }
  const body = (await req.json().catch(() => ({}))) as { enabled?: unknown; resume?: unknown };
  // Turning reminders off is always allowed; turning them on needs the feature.
  if (body.enabled === true || body.resume === true) {
    const denied = await featureDenial(user, "reminders");
    if (denied) return denied;
  }
  const data: { remindersEnabled?: boolean; remindersPausedAt?: null; reminderMisses?: number } = {};
  if (typeof body.enabled === "boolean") data.remindersEnabled = body.enabled;
  if (body.enabled === true || body.resume === true) {
    data.remindersPausedAt = null;
    data.reminderMisses = 0;
  }
  if (Object.keys(data).length === 0) {
    return NextResponse.json({ error: "Nothing to change" }, { status: 400 });
  }
  await db.user.update({ where: { id: user.id }, data });
  return NextResponse.json(await status(user.id));
}
