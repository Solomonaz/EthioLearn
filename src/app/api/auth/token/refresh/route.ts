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
import { validateCsrfOrigin } from "@/lib/csrf";

const SECRET = process.env.NEXTAUTH_SECRET!;
// The rotated cookie keeps the full rolling session length (auth.ts
// session.maxAge, lib/session-store SESSION_TTL_MS). It used to be 15 minutes,
// which signed out anyone who left the app for a quarter of an hour after a
// rotation. Rotation still swaps the session id every few minutes while the
// app is open, and revoking a session still ends it at once.
const TOKEN_TTL = 30 * 24 * 60 * 60; // 30 days in seconds

export async function POST(req: NextRequest) {
  if (!validateCsrfOrigin(req)) {
    return NextResponse.json({ error: "Invalid request origin" }, { status: 403 });
  }

  // ── 1. Read & decode the current JWT cookie ──────────────────────────────
  // Whichever name the browser holds (https uses the __Secure- prefix).
  const secureName = "__Secure-next-auth.session-token";
  const plainName = "next-auth.session-token";
  const cookieName = req.cookies.get(secureName) ? secureName : plainName;
  const isSecure = cookieName === secureName;

  const sessionToken = req.cookies.get(cookieName)?.value;
  if (!sessionToken) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  // An expired/tampered/old-secret cookie throws: treat it as signed out.
  const token = await decode({ token: sessionToken, secret: SECRET }).catch(() => null);
  if (!token?.id) {
    return NextResponse.json({ error: "Invalid token" }, { status: 401 });
  }

  // ── 2 & 3. Rotate the session (revoke old, create new) ──────────────────
  const sessionId = token.sessionId as string | undefined;
  let newSessionId: string | undefined;

  if (sessionId) {
    const userAgent = req.headers.get("user-agent") ?? undefined;
    const ipAddress =
      req.headers.get("x-forwarded-for")?.split(",").pop()?.trim() ??
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
    exp: now + TOKEN_TTL,
  };

  const newJwt = await encode({
    token: newToken,
    secret: SECRET,
    maxAge: TOKEN_TTL,
  });

  // ── 5. Write the refreshed cookie ────────────────────────────────────────
  const response = NextResponse.json({ success: true });
  response.cookies.set(cookieName, newJwt, {
    httpOnly: true,
    secure: isSecure,
    sameSite: "lax",
    maxAge: TOKEN_TTL,
    path: "/",
  });

  return response;
}
