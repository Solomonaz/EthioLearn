import webpush from "web-push";
import { db } from "./db";

/**
 * Web push for study reminders. Needs a VAPID key pair in the environment
 * (generate once with `npx web-push generate-vapid-keys`):
 *   VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT (mailto: or https: URL).
 * Without them push is simply off — the settings page hides the option.
 */

export function vapidPublicKey(): string | null {
  return process.env.VAPID_PUBLIC_KEY || null;
}

export function pushConfigured(): boolean {
  return !!(process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY);
}

let configured = false;
function ensureConfigured(): boolean {
  if (!pushConfigured()) return false;
  if (!configured) {
    webpush.setVapidDetails(
      process.env.VAPID_SUBJECT || "https://abugidatech.com",
      process.env.VAPID_PUBLIC_KEY!,
      process.env.VAPID_PRIVATE_KEY!,
    );
    configured = true;
  }
  return true;
}

export interface PushPayload {
  title: string;
  body: string;
  /** Opened when the notification is tapped. */
  url: string;
  /** Same tag replaces an older notification instead of stacking. */
  tag?: string;
}

/**
 * Send to every device the user subscribed. Expired subscriptions (404/410)
 * are deleted. Returns how many devices accepted it.
 */
export async function sendPushToUser(userId: string, payload: PushPayload): Promise<number> {
  if (!ensureConfigured()) return 0;
  const subs = await db.pushSubscription.findMany({ where: { userId } });
  // Defence in depth: never send to anything but a browser push service, even
  // if a row got in some other way (the subscribe route already checks this).
  const allowed = /^https:\/\/([a-z0-9-]+\.)*(fcm\.googleapis\.com|push\.services\.mozilla\.com|push\.apple\.com|notify\.windows\.com)\//i;
  let delivered = 0;
  for (const s of subs) {
    if (!allowed.test(s.endpoint)) {
      await db.pushSubscription.delete({ where: { id: s.id } }).catch(() => {});
      continue;
    }
    try {
      await webpush.sendNotification(
        { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
        JSON.stringify(payload),
        { TTL: 6 * 60 * 60, urgency: "normal", timeout: 15_000 },
      );
      delivered++;
      await db.pushSubscription.update({ where: { id: s.id }, data: { lastSuccessAt: new Date() } });
    } catch (err) {
      const status = (err as { statusCode?: number }).statusCode;
      if (status === 404 || status === 410) {
        await db.pushSubscription.delete({ where: { id: s.id } }).catch(() => {});
      } else {
        console.error(`[push] send failed (${status ?? "network"}):`, (err as Error).message);
      }
    }
  }
  return delivered;
}
