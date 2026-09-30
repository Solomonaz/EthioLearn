import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { rateLimit } from "@/lib/rate-limit";
import { hashPassword, passwordProblem } from "@/lib/password";
import { emailConfigured } from "@/lib/mailer";
import { sendVerificationEmail } from "@/lib/auth-emails";

/**
 * Self sign-up with email + password. Only ever creates an independent
 * student: teachers and school admins are created by an admin, and a
 * school's students by their school. `role` and `schoolId` in the body are
 * ignored.
 *
 * The email must be confirmed before the password works: we email a 24-hour
 * link, and password sign-in refuses an unconfirmed email (lib/auth). So an
 * account made with someone else's — or a made-up — email is unusable, and
 * the real owner can still take the address: registering again replaces an
 * unconfirmed sign-up, "Forgot password" confirms it, and Google discards
 * its password (resolveSocialUser in lib/auth).
 */
const EMAIL_TAKEN =
  "An account with this email already exists. Sign in, or use “Forgot password?” if it’s yours.";

export async function POST(request: Request) {
  try {
    // 3 registrations per IP per 10 minutes
    // Use the rightmost IP from X-Forwarded-For — that's the one added by
    // the trusted reverse proxy. The leftmost can be spoofed by the client.
    const ip = request.headers.get("x-forwarded-for")?.split(",").pop()?.trim() ?? "unknown";
    const rl = rateLimit(`register:${ip}`, 3, 10 * 60 * 1000);
    if (!rl.success) {
      return NextResponse.json(
        { error: "Too many registration attempts. Please try again later." },
        { status: 429, headers: { "Retry-After": String(rl.retryAfter) } }
      );
    }

    const body = await request.json().catch(() => ({}));
    const name = typeof body.name === "string" ? body.name.trim() : "";
    const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
    const password = body.password;
    const grade = Number(body.grade);

    if (name.length < 2 || name.length > 50) {
      return NextResponse.json({ error: "Enter your full name (2-50 characters)." }, { status: 400 });
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) {
      return NextResponse.json({ error: "Enter a valid email address." }, { status: 400 });
    }
    const problem = passwordProblem(password);
    if (problem) {
      return NextResponse.json({ error: problem }, { status: 400 });
    }
    if (!Number.isInteger(grade) || grade < 1 || grade > 12) {
      return NextResponse.json({ error: "Choose your grade." }, { status: 400 });
    }

    // Without email, nobody could ever confirm — don't create dead accounts.
    if (!emailConfigured()) {
      return NextResponse.json(
        { error: "Sign-up with email is not available right now. Please use Google or Telegram." },
        { status: 503 }
      );
    }

    const existing = await db.user.findUnique({
      where: { email },
      select: {
        id: true, role: true, emailVerifiedAt: true, googleId: true, telegramId: true,
        facebookId: true, schoolId: true, username: true,
      },
    });

    // An unconfirmed email sign-up was never usable, so a new sign-up for the
    // same address replaces it — otherwise whoever typed the address first
    // would block its real owner. Anything else is a real account.
    const replaceable =
      existing &&
      existing.role === "STUDENT" &&
      !existing.emailVerifiedAt &&
      !existing.googleId && !existing.telegramId && !existing.facebookId &&
      !existing.schoolId && !existing.username;

    if (existing && !replaceable) {
      return NextResponse.json(
        { error: EMAIL_TAKEN },
        { status: 409 }
      );
    }

    const data = {
      name,
      email,
      passwordHash: await hashPassword(password as string),
      role: "STUDENT" as const,
      grade,
    };
    const user = existing
      ? await db.user.update({ where: { id: existing.id }, data, select: { id: true, name: true, email: true } })
      : await db.user.create({ data, select: { id: true, name: true, email: true } });

    try {
      await sendVerificationEmail({ id: user.id, name: user.name, email });
    } catch (err) {
      // The account exists; the sign-in page can send the link again.
      console.error("[Register] verification email failed:", err);
      return NextResponse.json({ success: true, verificationSent: false, email });
    }

    return NextResponse.json({ success: true, verificationSent: true, email });
  } catch (error) {
    // Two sign-ups for the same address at once: the second hits the unique
    // index after passing the lookup above.
    if ((error as { code?: string })?.code === "P2002") {
      return NextResponse.json({ error: EMAIL_TAKEN }, { status: 409 });
    }
    console.error("Registration error:", error);
    return NextResponse.json(
      { error: "Something went wrong on our side and your account was not created. Please try again in a minute." },
      { status: 500 }
    );
  }
}
