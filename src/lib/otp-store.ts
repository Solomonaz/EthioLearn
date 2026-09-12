import crypto from "crypto";
import { db } from "./db";
import { Resend } from "resend";

function generateOTP(): string {
  // Use cryptographically secure random bytes
  const bytes = crypto.randomBytes(3);
  const num = (bytes.readUIntBE(0, 3) % 900000) + 100000;
  return num.toString();
}

function hashOTP(otp: string): string {
  return crypto.createHash("sha256").update(otp).digest("hex");
}

// Exponential back-off tracker for failed OTP attempts (in-memory, per process)
const failedAttempts = new Map<string, { count: number; blockedUntil: number }>();

/**
 * Raised when a phone code is requested but no SMS provider is configured.
 * Callers should surface this as a real failure, not a success.
 */
export class SmsUnavailableError extends Error {
  constructor() {
    super("No SMS provider is configured.");
    this.name = "SmsUnavailableError";
  }
}

/**
 * SMS delivery.
 *
 * The Africa's Talking integration was removed: it pulled a high-severity
 * axios SSRF advisory whose only available fix was a major downgrade, and the
 * channel was not needed. Codes reach users through Telegram
 * (auth/telegram-otp/send) and email (Resend) instead.
 *
 * This THROWS in production rather than falling back to a console log. The old
 * code logged and returned normally whenever the provider was unconfigured —
 * including in production — so `/api/auth/otp/send` answered "OTP sent
 * successfully" while the user waited for a message nobody had sent. Failing
 * loudly is the point: a missing channel must look missing.
 *
 * To add a provider later, implement it here; nothing else needs to change.
 */
async function sendSMS(phone: string, message: string): Promise<void> {
  if (process.env.NODE_ENV !== "production") {
    console.log(`[DEV OTP] ${phone} → ${message}`);
    return;
  }
  throw new SmsUnavailableError();
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
  const hashed = hashOTP(otp);
  // Reset failed attempts when a new OTP is issued
  failedAttempts.delete(key);
  await db.otpCode.upsert({
    where:  { key },
    create: { key, code: hashed, expiresAt },
    update: { code: hashed, expiresAt },
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
 * Applies exponential back-off after repeated failures.
 */
export async function peekOTP(key: string, code: string): Promise<boolean> {
  const now = Date.now();

  // Check exponential back-off
  const attempt = failedAttempts.get(key);
  if (attempt && now < attempt.blockedUntil) {
    return false;
  }

  const stored = await db.otpCode.findUnique({ where: { key } });
  if (!stored) return false;
  if (new Date() > stored.expiresAt) {
    await db.otpCode.delete({ where: { key } }).catch(() => {});
    return false;
  }

  const isValid = stored.code === hashOTP(code);

  if (!isValid) {
    const current = failedAttempts.get(key) ?? { count: 0, blockedUntil: 0 };
    current.count += 1;
    // Back-off: 30s × 2^(n-1), capped at 10 minutes
    current.blockedUntil = now + Math.min(30_000 * Math.pow(2, current.count - 1), 600_000);
    failedAttempts.set(key, current);
    return false;
  }

  failedAttempts.delete(key);
  return true;
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
