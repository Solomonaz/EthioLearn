/**
 * Checks for URLs that users or admins store and the app later puts into an
 * href or src. Only web addresses (http/https) and same-site paths pass —
 * never javascript:, data:, or other schemes. Safe to import on the client.
 */
import { AVATAR_PRESETS } from "./avatar-presets";

const MAX_URL = 500;

/** An absolute http(s) URL. */
export function isHttpUrl(v: unknown): v is string {
  if (typeof v !== "string" || !v || v.length > MAX_URL) return false;
  try {
    const u = new URL(v);
    return u.protocol === "https:" || u.protocol === "http:";
  } catch {
    return false;
  }
}

/** A same-site path such as "/avatars/a.png" (not "//other.site"). */
function isSitePath(v: string): boolean {
  return v.startsWith("/") && !v.startsWith("//") && v.length <= MAX_URL;
}

/** A value allowed as User.avatarUrl: a preset ("preset:3"), a site path, or an http(s) URL. */
export function isSafeAvatar(v: unknown): v is string {
  if (typeof v !== "string") return false;
  if (v.startsWith("preset:")) return AVATAR_PRESETS.some((p) => `preset:${p.id}` === v);
  return isSitePath(v) || isHttpUrl(v);
}
