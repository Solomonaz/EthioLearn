import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { rateLimit } from "@/lib/rate-limit";
import { createResetToken } from "@/lib/password";
import { emailConfigured, sendMail } from "@/lib/mailer";

/**
 * POST /api/auth/password/forgot  { email }
 *
 * Emails a one-hour link to set a new password. This is also how an
 * admin-created teacher or school admin sets their FIRST password.
 *
 * The answer is the same whether or not the email has an account, so the form
 * cannot be used to find out who is registered. Students a school created sign
 * in with a username and have no email: their school admin resets them.
 */
export async function POST(request: Request) {
  const ip = request.headers.get("x-forwarded-for")?.split(",").pop()?.trim() ?? "unknown";
  const rlIp = rateLimit(`pwforgot:ip:${ip}`, 10, 15 * 60 * 1000);
  if (!rlIp.success) {
    return NextResponse.json(
      { error: "Too many requests. Please try again later." },
      { status: 429, headers: { "Retry-After": String(rlIp.retryAfter) } },
    );
  }

  // Checked BEFORE looking the email up: failing only for real accounts would
  // reveal which emails exist.
  if (!emailConfigured()) {
    return NextResponse.json(
      { error: "Password reset by email is not available right now. Please contact your administrator." },
      { status: 503 },
    );
  }

  const body = await request.json().catch(() => ({}));
  const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return NextResponse.json({ error: "Enter a valid email address." }, { status: 400 });
  }

  const sent = NextResponse.json({
    success: true,
    message: "If an account uses that email, a link to set a new password is on its way.",
  });

  // At most 3 emails per address per hour, silently — the reply is identical.
  if (!rateLimit(`pwforgot:email:${email}`, 3, 60 * 60 * 1000).success) return sent;

  const user = await db.user.findUnique({
    where: { email },
    select: { id: true, name: true, isActive: true, suspendedAt: true },
  });
  if (!user || !user.isActive || user.suspendedAt) return sent;

  const token = await createResetToken(user.id);
  const base = (process.env.NEXTAUTH_URL || "http://localhost:3001").replace(/\/$/, "");
  const link = `${base}/reset-password?token=${encodeURIComponent(token)}`;

  try {
    await sendMail(
      email,
      "Set your Abugida password",
      `<div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:24px">
        <img src="${base}/brand/logo-email.png" alt="Abugida" width="200" style="display:block;margin-bottom:16px;border:0" />
        <p style="color:#374151">Hello ${escapeHtml(user.name)},</p>
        <p style="color:#374151">Use the button below to set a new password. The link works once and expires in 1 hour.</p>
        <p style="margin:24px 0"><a href="${link}" style="background:#1a6b2e;color:#fff;padding:12px 20px;border-radius:8px;text-decoration:none;font-weight:600">Set my password</a></p>
        <p style="color:#6b7280;font-size:13px">If you did not ask for this, you can ignore this email.</p>
      </div>`,
      `Hello ${user.name},\n\nSet a new Abugida password here (works once, expires in 1 hour):\n${link}\n\nIf you did not ask for this, ignore this email.`,
    );
  } catch (err) {
    console.error("[Password reset] email failed:", err);
    return NextResponse.json(
      { error: "We could not send the email. Please try again in a few minutes." },
      { status: 502 },
    );
  }

  return sent;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}
