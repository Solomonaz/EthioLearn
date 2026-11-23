import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getCurrentUser } from "@/lib/get-session";
import { usageActor } from "@/lib/usage-logger";
import { whiteboardFromUpload } from "@/lib/gemini";
import { recordStudyActivity } from "@/lib/streak";
import { recordTutorMessage } from "@/lib/tutor-allowance";
import { getVoiceConfig } from "@/lib/tts";
import {
  lessonFromProse,
  parsePractice,
  parseWhiteboardLesson,
  practiceInstructions,
  studyInstructions,
} from "@/lib/whiteboard-lesson";
import { lessonPayload } from "@/lib/whiteboard-voice";
import { ownUpload, readResults, resultKey, tutorGates, withResult } from "@/lib/study-uploads";

/**
 * POST /api/study-uploads/[id]/act — { action, target?, count? }
 *
 * What the student chose to do with their upload:
 *   "explain"   → a whiteboard lesson solving / explaining `target` (a question
 *                 id like "1a", or their own words), or the whole thing;
 *   "summarize" → a whiteboard revision lesson of the key points;
 *   "practice"  → `count` (5 or 10) new multiple-choice questions from it.
 * Each new one uses one daily tutor message and keeps every tutor rule. The
 * result is saved on the upload, so asking for the same thing again replays it
 * without spending another message.
 */
const ACTIONS = ["explain", "summarize", "practice"] as const;
type Action = (typeof ACTIONS)[number];

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = (await req.json().catch(() => null)) as { action?: unknown; target?: unknown; count?: unknown } | null;
  const action = (ACTIONS as readonly string[]).includes(String(body?.action)) ? (body!.action as Action) : null;
  if (!action) return NextResponse.json({ error: "Choose explain, summarize or practice." }, { status: 400 });
  if (body?.target !== undefined && body?.target !== null && (typeof body.target !== "string" || body.target.length > 200)) {
    return NextResponse.json({ error: "Keep your request under 200 characters." }, { status: 400 });
  }
  const target =
    typeof body?.target === "string" && body.target.trim()
      ? body.target.replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/"""/g, '"').trim()
      : null;
  const count = action === "practice" ? (body?.count === 10 ? 10 : 5) : undefined;
  if (action === "summarize" && target) return NextResponse.json({ error: "Summaries cover the whole file." }, { status: 400 });

  const { id } = await ctx.params;
  // Ownership first (cheap) so someone else's id never reaches the gates' counters.
  const up = await ownUpload(id, user.id);
  if (!up) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const key = resultKey(action, target, count);
  const stored = readResults(up.results).find((r) => r.key === key);
  const gate = await tutorGates(req, user, !stored);
  if ("refusal" in gate) return gate.refusal;
  if (stored) return NextResponse.json({ kind: stored.kind, key, cached: true, ...(stored.payload as object) });

  const style = (await getVoiceConfig()).tutorStyle;
  const b64 = Buffer.from(up.data).toString("base64");
  try {
    let kind: "lesson" | "practice";
    let payload: Record<string, unknown>;
    let title: string;
    if (action === "practice") {
      const raw = await whiteboardFromUpload(b64, up.mime, practiceInstructions(count!, target, user.grade ?? null, style), usageActor(user));
      const questions = parsePractice(raw, count!);
      if (questions.length === 0) {
        return NextResponse.json(
          { error: "I couldn't make questions from this file. Try a clearer photo of schoolwork.", code: "NO_QUESTIONS" },
          { status: 422 },
        );
      }
      kind = "practice";
      payload = { questions, style };
      title = `${questions.length} practice questions`;
    } else {
      const raw = await whiteboardFromUpload(b64, up.mime, studyInstructions(action, target, user.grade ?? null, style), usageActor(user));
      const lesson = parseWhiteboardLesson(raw) ?? lessonFromProse(raw);
      kind = "lesson";
      payload = { ...lessonPayload(user.id, lesson, "upload", style) };
      title = lesson.title;
    }

    const daily = gate.daily;
    const usedToday = daily ? await recordTutorMessage(user.id) : null;
    if (user.role === "STUDENT") await recordStudyActivity(user.id, "tutor");
    await db.studyUpload.update({
      where: { id: up.id },
      data: {
        results: withResult(up.results, {
          key,
          kind,
          action,
          target,
          at: new Date().toISOString(),
          title,
          payload,
        }) as object[],
      },
    });
    const limit = daily?.limit ?? null;
    return NextResponse.json({
      kind,
      key,
      cached: false,
      ...payload,
      remainingToday: limit !== null && usedToday !== null ? Math.max(0, limit - usedToday) : null,
    });
  } catch (error) {
    console.error("[study-uploads/act]", error);
    return NextResponse.json({ error: "The guide couldn't do this right now. Please try again." }, { status: 500 });
  }
}
