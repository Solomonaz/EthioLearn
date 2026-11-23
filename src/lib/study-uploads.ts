/**
 * Study uploads: photos / small PDFs a student sends to the Whiteboard.
 *
 * Shared rules for the /api/study-uploads routes. Every AI call keeps the AI
 * tutor's gates (Pro, the aiTutor switch, CSRF, the shared tutor rate limit;
 * explanations and practice sets also use one daily tutor message). Files are
 * checked by their real bytes, owner-only, and deleted after 7 days.
 */
import { NextResponse } from "next/server";
import { db } from "./db";
import { validateCsrfOrigin } from "./csrf";
import { rateLimit } from "./rate-limit";
import { getEntitlements, UPGRADE_MESSAGES } from "./entitlements";
import { getPlatformSettings, isAiFeatureEnabled } from "./platform-settings";
import { getTutorDailyStatus, tutorLimitMessage, tutorLimitReached } from "./tutor-allowance";
import { pdfPageCount } from "./pdf-text";
import type { getCurrentUser } from "./get-session";

export type SessionUser = NonNullable<Awaited<ReturnType<typeof getCurrentUser>>>;

export const MAX_UPLOAD_BYTES = 4 * 1024 * 1024;
export const MAX_PDF_PAGES = 5;
export const KEEP_DAYS = 7;
const DAY_MS = 86_400_000;

const SIGNATURES: Record<string, (b: Buffer) => boolean> = {
  "image/jpeg": (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff,
  "image/png": (b) => b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])),
  "image/webp": (b) => b.subarray(0, 4).toString("latin1") === "RIFF" && b.subarray(8, 12).toString("latin1") === "WEBP",
  "application/pdf": (b) => b.subarray(0, 5).toString("latin1") === "%PDF-",
};

const refuse = (status: number, error: string, code?: string, extra?: Record<string, unknown>) =>
  NextResponse.json({ error, ...(code ? { code } : {}), ...extra }, { status });

/**
 * The AI-tutor gates for a study-upload request. Returns a refusal response,
 * or the daily-allowance status (null when uncapped) to record usage against.
 * `needsMessage`: the action will use one tutor message, so refuse when none
 * are left today.
 */
export async function tutorGates(
  req: Request,
  user: SessionUser,
  needsMessage: boolean,
): Promise<{ refusal: NextResponse } | { daily: Awaited<ReturnType<typeof getTutorDailyStatus>> | null }> {
  if (!validateCsrfOrigin(req)) return { refusal: refuse(403, "Invalid request origin") };
  const rl = rateLimit(`ai:tutor:${user.id}`, 20, 60_000);
  if (!rl.success) {
    return {
      refusal: NextResponse.json(
        { error: "Too many AI requests. Please wait a moment." },
        { status: 429, headers: { "Retry-After": String(rl.retryAfter) } },
      ),
    };
  }
  const ent = await getEntitlements(user);
  if (!ent.ai) return { refusal: refuse(403, UPGRADE_MESSAGES.ai, "UPGRADE_REQUIRED") };
  if (!(await isAiFeatureEnabled("aiTutor"))) return { refusal: refuse(503, "The AI tutor is currently turned off.", "AI_DISABLED") };
  const capped = user.role !== "SUPER_ADMIN";
  const daily = capped ? await getTutorDailyStatus(user.id) : null;
  if (needsMessage && daily && tutorLimitReached(daily)) {
    return { refusal: refuse(429, tutorLimitMessage(daily.limit!), "DAILY_LIMIT", { remainingToday: 0 }) };
  }
  return { daily };
}

/** Check an uploaded file by its real bytes. Returns the bytes or a refusal. */
export async function checkFile(
  file: unknown,
  mimeType: unknown,
): Promise<{ bytes: Buffer; mime: string; pages: number | null } | { refusal: NextResponse }> {
  const mime = typeof mimeType === "string" ? mimeType.toLowerCase() : "";
  let b64 = typeof file === "string" ? file : "";
  if (b64.startsWith("data:")) b64 = b64.slice(b64.indexOf(",") + 1);
  if (!b64 || !SIGNATURES[mime]) return { refusal: refuse(400, "Send a photo (JPG, PNG, WebP) or a PDF.", "BAD_FILE") };
  if (b64.length > Math.ceil((MAX_UPLOAD_BYTES * 4) / 3) + 8) return { refusal: refuse(413, "That file is too big (4 MB max).", "TOO_BIG") };
  const bytes = Buffer.from(b64, "base64");
  if (bytes.length === 0 || bytes.length > MAX_UPLOAD_BYTES || !SIGNATURES[mime](bytes)) {
    return { refusal: refuse(400, "That file doesn't look like a photo or a PDF.", "BAD_FILE") };
  }
  let pages: number | null = null;
  if (mime === "application/pdf") {
    try {
      pages = await pdfPageCount(bytes);
    } catch (err) {
      console.error("[study-uploads] unreadable PDF:", err instanceof Error ? err.message : err);
      return { refusal: refuse(400, "That PDF couldn't be opened.", "BAD_FILE") };
    }
    if (pages > MAX_PDF_PAGES) {
      return { refusal: refuse(413, `That PDF has ${pages} pages — send at most ${MAX_PDF_PAGES}.`, "TOO_MANY_PAGES") };
    }
  }
  return { bytes, mime, pages };
}

/** How many files a student may upload per day (the tutor's daily message limit, at least 10). */
export async function dailyUploadLimit(): Promise<number> {
  const s = await getPlatformSettings();
  return Math.max(10, s.tutorDailyMessageLimit ?? 30);
}

export async function uploadsToday(userId: string): Promise<number> {
  return db.studyUpload.count({ where: { userId, createdAt: { gte: new Date(Date.now() - DAY_MS) } } });
}

/** Drop everyone's uploads older than KEEP_DAYS (cheap: indexed by createdAt). */
export async function pruneOldUploads(): Promise<void> {
  await db.studyUpload.deleteMany({ where: { createdAt: { lt: new Date(Date.now() - KEEP_DAYS * DAY_MS) } } }).catch(() => {});
}

/** The student's own, still-kept upload (null for anyone else's, or expired). */
export async function ownUpload(id: unknown, userId: string) {
  if (typeof id !== "string" || id.length > 40) return null;
  return db.studyUpload.findFirst({
    where: { id, userId, createdAt: { gte: new Date(Date.now() - KEEP_DAYS * DAY_MS) } },
  });
}

/* ── Results already made from an upload (replayed for free) ── */

export interface StoredResult {
  key: string;
  kind: "lesson" | "practice";
  action: string;
  target: string | null;
  at: string;
  title: string;
  payload: unknown;
}

export function readResults(raw: unknown): StoredResult[] {
  return Array.isArray(raw) ? (raw as StoredResult[]).filter((r) => r && typeof r.key === "string") : [];
}

export function resultKey(action: string, target: string | null, count?: number): string {
  return `${action}:${(target ?? "").trim().toLowerCase().slice(0, 200)}${count ? `:${count}` : ""}`;
}

/** Add a result, keeping the newest 30. */
export function withResult(raw: unknown, r: StoredResult): StoredResult[] {
  return [r, ...readResults(raw).filter((x) => x.key !== r.key)].slice(0, 30);
}
