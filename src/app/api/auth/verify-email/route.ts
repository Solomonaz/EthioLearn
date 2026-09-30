import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { rateLimit } from "@/lib/rate-limit";
import { consumeVerifyToken } from "@/lib/password";

/**
 * POST /api/auth/verify-email  { token }
 *
 * Confirms the email address from the link sent at sign-up. After this the
 * account's password works (lib/auth refuses an unconfirmed email).
 */
export async function POST(request: Request) {
  const ip = request.headers.get("x-forwarded-for")?.split(",").pop()?.trim() ?? "unknown";
  if (!rateLimit(`verify:ip:${ip}`, 20, 15 * 60 * 1000).success) {
    return NextResponse.json({ error: "Too many attempts. Please try again later." }, { status: 429 });
  }

  const body = await request.json().catch(() => ({}));
  const token = typeof body.token === "string" ? body.token : "";
  const userId = token ? await consumeVerifyToken(token) : null;
  if (!userId) {
    return NextResponse.json(
      { error: "This link is invalid or has expired. Sign in to get a new one." },
      { status: 400 },
    );
  }

  await db.user.update({
    where: { id: userId },
    data: { emailVerifiedAt: new Date() },
  });
  return NextResponse.json({ success: true });
}
