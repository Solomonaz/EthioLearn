import { NextResponse } from "next/server";
import crypto from "crypto";
import { db } from "@/lib/db";
import { requireCompleteProfile } from "@/lib/get-session";
import { revokeAllUserSessions } from "@/lib/session-store";
import { validateCsrfOrigin } from "@/lib/csrf";

function validateTelegramAuth(data: Record<string, string>): boolean {
  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  if (!botToken) return false;

  const { hash, ...fields } = data;
  if (!hash) return false;

  const dataCheckString = Object.keys(fields)
    .filter((k) => fields[k] !== undefined && fields[k] !== "")
    .sort()
    .map((k) => `${k}=${fields[k]}`)
    .join("\n");

  const secretKey = crypto.createHash("sha256").update(botToken).digest();
  const computedHash = crypto
    .createHmac("sha256", secretKey)
    .update(dataCheckString)
    .digest("hex");

  return computedHash === hash;
}

// ── POST /api/students/me/link-telegram ──────────────────────────────────────
// Links a Telegram account to the current user after HMAC validation.

export async function POST(req: Request) {
  const user = await requireCompleteProfile();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  if (!validateCsrfOrigin(req)) {
    return NextResponse.json({ error: "Invalid request origin" }, { status: 403 });
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { telegramData } = body as { telegramData?: string };
  if (!telegramData) {
    return NextResponse.json({ error: "Missing telegramData" }, { status: 400 });
  }

  let data: Record<string, string>;
  try {
    data = JSON.parse(telegramData);
  } catch {
    return NextResponse.json({ error: "Invalid telegramData" }, { status: 400 });
  }

  if (!validateTelegramAuth(data)) {
    return NextResponse.json({ error: "Invalid Telegram signature" }, { status: 400 });
  }

  // Reject stale auth (older than 1 hour)
  const authDate = parseInt(data.auth_date ?? "0");
  if (Date.now() / 1000 - authDate > 3600) {
    return NextResponse.json({ error: "Telegram auth expired, please try again" }, { status: 400 });
  }

  const telegramId = String(data.id);

  // Prevent linking a Telegram account already used by someone else
  const conflict = await db.user.findFirst({
    where: { telegramId, id: { not: user.id } } as any,
  });
  if (conflict) {
    return NextResponse.json(
      { error: "This Telegram account is already linked to another user" },
      { status: 409 },
    );
  }

  await db.user.update({
    where: { id: user.id },
    data: { telegramId } as any,
  });

  const displayName = data.username
    ? `@${data.username}`
    : [data.first_name, data.last_name].filter(Boolean).join(" ");

  return NextResponse.json({ success: true, displayName });
}

// ── DELETE /api/students/me/link-telegram ────────────────────────────────────
// Removes the Telegram link from the current user's account.
// If Telegram is the user's ONLY login method (no phone, no email), all sessions
// are revoked and the response signals the client to sign out immediately.

export async function DELETE(req: Request) {
  const user = await requireCompleteProfile();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  if (!validateCsrfOrigin(req)) {
    return NextResponse.json({ error: "Invalid request origin" }, { status: 403 });
  }

  // Determine whether Telegram is the only way this user can log in.
  // Phone-registered users have a phoneNumber; Google/Facebook users have an email.
  // Telegram-only users have neither — removing telegramId leaves them with no auth method.
  const isTelegramOnly =
    !(user as any).phoneNumber &&
    !(user as any).email &&
    !!(user as any).telegramId;

  // Unlink Telegram
  await db.user.update({
    where: { id: user.id },
    data: { telegramId: null } as any,
  });

  if (isTelegramOnly) {
    // Revoke all active sessions so the JWT is rejected on the next request
    await revokeAllUserSessions(user.id);
    return NextResponse.json({ success: true, requireSignOut: true });
  }

  return NextResponse.json({ success: true, requireSignOut: false });
}
