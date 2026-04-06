"use client";

/**
 * TokenRefreshProvider
 *
 * Silently rotates the 15-minute access token before it expires so the user
 * stays signed in without any interruption (SRS §4.1.2).
 *
 * Strategy: call /api/auth/token/refresh every 13 minutes while the user has
 * an active session. The endpoint performs single-use rotation: the old
 * session record is revoked and a new one is issued atomically.
 */
import { useEffect } from "react";
import { useSession } from "next-auth/react";

// Refresh 2 minutes before the 15-min access token expires
const REFRESH_INTERVAL_MS = 13 * 60 * 1000;

export function TokenRefreshProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const { status } = useSession();

  useEffect(() => {
    if (status !== "authenticated") return;

    const refresh = async () => {
      try {
        const res = await fetch("/api/auth/token/refresh", { method: "POST" });
        if (!res.ok && res.status === 401) {
          // Session was revoked externally — force a clean sign-out
          window.location.href = "/login?error=SessionRevoked";
        }
      } catch {
        // Network failure — silently skip; user will be prompted on next
        // protected API call when the JWT has fully expired.
      }
    };

    // Kick off the first refresh after REFRESH_INTERVAL_MS
    const interval = setInterval(refresh, REFRESH_INTERVAL_MS);

    return () => clearInterval(interval);
  }, [status]);

  return <>{children}</>;
}
