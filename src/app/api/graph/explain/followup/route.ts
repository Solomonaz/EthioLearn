import { NextRequest, NextResponse } from "next/server";
import { validateCsrfOrigin } from "@/lib/csrf";
import { getCurrentUser } from "@/lib/get-session";
import { usageActor } from "@/lib/usage-logger";
import { isAiFeatureEnabled } from "@/lib/platform-settings";
import { askAboutGraph } from "@/lib/gemini";

/**
 * POST /api/graph/explain/followup — a student asks a follow-up question about a
 * graph image they uploaded. Returns a short plain-text answer.
 *
 * Body: { image, mimeType, question, history?: {role,text}[] }
 */

const ALLOWED = new Set(["image/png", "image/jpeg", "image/webp", "image/heic", "image/heif"]);
const MAX_BASE64 = 8_000_000;

export async function POST(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!validateCsrfOrigin(request)) {
    return NextResponse.json({ error: "Invalid request origin" }, { status: 403 });
  }
  if (!(await isAiFeatureEnabled("aiMathTools"))) {
    return NextResponse.json({ error: "AI is turned off" }, { status: 403 });
  }

  const body = await request.json().catch(() => null);
  const mimeType = String(body?.mimeType ?? "").toLowerCase();
  const question = String(body?.question ?? "").trim().slice(0, 300);
  let image = String(body?.image ?? "");
  const comma = image.indexOf(",");
  if (image.startsWith("data:") && comma !== -1) image = image.slice(comma + 1);

  if (!image) return NextResponse.json({ error: "No image provided" }, { status: 400 });
  if (!question) return NextResponse.json({ error: "Ask a question" }, { status: 400 });
  if (!ALLOWED.has(mimeType)) {
    return NextResponse.json({ error: "Unsupported image type" }, { status: 400 });
  }
  if (image.length > MAX_BASE64) {
    return NextResponse.json({ error: "Image is too large" }, { status: 413 });
  }

  const history = Array.isArray(body?.history)
    ? (body.history as unknown[])
        .filter(
          (h): h is { role: unknown; text: unknown } => !!h && typeof h === "object",
        )
        .map((h) => ({
          role: h.role === "assistant" ? ("assistant" as const) : ("user" as const),
          text: String(h.text ?? "").slice(0, 500),
        }))
        .filter((h) => h.text)
        .slice(-6)
    : [];

  try {
    const answer = (await askAboutGraph(image, mimeType, question, history, usageActor(user))).trim();
    if (!answer) {
      return NextResponse.json({ error: "No answer — try rephrasing." }, { status: 422 });
    }
    return NextResponse.json({ answer });
  } catch {
    return NextResponse.json(
      { error: "AI is unavailable right now. Please try again." },
      { status: 502 },
    );
  }
}
