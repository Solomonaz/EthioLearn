import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { rateLimit } from "@/lib/rate-limit";
import { hashPassword, passwordProblem } from "@/lib/password";

/**
 * Self sign-up with email + password. Only ever creates an independent
 * student: teachers and school admins are created by an admin, and a
 * school's students by their school. `role` and `schoolId` in the body are
 * ignored.
 *
 * The email is not verified here. If its owner later signs in with Google,
 * the Google link discards this password (see resolveSocialUser in
 * lib/auth), so pre-registering someone else's email gains nothing.
 */
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

    const existing = await db.user.findUnique({ where: { email }, select: { id: true } });
    if (existing) {
      return NextResponse.json(
        { error: "An account with this email already exists. Please sign in instead." },
        { status: 409 }
      );
    }

    const user = await db.user.create({
      data: {
        name,
        email,
        passwordHash: await hashPassword(password as string),
        role: "STUDENT",
        grade,
      },
      select: { id: true, name: true, email: true, role: true, grade: true, createdAt: true },
    });

    return NextResponse.json({ success: true, user });
  } catch (error) {
    console.error("Registration error:", error);
    return NextResponse.json({ error: "Failed to create account" }, { status: 500 });
  }
}
