import { NextRequest, NextResponse } from "next/server";
import { validateCsrfOrigin } from "@/lib/csrf";
import { getCurrentUser } from "@/lib/get-session";
import { isAiFeatureEnabled } from "@/lib/platform-settings";
import { chatWithTutor } from "@/lib/ai-provider";
import { readSolidFromImage } from "@/lib/gemini";

/**
 * POST /api/geometry/shape — turn a description OR a sketch/photo of a 3D shape
 * into a spec the geometry explorer can build:
 *   { shape, sides?, w?, h?, d?, label? }
 * Body: { prompt } for text, or { image (base64), mimeType } for a picture.
 * Uses the free AI provider chain (text) / Gemini vision (image), AI-switch gated.
 */

const ALLOWED = new Set(["image/png", "image/jpeg", "image/webp", "image/heic", "image/heif"]);
const MAX_BASE64 = 8_000_000;
const SHAPES = new Set([
  "cube", "cuboid", "sphere", "cylinder", "cone", "tetrahedron", "octahedron",
  "square-pyramid", "triangular-prism", "prism", "pyramid", "antiprism", "bipyramid",
]);

/** Pull the first JSON object out of an AI reply, defensively. */
function parseSpec(text: string): Record<string, unknown> | null {
  const cleaned = text.replace(/```[a-z]*|```/gi, "");
  const m = cleaned.match(/\{[\s\S]*\}/);
  if (!m) return null;
  try {
    const o = JSON.parse(m[0]);
    return o && typeof o === "object" ? o : null;
  } catch {
    return null;
  }
}

export async function POST(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!validateCsrfOrigin(request)) {
    return NextResponse.json({ error: "Invalid request origin" }, { status: 403 });
  }
  if (!(await isAiFeatureEnabled("aiTutor"))) {
    return NextResponse.json({ error: "Turn on AI to recognise shapes." }, { status: 403 });
  }

  const body = await request.json().catch(() => null);
  const prompt = String(body?.prompt ?? "").trim();
  const mimeType = String(body?.mimeType ?? "").toLowerCase();
  let image = String(body?.image ?? "");
  const comma = image.indexOf(",");
  if (image.startsWith("data:") && comma !== -1) image = image.slice(comma + 1);

  try {
    let raw: string;
    if (image) {
      if (!ALLOWED.has(mimeType)) return NextResponse.json({ error: "Unsupported image type" }, { status: 400 });
      if (image.length > MAX_BASE64) return NextResponse.json({ error: "Image is too large" }, { status: 413 });
      raw = await readSolidFromImage(image, mimeType);
    } else if (prompt) {
      if (prompt.length > 300) return NextResponse.json({ error: "Please keep it short" }, { status: 400 });
      const instruction =
        `Convert the student's description into ONE 3D solid to display. ` +
        `Output ONLY a JSON object {"shape": string, "sides": number, "label": string}. ` +
        `"shape" must be exactly one of: cube, cuboid, sphere, cylinder, cone, tetrahedron, octahedron, ` +
        `square-pyramid, triangular-prism, prism, pyramid, antiprism, bipyramid. ` +
        `Use "sides" (3-12) only for prism/pyramid/antiprism/bipyramid. "label" is a short human name. ` +
        `Description: "${prompt}"`;
      const { response } = await chatWithTutor({
        message: instruction,
        history: [],
        content: "You translate a description of a 3D shape into a JSON spec. Reply with JSON only.",
        chapterTitle: "3D Geometry",
        subject: "Mathematics",
        grade: 10,
      });
      raw = response;
    } else {
      return NextResponse.json({ error: "Describe a shape or add a sketch." }, { status: 400 });
    }

    const spec = parseSpec(raw);
    const shape = String(spec?.shape ?? "").toLowerCase().replace(/[\s_]+/g, "-");
    if (!spec || !SHAPES.has(shape)) {
      return NextResponse.json({ error: "Couldn't recognise a solid — try a clearer sketch or wording." }, { status: 422 });
    }
    const sides = Number(spec.sides);
    return NextResponse.json({
      spec: {
        shape,
        sides: Number.isFinite(sides) ? Math.min(12, Math.max(3, Math.round(sides))) : undefined,
        label: typeof spec.label === "string" ? spec.label.slice(0, 40) : undefined,
      },
    });
  } catch {
    return NextResponse.json({ error: "AI is unavailable right now. Please try again." }, { status: 502 });
  }
}
