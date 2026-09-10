import { NextRequest, NextResponse } from "next/server";
import { validateCsrfOrigin } from "@/lib/csrf";
import { getCurrentUser } from "@/lib/get-session";
import { usageActor } from "@/lib/usage-logger";
import { isAiFeatureEnabled } from "@/lib/platform-settings";
import { getEntitlements } from "@/lib/entitlements";
import { chatWithTutor } from "@/lib/ai-provider";

/**
 * POST /api/geometry/ai — answer a student's question about the 3D solid they
 * are exploring. The client sends the current solid's context (name, V/E/F,
 * surface area, volume, any selected face/vertex) so answers stay grounded in
 * what's on screen. Uses the free AI provider chain, gated by the AI switch.
 */
export async function POST(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!validateCsrfOrigin(request)) {
    return NextResponse.json({ error: "Invalid request origin" }, { status: 403 });
  }
  if (!(await isAiFeatureEnabled("aiMathTools"))) {
    return NextResponse.json({ error: "AI is turned off" }, { status: 403 });
  }
  if (!(await getEntitlements(user)).mathTools) {
    return NextResponse.json({ error: "The 3D geometry lab isn't included in your plan." }, { status: 403 });
  }

  const body = await request.json().catch(() => null);
  const question = String(body?.question ?? "").trim();
  const ctx = body?.context ?? {};
  if (!question) return NextResponse.json({ error: "Ask a question" }, { status: 400 });
  if (question.length > 500) return NextResponse.json({ error: "Please keep it short" }, { status: 400 });

  const hasCounts =
    Number.isFinite(Number(ctx.V)) && Number.isFinite(Number(ctx.E)) && Number.isFinite(Number(ctx.F));
  const isEmpty = !hasCounts && (ctx.name == null || ctx.name === "empty board");

  const facts = isEmpty
    ? `The student has an empty 3D geometry board (no solid on it yet) in an interactive explorer. ` +
      `They can draw a shape, pick a preset, or build one from vertex/edge/face counts.\n`
    : `The student is looking at a 3D solid in an interactive geometry explorer.\n` +
      `Solid: ${ctx.name ?? "unknown"}.\n` +
      (hasCounts ? `Vertices (V): ${ctx.V}, Edges (E): ${ctx.E}, Faces (F): ${ctx.F}.\n` : "") +
      (ctx.surfaceArea != null
        ? `Surface area ≈ ${ctx.surfaceArea} square units, Volume ≈ ${ctx.volume} cubic units (abstract units).\n`
        : "") +
      (ctx.selectedFace ? `They have selected a face: a ${ctx.selectedFace.sides}-sided polygon of area ≈ ${ctx.selectedFace.area} u².\n` : "") +
      (ctx.selectedVertex ? `They have selected a vertex at (${(ctx.selectedVertex as number[]).join(", ")}).\n` : "");

  const instruction =
    facts +
    `\nAnswer the student's question about THIS solid clearly and encouragingly, at a school level. ` +
    `Use the numbers above when relevant, keep it to a short paragraph (no markdown headings), and if a formula helps, show it in plain text. ` +
    `\n\nQuestion: "${question}"`;

  try {
    const { response } = await chatWithTutor({
      actor: usageActor(user),
      message: instruction,
      history: [],
      content: "You are a friendly geometry tutor helping a student understand a 3D solid they are viewing. Reply in plain text.",
      chapterTitle: "3D Geometry",
      subject: "Mathematics",
      grade: 10,
    });
    const answer = String(response ?? "").trim();
    if (!answer) return NextResponse.json({ error: "Couldn't answer that — try rephrasing." }, { status: 422 });
    return NextResponse.json({ answer });
  } catch {
    return NextResponse.json({ error: "AI is unavailable right now. Please try again." }, { status: 502 });
  }
}
