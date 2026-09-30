import { sendMail } from "./mailer";
import { createResetToken, createVerifyToken } from "./password";

/**
 * The account emails: password reset and email verification. One layout, the
 * logo at the top, one button, and a plain-text version for clients that do
 * not show HTML.
 */

function siteUrl(): string {
  return (process.env.NEXTAUTH_URL || "http://localhost:3001").replace(/\/$/, "");
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

async function sendButtonEmail(opts: {
  to: string;
  subject: string;
  name: string;
  intro: string;
  button: string;
  link: string;
  footer: string;
}): Promise<void> {
  const base = siteUrl();
  await sendMail(
    opts.to,
    opts.subject,
    `<div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:24px">
      <img src="${base}/brand/logo-email.png" alt="Abugida" width="200" style="display:block;margin-bottom:16px;border:0" />
      <p style="color:#374151">Hello ${escapeHtml(opts.name)},</p>
      <p style="color:#374151">${escapeHtml(opts.intro)}</p>
      <p style="margin:24px 0"><a href="${opts.link}" style="background:#1a6b2e;color:#fff;padding:12px 20px;border-radius:8px;text-decoration:none;font-weight:600">${escapeHtml(opts.button)}</a></p>
      <p style="color:#6b7280;font-size:13px">${escapeHtml(opts.footer)}</p>
    </div>`,
    `Hello ${opts.name},\n\n${opts.intro}\n${opts.link}\n\n${opts.footer}`,
  );
}

/** Email a one-hour link to set a new password. */
export async function sendPasswordResetEmail(user: { id: string; name: string; email: string }) {
  const token = await createResetToken(user.id);
  await sendButtonEmail({
    to: user.email,
    subject: "Set your Abugida password",
    name: user.name,
    intro: "Use the button below to set a new password. The link works once and expires in 1 hour.",
    button: "Set my password",
    link: `${siteUrl()}/reset-password?token=${encodeURIComponent(token)}`,
    footer: "If you did not ask for this, you can ignore this email.",
  });
}

/** Email a 24-hour link that confirms this address belongs to the person who signed up. */
export async function sendVerificationEmail(user: { id: string; name: string; email: string }) {
  const token = await createVerifyToken(user.id);
  await sendButtonEmail({
    to: user.email,
    subject: "Confirm your email for Abugida",
    name: user.name,
    intro: "Welcome to Abugida! Please confirm this is your email address, then you can sign in. The link expires in 24 hours.",
    button: "Confirm my email",
    link: `${siteUrl()}/verify-email?token=${encodeURIComponent(token)}`,
    footer: "If you did not create an Abugida account, you can ignore this email — the account will not be usable.",
  });
}
