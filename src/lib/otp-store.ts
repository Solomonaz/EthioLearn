import { db } from "./db";
import { Resend } from "resend";

function generateOTP(): string {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

async function sendSMS(phone: string, message: string): Promise<void> {
  const apiKey = process.env.AFRICASTALKING_API_KEY;
  const username = process.env.AFRICASTALKING_USERNAME;

  if (!apiKey || !username || process.env.NODE_ENV !== "production") {
    console.log(`[DEV OTP] ${phone} → ${message}`);
    return;
  }

  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const AfricasTalking = require("africastalking");
  const at = AfricasTalking({ apiKey, username });
  await at.SMS.send({
    to: [phone],
    message,
    from: process.env.AFRICASTALKING_SENDER_ID || "EthioLearn",
  });
}

async function sendEmail(to: string, otp: string): Promise<void> {
  const apiKey = process.env.RESEND_API_KEY;

  if (!apiKey || process.env.NODE_ENV !== "production") {
    console.log(`[DEV OTP] ${to} → ${otp}`);
    return;
  }

  const resend = new Resend(apiKey);
  await resend.emails.send({
    from: process.env.RESEND_FROM_EMAIL || "EthioLearn <noreply@ethiolearn.com>",
    to,
    subject: "Your EthioLearn verification code",
    html: `
      <div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:24px">
        <h2 style="color:#1a6b2e;margin-bottom:8px">EthioLearn</h2>
        <p style="color:#374151">Your verification code is:</p>
        <div style="font-size:36px;font-weight:700;letter-spacing:8px;color:#1a6b2e;margin:16px 0">${otp}</div>
        <p style="color:#6b7280;font-size:14px">This code expires in 10 minutes. Do not share it with anyone.</p>
      </div>
    `,
  });
}

// ── Core store/retrieve helpers ──────────────────────────────────────────────

async function upsertOTP(key: string, otp: string): Promise<void> {
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000);
  await db.otpCode.upsert({
    where:  { key },
    create: { key, code: otp, expiresAt },
    update: { code: otp, expiresAt },
  });
}

// ── Public API ───────────────────────────────────────────────────────────────

/**
 * Generates a real OTP, stores it in the DB, and delivers it via SMS.
 * In dev mode the OTP is logged to the console instead of sent.
 */
export async function storeOTP(phone: string): Promise<string> {
  const otp = generateOTP();
  await upsertOTP(phone, otp);
  await sendSMS(phone, `Your EthioLearn verification code is: ${otp}. Valid for 10 minutes.`);
  return otp;
}

/**
 * Generates an OTP and stores it in the DB without sending it anywhere.
 * The caller is responsible for delivering it (e.g. via Telegram Bot API).
 */
export async function createOTP(key: string): Promise<string> {
  const otp = generateOTP();
  await upsertOTP(key, otp);
  return otp;
}

/**
 * Checks an OTP without consuming it.
 * Use before a DB write so a failure doesn't waste the user's code.
 */
export async function peekOTP(key: string, code: string): Promise<boolean> {
  const stored = await db.otpCode.findUnique({ where: { key } });
  if (!stored) return false;
  if (new Date() > stored.expiresAt) {
    await db.otpCode.delete({ where: { key } }).catch(() => {});
    return false;
  }
  return stored.code === code;
}

/** Consumes (deletes) the OTP entry — call after a successful peekOTP. */
export async function consumeOTP(key: string): Promise<void> {
  await db.otpCode.delete({ where: { key } }).catch(() => {});
}

/** Validates and consumes in one step. */
export async function verifyOTP(key: string, code: string): Promise<boolean> {
  const valid = await peekOTP(key, code);
  if (valid) await consumeOTP(key);
  return valid;
}

/** Removes the OTP entry without checking it. */
export async function clearOTP(key: string): Promise<void> {
  await db.otpCode.delete({ where: { key } }).catch(() => {});
}

/**
 * Generates an OTP, stores it in the DB, and delivers it via email.
 * In dev mode the OTP is logged to the console instead of sent.
 */
export async function storeEmailOTP(email: string): Promise<string> {
  const otp = generateOTP();
  await upsertOTP(email, otp);
  await sendEmail(email, otp);
  return otp;
}
