import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { rateLimit } from "@/lib/rate-limit";
import { emailConfigured } from "@/lib/mailer";
import { sendVerificationEmail } from "@/lib/auth-emails";

/**
 * POST /api/auth/verify-email/resend  { email }
 *
 * Sends the confirmation link again. The reply is the same whether or not the
 * address has an account waiting for confirmation, so it cannot be used to find
 * out who is registered.
 */
export async function POST(request: Request) {
  const ip = request.headers.get("x-forwarded-for")?.split(",").pop()?.trim() ?? "unknown";
  if (!rateLimit(`verify-resend:ip:${ip}`, 10, 15 * 60 * 1000).success) {
    return NextResponse.json({ error: "Too many requests. Please try again later." }, { status: 429 });
  }
  if (!emailConfigured()) {
    return NextResponse.json({ error: "Email is not available right now." }, { status: 503 });
  }

  const body = await request.json().catch(() => ({}));
  const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return NextResponse.json({ error: "Enter a valid email address." }, { status: 400 });
  }

  const sent = NextResponse.json({
    success: true,
    message: "If that account is waiting for confirmation, a new link is on its way.",
  });

  // At most 3 per address per hour, silently — the reply is identical.
  if (!rateLimit(`verify-resend:email:${email}`, 3, 60 * 60 * 1000).success) return sent;

  const user = await db.user.findUnique({
    where: { email },
    select: { id: true, name: true, emailVerifiedAt: true, passwordHash: true, isActive: true, suspendedAt: true },
  });
  if (!user || user.emailVerifiedAt || !user.passwordHash || !user.isActive || user.suspendedAt) return sent;

  try {
    await sendVerificationEmail({ id: user.id, name: user.name, email });
  } catch (err) {
    console.error("[Verify resend] email failed:", err);
    return NextResponse.json(
      { error: "We could not send the email. Please try again in a few minutes." },
      { status: 502 },
    );
  }
  return sent;
}
