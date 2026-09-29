import { decode } from "next-auth/jwt";
import { cookies } from "next/headers";
import { cache } from "react";
import { db } from "./db";
import { validateSession } from "./session-store";

/**
 * getCurrentUser — returns the authenticated user for the current request.
 *
 * Wrapped with React's `cache()` so that multiple Server Components in the
 * same render tree (e.g. layout + page) share a single DB round-trip per
 * request instead of each triggering their own queries.
 */
export const getCurrentUser = cache(async () => {
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

  // ── Handle env-configured Super Admin (no DB record) ───────────────────
  // When SUPER_ADMIN_EMAIL / SUPER_ADMIN_PASSWORD from .env are used,
  // authorize() returns id: "env_super_admin".  This user has no DB row, so we
  // synthesise a virtual user object that satisfies every downstream check.
  if (token.id === "env_super_admin") {
    return {
      id: "env_super_admin",
      phoneNumber: null,
      email: process.env.SUPER_ADMIN_EMAIL?.trim().toLowerCase() ?? null,
      username: null,
      passwordHash: null,
      mustChangePassword: false,
      emailVerifiedAt: null,
      name: "System Super Admin",
      role: "SUPER_ADMIN" as const,
      grade: null,
      section: null,
      avatarUrl: null,
      xpLevel: 0,
      totalPoints: 0,
      redeemablePoints: 0,
      streakDays: 0,
      isActive: true,
      suspendedAt: null,
      suspendReason: null,
      lastActiveAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      googleId: null,
      facebookId: null,
      telegramId: null,
      schoolId: null,
      school: null,
    } as any;
  }

  // ── Session revocation check (§4.1.2) ───────────────────────────────────
  // If the JWT contains a sessionId, verify it has not been revoked in the DB.
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
});

/**
 * Like getCurrentUser but also returns null when the user's profile is
 * incomplete (no phoneNumber yet — Telegram-registered, mid-onboarding).
 * Use this in all student data API routes so half-created accounts can't
 * access app content before finishing registration.
 */
export async function requireCompleteProfile() {
  const user = await getCurrentUser();
  if (!user) return null;
  // env_super_admin is a virtual user with no DB row — always complete
  if (user.id === "env_super_admin") return user;
  // Profile is complete when the user has selected a grade.
  // Phone-registered users always have a grade (set during registration).
  // Social/Telegram users pick a grade on the complete-profile page.
  if (!(user as any).grade) return null;
  return user;
}
