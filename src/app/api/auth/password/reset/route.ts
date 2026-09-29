import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { rateLimit } from "@/lib/rate-limit";
import { consumeResetToken, hashPassword, passwordProblem } from "@/lib/password";
import { revokeAllUserSessions } from "@/lib/session-store";

/**
 * POST /api/auth/password/reset  { token, password }
 *
 * Sets a new password from an emailed link. Using the link proves the person
 * controls the account's email, so it is also marked verified. Every existing
 * session is signed out: whoever might have had the old password loses it.
 */
export async function POST(request: Request) {
  const ip = request.headers.get("x-forwarded-for")?.split(",").pop()?.trim() ?? "unknown";
  if (!rateLimit(`pwreset:ip:${ip}`, 10, 15 * 60 * 1000).success) {
    return NextResponse.json({ error: "Too many attempts. Please try again later." }, { status: 429 });
  }

  const body = await request.json().catch(() => ({}));
  const token = typeof body.token === "string" ? body.token : "";
  const problem = passwordProblem(body.password);
  if (problem) {
    return NextResponse.json({ error: problem }, { status: 400 });
  }

  const userId = token ? await consumeResetToken(token) : null;
  if (!userId) {
    return NextResponse.json(
      { error: "This link is invalid or has expired. Ask for a new one." },
      { status: 400 },
    );
  }

  const user = await db.user.findUnique({
    where: { id: userId },
    select: { isActive: true, suspendedAt: true },
  });
  if (!user || !user.isActive || user.suspendedAt) {
    return NextResponse.json(
      { error: "This link is invalid or has expired. Ask for a new one." },
      { status: 400 },
    );
  }

  await db.user.update({
    where: { id: userId },
    data: {
      passwordHash: await hashPassword(body.password),
      mustChangePassword: false,
      emailVerifiedAt: new Date(),
    },
  });
  await revokeAllUserSessions(userId);

  return NextResponse.json({ success: true });
}
