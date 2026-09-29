import { Resend } from "resend";

/**
 * Outgoing email (Resend). Used for password-reset links.
 *
 * In development the message is printed to the server console instead of
 * sent. In production a missing RESEND_API_KEY THROWS `EmailUnavailableError`
 * rather than logging and returning normally — the old OTP mailer did that,
 * so the site said "sent" while nothing was. A missing channel must look
 * missing.
 */

export class EmailUnavailableError extends Error {
  constructor() {
    super("Email is not configured.");
    this.name = "EmailUnavailableError";
  }
}

/** Whether email can actually be sent (always true in development, which logs instead). */
export function emailConfigured(): boolean {
  return process.env.NODE_ENV !== "production" || !!process.env.RESEND_API_KEY;
}

export async function sendMail(to: string, subject: string, html: string, text: string): Promise<void> {
  if (process.env.NODE_ENV !== "production") {
    console.log(`[DEV EMAIL] to=${to} subject="${subject}"\n${text}`);
    return;
  }

  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) throw new EmailUnavailableError();

  const { error } = await new Resend(apiKey).emails.send({
    from: process.env.RESEND_FROM_EMAIL || "EthioLearn <noreply@ethiolearn.com>",
    to,
    subject,
    html,
    text,
  });
  if (error) throw new Error(`Email send failed: ${error.message}`);
}
