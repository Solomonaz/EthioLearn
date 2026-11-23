import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getCurrentUser } from "@/lib/get-session";
import { usageActor } from "@/lib/usage-logger";
import { whiteboardFromUpload } from "@/lib/gemini";
import { analysisInstructions, parseAnalysis } from "@/lib/whiteboard-lesson";
import { ownUpload, tutorGates } from "@/lib/study-uploads";

/**
 * POST /api/study-uploads/[id]/analyze — the guide reads the file and lists
 * what's in it (its questions, or the topics of a note) so the student can
 * choose what to do. Done once per upload and saved; it does not use a tutor
 * message (the daily upload cap bounds it), but keeps the tutor's gates.
 */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const gate = await tutorGates(req, user, false);
  if ("refusal" in gate) return gate.refusal;
  const { id } = await ctx.params;
  const up = await ownUpload(id, user.id);
  if (!up) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (up.analysis) return NextResponse.json({ analysis: up.analysis });

  try {
    const raw = await whiteboardFromUpload(Buffer.from(up.data).toString("base64"), up.mime, analysisInstructions(), usageActor(user));
    const analysis = parseAnalysis(raw) ?? { kind: "other", title: up.name, subject: "", items: [] };
    await db.studyUpload.update({ where: { id: up.id }, data: { analysis: analysis as object } });
    return NextResponse.json({ analysis });
  } catch (error) {
    console.error("[study-uploads/analyze]", error);
    return NextResponse.json({ error: "The guide couldn't read this right now. Please try again." }, { status: 500 });
  }
}
