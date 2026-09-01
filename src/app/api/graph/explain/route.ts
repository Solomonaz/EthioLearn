import { NextRequest, NextResponse } from "next/server";
import { compile } from "mathjs";
import { validateCsrfOrigin } from "@/lib/csrf";
import { getCurrentUser } from "@/lib/get-session";
import { isAiFeatureEnabled } from "@/lib/platform-settings";
import { explainGraphImage } from "@/lib/gemini";
import { parseEquations } from "@/lib/graph-parse";

/** Strip stray markdown (bold **, backticks, leading bullet marks) from text. */
function stripMd(s: string): string {
  return String(s)
    .replace(/\*\*/g, "")
    .replace(/`/g, "")
    .replace(/^[\s>•\-–—*]+/, "")
    .trim();
}

/**
 * Drop equations that don't compile, and collapse mathematically-equivalent
 * duplicates (e.g. `0.1*f(x)` and `f(x)/10`) by sampling each at fixed x-values
 * and keeping one per unique value-signature. Returns clean, distinct expressions.
 */
function dedupeEquations(eqs: string[]): string[] {
  const SAMPLES = [-2.3, -1, 0.4, 1.7, 3.1];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of eqs) {
    const e = raw
      .trim()
      .replace(/^\s*(?:[yY]|[fFgGhH]\s*\(\s*[xX]\s*\))\s*=\s*/, "")
      .replace(/\bln\s*\(/gi, "log(");
    if (!e) continue;
    let fn: { evaluate: (s: Record<string, number>) => unknown };
    try {
      fn = compile(e);
    } catch {
      continue; // not a valid expression → drop
    }
    const sig = SAMPLES.map((x) => {
      try {
        const v = fn.evaluate({ x });
        return typeof v === "number" && Number.isFinite(v) ? Math.round(v * 1000) / 1000 : "·";
      } catch {
        return "·";
      }
    }).join("|");
    if (seen.has(sig)) continue; // same curve as an earlier one → drop
    seen.add(sig);
    out.push(e);
    if (out.length >= 2) break;
  }
  return out;
}

/**
 * POST /api/graph/explain — a student uploads/snaps a photo of a GRAPH and gets
 * a student-friendly explanation of it, plus 0–3 likely equations they can plot.
 * Uses Gemini vision (multimodal, free tier), gated by the platform AI switch.
 *
 * Body: { image: <base64, with or without data: prefix>, mimeType: string }
 * Returns: { explanation: string, equations: string[] }
 */

const ALLOWED = new Set(["image/png", "image/jpeg", "image/webp", "image/heic", "image/heif"]);
const MAX_BASE64 = 8_000_000; // ~6 MB image

export async function POST(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!validateCsrfOrigin(request)) {
    return NextResponse.json({ error: "Invalid request origin" }, { status: 403 });
  }
  if (!(await isAiFeatureEnabled("aiTutor"))) {
    return NextResponse.json({ error: "Turn on AI to explain graphs." }, { status: 403 });
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
    const raw = await explainGraphImage(image, mimeType);

    // The reply should be a JSON object; parse it defensively.
    let summary = "";
    let features: { label: string; value: string }[] = [];
    let equations: string[] = [];
    const cleaned = raw.replace(/```[a-z]*|```/gi, "").trim();
    const objMatch = cleaned.match(/\{[\s\S]*\}/);
    if (objMatch) {
      try {
        const obj = JSON.parse(objMatch[0]);
        // `summary` (new) or `explanation` (older shape)
        const s = typeof obj.summary === "string" ? obj.summary : obj.explanation;
        if (typeof s === "string") summary = stripMd(s);
        if (Array.isArray(obj.features)) {
          features = (obj.features as unknown[])
            .filter(
              (f): f is { label: unknown; value: unknown } => !!f && typeof f === "object",
            )
            .map((f) => ({
              label: stripMd(String(f.label ?? "")),
              value: stripMd(String(f.value ?? "")),
            }))
            .filter((f) => f.label && f.value)
            .slice(0, 8);
        }
        if (Array.isArray(obj.equations)) {
          equations = obj.equations
            .filter((s: unknown) => typeof s === "string")
            .map((s: string) => s.trim())
            .filter(Boolean);
        }
      } catch {
        /* fall through */
      }
    }
    // Fallbacks if the model didn't return clean JSON.
    if (!summary) summary = stripMd(cleaned);
    if (equations.length === 0) equations = parseEquations(cleaned);

    // Drop invalid expressions and collapse equivalent duplicates.
    equations = dedupeEquations(equations);

    if (!summary && features.length === 0) {
      return NextResponse.json(
        { error: "Couldn't read that image — try a clearer photo of the graph." },
        { status: 422 },
      );
    }
    return NextResponse.json({ summary, features, equations });
  } catch {
    return NextResponse.json(
      { error: "AI is unavailable right now. Please try again." },
      { status: 502 },
    );
  }
}
