"use client";

/**
 * TokenRefreshProvider
 *
 * Silently rotates the 15-minute access token before it expires so the user
 * stays signed in without interruption (SRS §4.1.2).
 *
 * Robustness (prevents the "app kicks me to /login mid-work" problem):
 *  • Cross-tab lock (Web Locks API) so concurrent tabs don't rotate — and thus
 *    revoke — each other's shared session.
 *  • A 401 from the refresh endpoint is VERIFIED against /api/auth/session
 *    before any disruptive redirect: a race often leaves the session perfectly
 *    valid, so we must not wipe the user's page for a transient failure.
 *  • Network errors never redirect.
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

    let cancelled = false;

    // Are we *actually* signed out? A refresh 401 is usually just a concurrent
    // rotation race — in that case the session cookie is still valid and this
    // returns true, so we skip the redirect.
    const stillAuthenticated = async (): Promise<boolean> => {
      try {
        const res = await fetch("/api/auth/session", { cache: "no-store" });
        if (!res.ok) return false;
        const data = await res.json().catch(() => ({}));
        return !!data?.user;
      } catch {
        // Network hiccup — assume still signed in; don't kick the user out.
        return true;
      }
    };

    const doRefresh = async () => {
      try {
        const res = await fetch("/api/auth/token/refresh", { method: "POST" });
        if (res.ok || res.status !== 401) return;
        if (cancelled) return;
        // 401 — confirm we're truly logged out before the disruptive redirect.
        if (await stillAuthenticated()) return;
        if (!cancelled) window.location.href = "/login?error=SessionRevoked";
      } catch {
        // Network failure — silently skip; a fully-expired JWT is handled by
        // the next protected request.
      }
    };

    // Only the tab that wins the lock refreshes; the new cookie it sets keeps
    // every other tab signed in. `ifAvailable` means other tabs skip instead of
    // queuing a second (racing) rotation.
    const runRefresh = async () => {
      if (cancelled) return;
      const locks = (
        navigator as Navigator & {
          locks?: {
            request: (
              name: string,
              opts: { ifAvailable?: boolean },
              cb: (lock: unknown) => Promise<void>,
            ) => Promise<void>;
          };
        }
      ).locks;

      if (locks?.request) {
        await locks.request(
          "ethiolearn:token-refresh",
          { ifAvailable: true },
          async (lock) => {
            if (!lock) return; // another tab is already refreshing — skip
            await doRefresh();
          },
        );
      } else {
        await doRefresh();
      }
    };

    const interval = setInterval(runRefresh, REFRESH_INTERVAL_MS);

    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [status]);

  return <>{children}</>;
}
