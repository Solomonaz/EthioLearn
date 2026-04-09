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

  const origin = request.headers.get("origin");
  if (origin) {
    try {
      return new URL(origin).host === appHost;
    } catch {
      return false;
    }
  }

  // No Origin header — fall back to Referer
  const referer = request.headers.get("referer");
  if (referer) {
    try {
      return new URL(referer).host === appHost;
    } catch {
      return false;
    }
  }

  // Neither header present — reject
  return false;
}
