import { NextRequest } from "next/server";

/**
 * Validates that a state-changing request originates from the same site.
 *
 * Checks the `Origin` header against NEXTAUTH_URL. Falls back to `Referer`
 * when Origin is absent (can happen for same-origin navigations).
 *
 * Apply to all POST / PATCH / PUT / DELETE API routes that mutate data.
 */
export function validateCsrfOrigin(request: Request | NextRequest): boolean {
  const appUrl = process.env.NEXTAUTH_URL?.replace(/\/$/, "");

  // If NEXTAUTH_URL is not configured, skip check (avoids breaking local dev)
  if (!appUrl) return true;

  let appHost: string;
  try {
    appHost = new URL(appUrl).host;
  } catch {
    return true; // Malformed NEXTAUTH_URL — skip
  }

  // In development, accept same-machine origins so local browsing (localhost)
  // works even when NEXTAUTH_URL points at a tunnel like ngrok (needed for
  // Telegram/OAuth callbacks). Production remains strict same-host only.
  const isDev = process.env.NODE_ENV !== "production";
  const isLocalHost = (host: string) =>
    /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/i.test(host);

  const hostMatches = (value: string | null): boolean | null => {
    if (!value) return null;
    try {
      const host = new URL(value).host;
      if (host === appHost) return true;
      if (isDev && isLocalHost(host)) return true;
      return false;
    } catch {
      return false;
    }
  };

  // Prefer Origin; fall back to Referer for same-origin navigations.
  const origin = hostMatches(request.headers.get("origin"));
  if (origin !== null) return origin;

  const referer = hostMatches(request.headers.get("referer"));
  if (referer !== null) return referer;

  // Neither header present — reject
  return false;
}
