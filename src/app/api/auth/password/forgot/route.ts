import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { rateLimit } from "@/lib/rate-limit";
import { emailConfigured } from "@/lib/mailer";
import { sendPasswordResetEmail } from "@/lib/auth-emails";

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

  try {
    await sendPasswordResetEmail({ id: user.id, name: user.name, email });
  } catch (err) {
    console.error("[Password reset] email failed:", err);
    return NextResponse.json(
      { error: "We could not send the email. Please try again in a few minutes." },
      { status: 502 },
    );
  }

  return sent;
}
