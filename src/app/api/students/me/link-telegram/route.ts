import { NextResponse } from "next/server";
import crypto from "crypto";
import { db } from "@/lib/db";
import { getCurrentUser } from "@/lib/get-session";

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
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

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

export async function DELETE() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  await db.user.update({
    where: { id: user.id },
    data: { telegramId: null } as any,
  });

  return NextResponse.json({ success: true });
}
