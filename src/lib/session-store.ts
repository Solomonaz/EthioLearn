import { db } from "./db";

// ── Constants ────────────────────────────────────────────────────────────────

const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days (refresh token lifetime)

// ── Device Name Parser ───────────────────────────────────────────────────────

export function parseDeviceName(userAgent?: string | null): string {
  if (!userAgent) return "Unknown Device";
  const ua = userAgent.toLowerCase();

  let browser = "Browser";
  if (ua.includes("edg/") || ua.includes("edge/")) browser = "Edge";
  else if (ua.includes("opr/") || ua.includes("opera")) browser = "Opera";
  else if (ua.includes("chrome") && !ua.includes("chromium")) browser = "Chrome";
  else if (ua.includes("firefox")) browser = "Firefox";
  else if (ua.includes("safari") && !ua.includes("chrome")) browser = "Safari";
  else if (ua.includes("samsung")) browser = "Samsung Internet";

  let os = "Unknown OS";
  if (ua.includes("android")) os = "Android";
  else if (ua.includes("iphone") || ua.includes("ipad")) os = "iOS";
  else if (ua.includes("windows")) os = "Windows";
  else if (ua.includes("mac os") || ua.includes("macintosh")) os = "macOS";
  else if (ua.includes("linux")) os = "Linux";

  return `${browser} on ${os}`;
}

// ── Session CRUD ─────────────────────────────────────────────────────────────

/**
 * Create a new session record for a user sign-in.
 */
export async function createUserSession(
  userId: string,
  userAgent?: string | null,
  ipAddress?: string | null
) {
  return db.userSession.create({
    data: {
      userId,
      deviceName: parseDeviceName(userAgent),
      userAgent: userAgent ?? null,
      ipAddress: ipAddress ?? null,
      expiresAt: new Date(Date.now() + SESSION_TTL_MS),
    },
  });
}

/**
 * Validate a session: returns the session if valid, null otherwise.
 */
export async function validateSession(sessionId: string) {
  const session = await db.userSession.findUnique({
    where: { sessionId },
    select: {
      id: true,
      sessionId: true,
      userId: true,
      isRevoked: true,
      expiresAt: true,
      deviceName: true,
      ipAddress: true,
    },
  });

  if (!session) return null;
  if (session.isRevoked) return null;
  if (session.expiresAt < new Date()) return null;

  return session;
}

/**
 * Rotate a session: revoke the old sessionId and issue a new one.
 * Returns the new session record.
 */
export async function rotateSession(
  oldSessionId: string,
  userAgent?: string | null,
  ipAddress?: string | null
) {
  const oldSession = await db.userSession.findUnique({
    where: { sessionId: oldSessionId },
  });

  if (!oldSession || oldSession.isRevoked || oldSession.expiresAt < new Date()) {
    return null;
  }

  // Run revoke + create atomically
  const [, newSession] = await db.$transaction([
    db.userSession.update({
      where: { sessionId: oldSessionId },
      data: { isRevoked: true, revokedAt: new Date() },
    }),
    db.userSession.create({
      data: {
        userId: oldSession.userId,
        deviceName: parseDeviceName(userAgent) ?? oldSession.deviceName,
        userAgent: userAgent ?? oldSession.userAgent,
        ipAddress: ipAddress ?? oldSession.ipAddress,
        expiresAt: new Date(Date.now() + SESSION_TTL_MS),
      },
    }),
  ]);

  return newSession;
}

/**
 * Revoke a specific session by its DB id (must belong to userId).
 */
export async function revokeSession(id: string, userId: string) {
  const session = await db.userSession.findFirst({
    where: { id, userId, isRevoked: false },
  });

  if (!session) return false;

  await db.userSession.update({
    where: { id },
    data: { isRevoked: true, revokedAt: new Date() },
  });

  return true;
}

/**
 * List all active (non-revoked, non-expired) sessions for a user.
 */
export async function getUserSessions(userId: string) {
  const now = new Date();
  return db.userSession.findMany({
    where: {
      userId,
      isRevoked: false,
      expiresAt: { gt: now },
    },
    orderBy: { lastUsedAt: "desc" },
    select: {
      id: true,
      sessionId: true,
      deviceName: true,
      ipAddress: true,
      createdAt: true,
      lastUsedAt: true,
      expiresAt: true,
    },
  });
}

/**
 * Update the lastUsedAt timestamp for a session (fire-and-forget).
 */
export function touchSession(sessionId: string) {
  db.userSession
    .update({ where: { sessionId }, data: { lastUsedAt: new Date() } })
    .catch(() => {}); // Non-fatal
}

/**
 * Delete expired sessions older than 30 days (housekeeping).
 */
export async function cleanExpiredSessions() {
  return db.userSession.deleteMany({
    where: {
      OR: [
        { expiresAt: { lt: new Date() } },
        { isRevoked: true, revokedAt: { lt: new Date(Date.now() - SESSION_TTL_MS) } },
      ],
    },
  });
}
