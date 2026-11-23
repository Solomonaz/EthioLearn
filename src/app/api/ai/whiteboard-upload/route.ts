import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/get-session";
import { validateCsrfOrigin } from "@/lib/csrf";
import { rateLimit } from "@/lib/rate-limit";
import { usageActor } from "@/lib/usage-logger";
import { whiteboardFromUpload } from "@/lib/gemini";
import { getEntitlements, UPGRADE_MESSAGES } from "@/lib/entitlements";
import { isAiFeatureEnabled } from "@/lib/platform-settings";
import { recordStudyActivity } from "@/lib/streak";
import {
  getTutorDailyStatus,
  recordTutorMessage,
  tutorLimitMessage,
  tutorLimitReached,
} from "@/lib/tutor-allowance";
import { lessonFromProse, parseWhiteboardLesson, uploadInstructions } from "@/lib/whiteboard-lesson";
import { lessonPayload } from "@/lib/whiteboard-voice";
import { pdfPageCount } from "@/lib/pdf-text";


/**
 * POST /api/ai/whiteboard-upload — { file: base64, mimeType, note? }
 *
 * A student sends a photo or a small PDF of schoolwork and the Abugida guide
 * explains it on the whiteboard (same lesson format and voice as "Why was I
 * wrong?"). It is the AI tutor answering one message, so it keeps every tutor
 * rule: Pro, the aiTutor switch, CSRF, the shared tutor rate limit and the
 * daily allowance (one explanation = one tutor message).
 *
 * The file is checked by its real bytes (not just the claimed type), kept
 * small (4 MB, PDFs at most 5 pages) and never stored: it is sent to the
 * vision model once and dropped.
 */

const MAX_BYTES = 4 * 1024 * 1024;
const MAX_PDF_PAGES = 5;
const MAX_NOTE = 300;

const SIGNATURES: Record<string, (b: Buffer) => boolean> = {
  "image/jpeg": (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff,
  "image/png": (b) => b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])),
  "image/webp": (b) => b.subarray(0, 4).toString("latin1") === "RIFF" && b.subarray(8, 12).toString("latin1") === "WEBP",
  "application/pdf": (b) => b.subarray(0, 5).toString("latin1") === "%PDF-",
};

export async function POST(req: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!validateCsrfOrigin(req)) {
    return NextResponse.json({ error: "Invalid request origin" }, { status: 403 });
  }
  const rl = rateLimit(`ai:tutor:${user.id}`, 20, 60_000);
  if (!rl.success) {
    return NextResponse.json(
      { error: "Too many AI requests. Please wait a moment." },
      { status: 429, headers: { "Retry-After": String(rl.retryAfter) } },
    );
  }
  const ent = await getEntitlements(user);
  if (!ent.ai) {
    return NextResponse.json({ error: UPGRADE_MESSAGES.ai, code: "UPGRADE_REQUIRED" }, { status: 403 });
  }
  if (!(await isAiFeatureEnabled("aiTutor"))) {
    return NextResponse.json({ error: "The AI tutor is currently turned off.", code: "AI_DISABLED" }, { status: 503 });
  }
  const capped = user.role !== "SUPER_ADMIN";
  const daily = capped ? await getTutorDailyStatus(user.id) : null;
  if (daily && tutorLimitReached(daily)) {
    return NextResponse.json(
      { error: tutorLimitMessage(daily.limit!), code: "DAILY_LIMIT", remainingToday: 0 },
      { status: 429 },
    );
  }

  const body = (await req.json().catch(() => null)) as { file?: unknown; mimeType?: unknown; note?: unknown } | null;
  const mimeType = typeof body?.mimeType === "string" ? body.mimeType.toLowerCase() : "";
  let b64 = typeof body?.file === "string" ? body.file : "";
  if (b64.startsWith("data:")) b64 = b64.slice(b64.indexOf(",") + 1);
  if (!b64 || !SIGNATURES[mimeType]) {
    return NextResponse.json({ error: "Send a photo (JPG, PNG, WebP) or a PDF.", code: "BAD_FILE" }, { status: 400 });
  }
  if (b64.length > Math.ceil((MAX_BYTES * 4) / 3) + 8) {
    return NextResponse.json({ error: "That file is too big (4 MB max).", code: "TOO_BIG" }, { status: 413 });
  }
  const bytes = Buffer.from(b64, "base64");
  if (bytes.length === 0 || bytes.length > MAX_BYTES || !SIGNATURES[mimeType](bytes)) {
    return NextResponse.json({ error: "That file doesn't look like a photo or a PDF.", code: "BAD_FILE" }, { status: 400 });
  }
  if (mimeType === "application/pdf") {
    let pages = 0;
    try {
      pages = await pdfPageCount(bytes);
    } catch (err) {
      console.error("[whiteboard-upload] unreadable PDF:", err instanceof Error ? err.message : err);
      return NextResponse.json({ error: "That PDF couldn't be opened.", code: "BAD_FILE" }, { status: 400 });
    }
    if (pages > MAX_PDF_PAGES) {
      return NextResponse.json(
        { error: `That PDF has ${pages} pages — send at most ${MAX_PDF_PAGES}.`, code: "TOO_MANY_PAGES" },
        { status: 413 },
      );
    }
  }
  const note =
    typeof body?.note === "string"
      ? body.note.replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/"""/g, "\"").trim().slice(0, MAX_NOTE)
      : "";

  try {
    const raw = await whiteboardFromUpload(
      bytes.toString("base64"),
      mimeType,
      uploadInstructions(note, user.grade ?? null),
      usageActor(user),
    );
    const lesson = parseWhiteboardLesson(raw) ?? lessonFromProse(raw);
    const usedToday = capped ? await recordTutorMessage(user.id) : null;
    if (user.role === "STUDENT") await recordStudyActivity(user.id, "tutor");
    const limit = daily?.limit ?? null;
    return NextResponse.json({
      ...lessonPayload(user.id, lesson, "upload"),
      remainingToday: limit !== null && usedToday !== null ? Math.max(0, limit - usedToday) : null,
    });
  } catch (error) {
    console.error("[whiteboard-upload]", error);
    return NextResponse.json({ error: "The tutor couldn't read this right now. Please try again." }, { status: 500 });
  }
}
