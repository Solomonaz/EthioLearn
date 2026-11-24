import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getCurrentUser } from "@/lib/get-session";
import { validateCsrfOrigin } from "@/lib/csrf";
import { usageActor } from "@/lib/usage-logger";
import { whiteboardFromUpload } from "@/lib/gemini";
import { recordStudyActivity } from "@/lib/streak";
import { recordTutorMessage } from "@/lib/tutor-allowance";
import { getVoiceConfig } from "@/lib/tts";
import {
  isTutorStyle,
  lessonFromProse,
  parsePractice,
  parseWhiteboardLesson,
  practiceInstructions,
  practiceMistakeContext,
  studyInstructions,
  whiteboardInstructions,
  type PracticeQuestion,
} from "@/lib/whiteboard-lesson";
import { lessonPayload, practiceVoice } from "@/lib/whiteboard-voice";
import { ownUpload, readResults, resultKey, tutorGates, withResult } from "@/lib/study-uploads";

/**
 * POST /api/study-uploads/[id]/act — { action, target?, count? }
 *
 * What the student chose to do with their upload:
 *   "explain"   → a whiteboard lesson solving / explaining `target` (a question
 *                 id like "1a", or their own words), or the whole thing;
 *   "summarize" → a whiteboard revision lesson of the key points;
 *   "practice"  → `count` (5 or 10) new multiple-choice questions from it,
 *                 with every line the guide may say about them (each question
 *                 and its choices read aloud, a reaction to each answer),
 *                 signed for the voice service;
 *   "explainPractice" { set, index, picked } → a whiteboard lesson on a
 *                 practice question the student just got wrong. The question
 *                 comes from the stored set (never from the page), so the
 *                 lesson knows the real answer.
 * Each new one uses one daily tutor message and keeps every tutor rule. The
 * result is saved on the upload, so asking for the same thing again replays it
 * without spending another message.
 */
const ACTIONS = ["explain", "summarize", "practice", "explainPractice"] as const;
type Action = (typeof ACTIONS)[number];

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!validateCsrfOrigin(req)) return NextResponse.json({ error: "Invalid request origin" }, { status: 403 });

  const body = (await req.json().catch(() => null)) as
    | { action?: unknown; target?: unknown; count?: unknown; set?: unknown; index?: unknown; picked?: unknown }
    | null;
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
  let ref: { set: string; index: number; picked: number } | null = null;
  if (action === "explainPractice") {
    const { set, index, picked } = body ?? {};
    if (
      typeof set !== "string" || !set.startsWith("practice:") || set.length > 220 ||
      !Number.isInteger(index) || (index as number) < 0 || (index as number) > 9 ||
      !Number.isInteger(picked) || (picked as number) < 0 || (picked as number) > 3 ||
      target
    ) {
      return NextResponse.json({ error: "Invalid practice question." }, { status: 400 });
    }
    ref = { set, index: index as number, picked: picked as number };
  }

  const { id } = await ctx.params;
  // Ownership first (cheap) so someone else's id never reaches the gates' counters.
  const up = await ownUpload(id, user.id);
  if (!up) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const results = readResults(up.results);
  // The practice question to explain, from the stored set.
  let missed: PracticeQuestion | null = null;
  if (ref) {
    const set = results.find((r) => r.key === ref.set && r.kind === "practice");
    const q = (set?.payload as { questions?: PracticeQuestion[] } | undefined)?.questions?.[ref.index];
    if (!q) return NextResponse.json({ error: "That practice question is gone." }, { status: 404 });
    if (q.answer === ref.picked) return NextResponse.json({ error: "That answer was right." }, { status: 400 });
    missed = q;
  }

  const key = resultKey(action, ref ? `${ref.set}#${ref.index}#${ref.picked}` : target, count);
  const stored = results.find((r) => r.key === key);
  const gate = await tutorGates(req, user, !stored);
  if ("refusal" in gate) return gate.refusal;
  const style = (await getVoiceConfig()).tutorStyle;
  if (stored) {
    const p = stored.payload as { questions?: PracticeQuestion[]; style?: unknown };
    const voice =
      stored.kind === "practice" && Array.isArray(p.questions)
        ? { voice: practiceVoice(user.id, p.questions, isTutorStyle(p.style) ? p.style : style) }
        : {};
    return NextResponse.json({ kind: stored.kind, key, cached: true, ...(stored.payload as object), ...voice });
  }

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
    } else if (missed && ref) {
      const raw = await whiteboardFromUpload(
        b64,
        up.mime,
        whiteboardInstructions(style, practiceMistakeContext(missed, ref.picked)),
        usageActor(user),
      );
      const lesson = parseWhiteboardLesson(raw) ?? lessonFromProse(raw);
      kind = "lesson";
      payload = { ...lessonPayload(user.id, lesson, "practice", style) };
      title = lesson.title;
    } else {
      const raw = await whiteboardFromUpload(b64, up.mime, studyInstructions(action === "summarize" ? "summarize" : "explain", target, user.grade ?? null, style), usageActor(user));
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
          target: ref ? `${ref.set}#${ref.index}#${ref.picked}` : target,
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
      ...(kind === "practice" ? { voice: practiceVoice(user.id, payload.questions as PracticeQuestion[], style) } : {}),
      remainingToday: limit !== null && usedToday !== null ? Math.max(0, limit - usedToday) : null,
    });
  } catch (error) {
    console.error("[study-uploads/act]", error);
    return NextResponse.json({ error: "The guide couldn't do this right now. Please try again." }, { status: 500 });
  }
}
