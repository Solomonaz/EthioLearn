// In-memory OTP store: phone -> { otp, expiresAt }
const otpStore = new Map<string, { otp: string; expiresAt: Date }>();

function generateOTP(): string {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

async function sendSMS(phone: string, message: string): Promise<void> {
  const apiKey = process.env.AFRICASTALKING_API_KEY;
  const username = process.env.AFRICASTALKING_USERNAME;

  if (!apiKey || !username || process.env.NODE_ENV !== "production") {
    // Dev mode: just log
    console.log(`[DEV OTP] Phone: ${phone}, Message: ${message}`);
    return;
  }

  // Use africastalking SDK
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const AfricasTalking = require("africastalking");
  const at = AfricasTalking({ apiKey, username });
  const sms = at.SMS;

  await sms.send({
    to: [phone],
    message,
    from: process.env.AFRICASTALKING_SENDER_ID || "EthioLearn",
  });
}

export async function storeOTP(phone: string): Promise<string> {
  // Dev mode: always return 123456
  if (process.env.NODE_ENV !== "production") {
    const otp = "123456";
    otpStore.set(phone, {
      otp,
      expiresAt: new Date(Date.now() + 10 * 60 * 1000),
    });
    return otp;
  }

  const otp = generateOTP();
  otpStore.set(phone, {
    otp,
    expiresAt: new Date(Date.now() + 10 * 60 * 1000),
  });

  await sendSMS(
    phone,
    `Your EthioLearn verification code is: ${otp}. Valid for 10 minutes.`
  );

  return otp;
}

export function verifyOTP(phone: string, code: string): boolean {
  // Dev mode: always accept 123456
  if (process.env.NODE_ENV !== "production" && code === "123456") {
    return true;
  }

  const stored = otpStore.get(phone);
  if (!stored) return false;
  if (new Date() > stored.expiresAt) {
    otpStore.delete(phone);
    return false;
  }
  if (stored.otp !== code) return false;

  otpStore.delete(phone); // one-time use
  return true;
}

/**
 * Validates an OTP without consuming it from the store.
 * Use this when you need to validate first, then perform other operations
 * before committing the consumption (e.g. DB user lookup in authorize()).
 * Call consumeOTP() afterwards to complete the one-time-use semantics.
 */
export function peekOTP(phone: string, code: string): boolean {
  if (process.env.NODE_ENV !== "production" && code === "123456") {
    return true;
  }
  const stored = otpStore.get(phone);
  if (!stored) return false;
  if (new Date() > stored.expiresAt) {
    otpStore.delete(phone);
    return false;
  }
  return stored.otp === code;
}

/** Removes the OTP entry for a phone number (one-time-use enforcement). */
export function consumeOTP(phone: string): void {
  otpStore.delete(phone);
}

export function clearOTP(phone: string): void {
  otpStore.delete(phone);
}
