import { decode } from "next-auth/jwt";
import { cookies } from "next/headers";
import { db } from "./db";
import { validateSession } from "./session-store";

export async function getCurrentUser() {
  const cookieStore = await cookies();

  // Support both http (dev) and https (prod) cookie names
  const sessionToken =
    cookieStore.get("next-auth.session-token")?.value ??
    cookieStore.get("__Secure-next-auth.session-token")?.value;

  if (!sessionToken) return null;

  const token = await decode({
    token: sessionToken,
    secret: process.env.NEXTAUTH_SECRET!,
  });

  if (!token?.id) return null;

  // ── Session revocation check (§4.1.2) ───────────────────────────────────
  // If the JWT contains a sessionId, verify it has not been revoked in the DB.
  // This is the enforcement point for the session management feature.
  if (token.sessionId) {
    const liveSession = await validateSession(token.sessionId as string);
    if (!liveSession) return null; // Session revoked or expired
  }

  const user = await db.user.findUnique({
    where: { id: token.id as string },
    include: { school: true },
  });

  // Deactivated or suspended accounts are treated as unauthenticated
  if (!user || !user.isActive || user.suspendedAt) return null;

  return user;
}
