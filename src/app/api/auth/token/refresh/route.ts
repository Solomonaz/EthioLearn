/**
 * POST /api/auth/token/refresh
 *
 * Single-use refresh token rotation (SRS §4.1.2).
 *
 * Flow:
 *  1. Read the current short-lived JWT from the session cookie.
 *  2. Validate the embedded sessionId against the DB.
 *  3. Revoke the current session (single-use semantics).
 *  4. Issue a new session and encode a new JWT.
 *  5. Write the new JWT back as an httpOnly cookie.
 */
import { NextRequest, NextResponse } from "next/server";
import { decode, encode } from "next-auth/jwt";
import { rotateSession } from "@/lib/session-store";

const SECRET = process.env.NEXTAUTH_SECRET!;
const ACCESS_TOKEN_TTL = 15 * 60; // 15 minutes in seconds

export async function POST(req: NextRequest) {
  // ── 1. Read & decode the current JWT cookie ──────────────────────────────
  const isSecure = process.env.NODE_ENV === "production";
  const cookieName = isSecure
    ? "__Secure-next-auth.session-token"
    : "next-auth.session-token";

  const sessionToken = req.cookies.get(cookieName)?.value;
  if (!sessionToken) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const token = await decode({ token: sessionToken, secret: SECRET });
  if (!token?.id) {
    return NextResponse.json({ error: "Invalid token" }, { status: 401 });
  }

  // ── 2 & 3. Rotate the session (revoke old, create new) ──────────────────
  const sessionId = token.sessionId as string | undefined;
  let newSessionId: string | undefined;

  if (sessionId) {
    const userAgent = req.headers.get("user-agent") ?? undefined;
    const ipAddress =
      req.headers.get("x-forwarded-for")?.split(",")[0].trim() ??
      req.headers.get("x-real-ip") ??
      undefined;

    const newSession = await rotateSession(sessionId, userAgent, ipAddress);
    if (!newSession) {
      return NextResponse.json(
        { error: "Session expired or revoked. Please sign in again." },
        { status: 401 }
      );
    }
    newSessionId = newSession.sessionId;
  }

  // ── 4. Build and encode a new JWT ───────────────────────────────────────
  const now = Math.floor(Date.now() / 1000);
  const newToken = {
    ...token,
    sessionId: newSessionId ?? sessionId,
    iat: now,
    exp: now + ACCESS_TOKEN_TTL,
  };

  const newJwt = await encode({
    token: newToken,
    secret: SECRET,
    maxAge: ACCESS_TOKEN_TTL,
  });

  // ── 5. Write the refreshed cookie ────────────────────────────────────────
  const response = NextResponse.json({ success: true });
  response.cookies.set(cookieName, newJwt, {
    httpOnly: true,
    secure: isSecure,
    sameSite: "lax",
    maxAge: ACCESS_TOKEN_TTL,
    path: "/",
  });

  return response;
}
