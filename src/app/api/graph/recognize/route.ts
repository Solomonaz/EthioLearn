import { NextRequest, NextResponse } from "next/server";
import { validateCsrfOrigin } from "@/lib/csrf";
import { getCurrentUser } from "@/lib/get-session";
import { rateLimit } from "@/lib/rate-limit";
import { usageActor } from "@/lib/usage-logger";
import { isAiFeatureEnabled } from "@/lib/platform-settings";
import { readEquationsFromImage } from "@/lib/gemini";
import { parseEquations } from "@/lib/graph-parse";

/**
 * POST /api/graph/recognize — read handwritten equations from an image (e.g. a
 * lasso-selected region of smartboard ink) and return plottable expressions.
 * Uses Gemini vision (free tier), gated by the platform AI switch.
 *
 * Body: { image: <base64, with or without data: prefix>, mimeType: string }
 * Returns: { equations: string[] }
 */

const ALLOWED = new Set(["image/png", "image/jpeg", "image/webp", "image/heic", "image/heif"]);
const MAX_BASE64 = 8_000_000;

export async function POST(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // Every call here spends real tokens at a paid provider, so an unmetered
  // endpoint is a cost attack as much as an availability one. 10/min per
  // user is far above human pace for vision call and still bounds the damage.
  const rl = rateLimit(`ai:graph:recognize:${user.id}`, 10, 60_000);
  if (!rl.success) {
    return NextResponse.json(
      { error: "Too many AI requests. Please wait a moment." },
      { status: 429, headers: { "Retry-After": String(rl.retryAfter) } }
    );
  }
  if (!validateCsrfOrigin(request)) {
    return NextResponse.json({ error: "Invalid request origin" }, { status: 403 });
  }
  if (!(await isAiFeatureEnabled("aiMathTools"))) {
    return NextResponse.json({ error: "Turn on AI to recognise handwriting." }, { status: 403 });
  }

  const body = await request.json().catch(() => null);
  const mimeType = String(body?.mimeType ?? "").toLowerCase();
  let image = String(body?.image ?? "");
  const comma = image.indexOf(",");
  if (image.startsWith("data:") && comma !== -1) image = image.slice(comma + 1);

  if (!image) return NextResponse.json({ error: "No image provided" }, { status: 400 });
  if (!ALLOWED.has(mimeType)) {
    return NextResponse.json({ error: "Unsupported image type" }, { status: 400 });
  }
  if (image.length > MAX_BASE64) {
    return NextResponse.json({ error: "Image is too large" }, { status: 413 });
  }

  try {
    const raw = await readEquationsFromImage(image, mimeType, usageActor(user));
    const equations = parseEquations(raw);
    if (equations.length === 0) {
      return NextResponse.json(
        { error: "Couldn't read an equation — try writing more clearly." },
        { status: 422 },
      );
    }
    return NextResponse.json({ equations });
  } catch {
    return NextResponse.json(
      { error: "AI is unavailable right now. Please try again." },
      { status: 502 },
    );
  }
}
