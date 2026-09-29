import crypto from "crypto";
import { promisify } from "util";
import { db } from "./db";

/**
 * Password sign-in.
 *
 * Hashing uses Node's built-in scrypt (no native dependency), stored as
 * "scrypt$<salt>$<hash>" so the parameters can change later without breaking
 * existing hashes.
 *
 * Who has a password:
 *   • Self-registered students set one at sign-up (email + password).
 *   • Admin-created teachers and school admins are created with an email and
 *     NO password; they sign in with Google, or set one through "Forgot
 *     password" (which proves they own the email).
 *   • Students a school creates get a username and a TEMPORARY password to
 *     hand out, and must replace it at first sign-in (`mustChangePassword`).
 */

const scrypt = promisify(crypto.scrypt) as (
  password: string,
  salt: Buffer,
  keylen: number,
) => Promise<Buffer>;

const KEY_LENGTH = 64;

// Deliberately simple (user decision): a length floor and nothing else. Mixed
// character rules made students and teachers pick worse passwords and forget
// them; the per-account sign-in rate limit is what stops guessing.
export const MIN_PASSWORD_LENGTH = 6;
const MAX_PASSWORD_LENGTH = 128;

/** Why a new password is unacceptable, or null when it is fine. */
export function passwordProblem(password: unknown): string | null {
  if (typeof password !== "string" || password.length < MIN_PASSWORD_LENGTH) {
    return `Use at least ${MIN_PASSWORD_LENGTH} characters.`;
  }
  if (password.length > MAX_PASSWORD_LENGTH) {
    return `Use at most ${MAX_PASSWORD_LENGTH} characters.`;
  }
  return null;
}

export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.randomBytes(16);
  const hash = await scrypt(password, salt, KEY_LENGTH);
  return `scrypt$${salt.toString("base64")}$${hash.toString("base64")}`;
}

export async function verifyPassword(password: string, stored: string | null): Promise<boolean> {
  if (!stored) return false;
  const [scheme, saltB64, hashB64] = stored.split("$");
  if (scheme !== "scrypt" || !saltB64 || !hashB64) return false;
  const expected = Buffer.from(hashB64, "base64");
  const actual = await scrypt(password, Buffer.from(saltB64, "base64"), expected.length);
  return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
}

/** Constant-time comparison of two secrets of any length. */
export function safeEqual(a: string, b: string): boolean {
  const ha = crypto.createHash("sha256").update(a).digest();
  const hb = crypto.createHash("sha256").update(b).digest();
  return crypto.timingSafeEqual(ha, hb);
}

// ─── School-issued student credentials ────────────────────────────────────

// No 0/O or 1/l/I: these are read off paper and typed by children.
const READABLE = "abcdefghjkmnpqrstuvwxyz23456789";

function readable(length: number): string {
  const bytes = crypto.randomBytes(length);
  return Array.from(bytes, (b) => READABLE[b % READABLE.length]).join("");
}

/** A temporary password to print for a student, e.g. "k4mt-7xp3": short and easy to read off paper. */
export function generateTempPassword(): string {
  return `${readable(4)}-${readable(3)}${crypto.randomInt(2, 10)}`;
}

/**
 * A unique username from a student's name, e.g. "abebe.kebede" or
 * "abebe.kebede7". Letters outside a-z (e.g. Ge'ez script) are dropped; a
 * name with none left falls back to "student". `reserved` holds names already
 * handed out in the same batch (a CSV import) that are not in the database yet.
 */
export async function generateUsername(name: string, reserved?: Set<string>): Promise<string> {
  const base =
    name
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[^a-z\s]/g, "")
      .trim()
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .join(".")
      .slice(0, 20) || "student";

  for (let attempt = 0; attempt < 20; attempt++) {
    const candidate = attempt === 0 ? base : `${base}${crypto.randomInt(2, 1000)}`;
    if (reserved?.has(candidate)) continue;
    const taken = await db.user.findUnique({ where: { username: candidate }, select: { id: true } });
    if (!taken) {
      reserved?.add(candidate);
      return candidate;
    }
  }
  const fallback = `${base}.${readable(5)}`;
  reserved?.add(fallback);
  return fallback;
}

/** Usernames are compared lower-case; this is how they are stored and looked up. */
export function normalizeUsername(raw: string): string {
  return raw.trim().toLowerCase();
}

// ─── Password reset links ─────────────────────────────────────────────────
//
// Stored in the existing `otp_codes` table under the key "pwreset:<userId>",
// hashed exactly as the table always stores codes, so a database leak does not
// leak working links. One live link per user: asking again replaces it.

const RESET_TTL_MS = 60 * 60 * 1000; // 1 hour

function sha256(v: string): string {
  return crypto.createHash("sha256").update(v).digest("hex");
}

/** Create a reset token for a user and return it (to be put in the emailed link). */
export async function createResetToken(userId: string): Promise<string> {
  const token = crypto.randomBytes(32).toString("base64url");
  const key = `pwreset:${userId}`;
  const expiresAt = new Date(Date.now() + RESET_TTL_MS);
  await db.otpCode.upsert({
    where: { key },
    create: { key, code: sha256(token), expiresAt },
    update: { code: sha256(token), expiresAt },
  });
  return `${userId}.${token}`;
}

/**
 * Consume a reset token. Returns the user id it was issued for, or null when
 * it is unknown, used or expired. Single use: it is deleted either way.
 */
export async function consumeResetToken(raw: string): Promise<string | null> {
  const dot = raw.indexOf(".");
  if (dot <= 0) return null;
  const userId = raw.slice(0, dot);
  const token = raw.slice(dot + 1);
  const key = `pwreset:${userId}`;

  const row = await db.otpCode.findUnique({ where: { key } });
  if (!row) return null;
  if (row.expiresAt < new Date() || !safeEqual(row.code, sha256(token))) {
    if (row.expiresAt < new Date()) await db.otpCode.delete({ where: { key } }).catch(() => {});
    return null;
  }
  await db.otpCode.delete({ where: { key } }).catch(() => {});
  return userId;
}
