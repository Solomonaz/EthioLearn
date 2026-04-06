/**
 * GET  /api/auth/sessions  — List the current user's active sessions.
 * DELETE /api/auth/sessions — Revoke ALL sessions except the current one.
 */
import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/get-session";
import { getUserSessions, revokeSession, validateSession } from "@/lib/session-store";
import { decode } from "next-auth/jwt";
import { cookies } from "next/headers";

async function getCurrentSessionId(): Promise<string | null> {
  const cookieStore = await cookies();
  const sessionToken =
    cookieStore.get("next-auth.session-token")?.value ??
    cookieStore.get("__Secure-next-auth.session-token")?.value;

  if (!sessionToken) return null;

  const token = await decode({
    token: sessionToken,
    secret: process.env.NEXTAUTH_SECRET!,
  });
  return (token?.sessionId as string | undefined) ?? null;
}

// ── GET — list sessions ───────────────────────────────────────────────────────
export async function GET() {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const [sessions, currentSessionId] = await Promise.all([
    getUserSessions(user.id),
    getCurrentSessionId(),
  ]);

  return NextResponse.json({
    sessions: sessions.map((s) => ({
      ...s,
      isCurrent: s.sessionId === currentSessionId,
    })),
    currentSessionId,
  });
}

// ── DELETE — revoke all OTHER sessions ──────────────────────────────────────
export async function DELETE() {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const currentSessionId = await getCurrentSessionId();
  const sessions = await getUserSessions(user.id);

  const toRevoke = sessions.filter((s) => s.sessionId !== currentSessionId);
  await Promise.all(toRevoke.map((s) => revokeSession(s.id, user.id)));

  return NextResponse.json({ revokedCount: toRevoke.length });
}
