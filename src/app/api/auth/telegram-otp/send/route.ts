import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getCurrentUser } from "@/lib/get-session";
import { createOTP } from "@/lib/otp-store";
import { rateLimit } from "@/lib/rate-limit";

export async function POST(req: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // Only for Telegram-registered users who haven't set a phone yet
  if ((user as any).phoneNumber) {
    return NextResponse.json({ error: "Profile already complete" }, { status: 400 });
  }

  const telegramId = (user as any).telegramId as string | null;
  if (!telegramId) {
    return NextResponse.json({ error: "No Telegram account linked" }, { status: 400 });
  }

  // Rate limit: 3 sends per user per 10 minutes
  const rl = rateLimit(`tg-otp:${user.id}`, 3, 10 * 60 * 1000);
  if (!rl.success) {
    return NextResponse.json(
      { error: `Too many attempts. Try again in ${rl.retryAfter}s.` },
      { status: 429 },
    );
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { phoneNumber } = body as { phoneNumber?: string };
  if (!phoneNumber || typeof phoneNumber !== "string") {
    return NextResponse.json({ error: "Phone number is required" }, { status: 400 });
  }

  // Enforce Ethiopian format: +251 followed by exactly 9 digits
  const phoneRegex = /^\+251[0-9]{9}$/;
  if (!phoneRegex.test(phoneNumber.replace(/\s/g, ""))) {
    return NextResponse.json(
      { error: "Phone number must be a valid Ethiopian number (e.g. +251912345678)" },
      { status: 400 },
    );
  }

  // Check uniqueness before sending OTP
  const conflict = await db.user.findFirst({
    where: { phoneNumber, id: { not: user.id } },
  });
  if (conflict) {
    return NextResponse.json(
      { error: "This phone number is already registered to another account" },
      { status: 409 },
    );
  }

  // Generate OTP (stored in DB, no SMS)
  const otp = await createOTP(phoneNumber);

  // Send OTP via Telegram Bot API
  const botToken = process.env.TELEGRAM_BOT_TOKEN!;
  const botUsername = process.env.NEXT_PUBLIC_TELEGRAM_BOT_USERNAME ?? "the bot";

  const tgRes = await fetch(
    `https://api.telegram.org/bot${botToken}/sendMessage`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: telegramId,
        text: `🔐 Your EthioLearn verification code is:\n\n*${otp}*\n\nValid for 10 minutes. Do not share this with anyone.`,
        parse_mode: "Markdown",
      }),
    },
  );

  if (!tgRes.ok) {
    const err = await tgRes.json().catch(() => ({}));

    // 403 = user hasn't started a chat with the bot
    if ((err as any).error_code === 403) {
      return NextResponse.json(
        {
          error: `Please open Telegram and send /start to @${botUsername} first, then try again.`,
          needsStart: true,
        },
        { status: 400 },
      );
    }

    console.error("[Telegram OTP] send failed:", err);
    return NextResponse.json(
      { error: "Failed to send OTP via Telegram. Please try again." },
      { status: 500 },
    );
  }

  // In dev, log OTP to console so developer can see it
  if (process.env.NODE_ENV !== "production") {
    console.log(`[DEV] Telegram OTP for ${phoneNumber}: ${otp}`);
  }

  return NextResponse.json({ success: true });
}
