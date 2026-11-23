import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getCurrentUser } from "@/lib/get-session";
import { validateCsrfOrigin } from "@/lib/csrf";
import { rateLimit } from "@/lib/rate-limit";
import { usageActor } from "@/lib/usage-logger";
import { chatWithTutor } from "@/lib/ai-provider";
import { buildTutorContext } from "@/lib/tutor-context";
import { getEntitlements, UPGRADE_MESSAGES } from "@/lib/entitlements";
import { isAiFeatureEnabled } from "@/lib/platform-settings";
import { recordStudyActivity } from "@/lib/streak";
import { normalizeOption } from "@/lib/utils";
import {
  getTutorDailyStatus,
  recordTutorMessage,
  tutorLimitMessage,
  tutorLimitReached,
} from "@/lib/tutor-allowance";
import { lessonFromProse, parseWhiteboardLesson, whiteboardInstructions } from "@/lib/whiteboard-lesson";
import { lessonPayload } from "@/lib/whiteboard-voice";

/**
 * POST /api/ai/why-wrong — { quizId, questionId }
 *
 * "Why was I wrong?" on the quiz results page: the AI tutor explains the
 * student's specific mistake on one question, grounded in that question's
 * textbook chapter. It is the AI tutor answering one particular message, so it
 * follows every tutor rule — Pro (ai) entitlement, the platform aiTutor switch,
 * the shared tutor rate limit, and the daily tutor allowance (it uses up one
 * tutor message). The client sends only ids; the question, the student's own
 * answer and the right answer are read from the database, so this can only
 * explain a wrong answer the student really submitted, and cannot be used as
 * a free-text prompt.
 *
 * format "whiteboard" (the Whiteboard Tutor under the AI tutor) asks for the
 * same explanation as a short structured lesson — see lib/whiteboard-lesson —
 * which the page draws and reads aloud. Same rules, same one tutor message.
 */

const MAX_FIELD = 600;
const clip = (s: string) => (s.length > MAX_FIELD ? `${s.slice(0, MAX_FIELD)}…` : s);

export async function POST(req: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!validateCsrfOrigin(req)) {
    return NextResponse.json({ error: "Invalid request origin" }, { status: 403 });
  }

  // Same bucket as the tutor chat: one per-user limit across both.
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

  const body = (await req.json().catch(() => ({}))) as { quizId?: unknown; questionId?: unknown; format?: unknown };
  if (typeof body.quizId !== "string" || typeof body.questionId !== "string") {
    return NextResponse.json({ error: "quizId and questionId are required" }, { status: 400 });
  }
  if (body.format !== undefined && body.format !== "text" && body.format !== "whiteboard") {
    return NextResponse.json({ error: "Unknown format" }, { status: 400 });
  }
  const whiteboard = body.format === "whiteboard";

  // Only the student's own, submitted, wrong answer.
  const answer = await db.quizAnswer.findFirst({
    where: {
      quizId: body.quizId,
      questionId: body.questionId,
      isCorrect: false,
      quiz: { studentId: user.id, completedAt: { not: null } },
    },
    select: {
      studentAnswer: true,
      question: {
        select: {
          questionText: true,
          options: true,
          correctAnswer: true,
          explanation: true,
          chapter: {
            select: {
              id: true,
              title: true,
              content: true,
              textbook: { select: { id: true, subject: true, grade: true, content: true } },
            },
          },
        },
      },
    },
  });
  if (!answer || !answer.question.chapter) {
    return NextResponse.json({ error: "No wrong answer to explain for this question." }, { status: 404 });
  }

  const q = answer.question;
  const chapter = q.chapter!;
  const options = Array.isArray(q.options) ? (q.options as unknown[]).map(normalizeOption) : [];
  const message = [
    "I got this question wrong in a practice quiz. Explain my mistake.",
    "",
    `Question: ${clip(q.questionText)}`,
    options.length ? `Options: ${options.map((o) => clip(o)).join(" | ")}` : "",
    `My answer: ${clip(answer.studentAnswer || "(no answer)")}`,
    `Correct answer: ${clip(q.correctAnswer)}`,
    q.explanation ? `Textbook explanation: ${clip(q.explanation)}` : "",
    "",
    ...(whiteboard
      ? [whiteboardInstructions()]
      : [
          "In under 150 words: first say exactly why my answer is wrong (the misunderstanding behind it),",
          "then why the correct answer is right, using one simple everyday comparison.",
          "Finish with a one-line tip to remember it. Be warm and a little playful, never mocking.",
          "Write any maths in LaTeX between $ signs, e.g. $\\frac{3}{8}$.",
        ]),
  ]
    .filter((l) => l !== "")
    .join("\n");

  try {
    const content = await buildTutorContext(
      chapter.id,
      q.questionText,
      chapter.content || chapter.textbook.content || "",
      usageActor(user),
    );
    const result = await chatWithTutor({
      actor: usageActor(user),
      message,
      history: [],
      content,
      chapterTitle: chapter.title,
      subject: chapter.textbook.subject,
      grade: chapter.textbook.grade,
    });

    // Count only a delivered reply, like the tutor chat.
    const usedToday = capped ? await recordTutorMessage(user.id) : null;
    if (user.role === "STUDENT") await recordStudyActivity(user.id, "tutor");
    const limit = daily?.limit ?? null;

    return NextResponse.json({
      ...(whiteboard
        ? lessonPayload(user.id, parseWhiteboardLesson(result.response) ?? lessonFromProse(result.response), "mistake")
        : { response: result.response }),
      textbookId: chapter.textbook.id,
      chapterId: chapter.id,
      remainingToday: limit !== null && usedToday !== null ? Math.max(0, limit - usedToday) : null,
    });
  } catch (error) {
    console.error("[why-wrong]", error);
    return NextResponse.json({ error: "The tutor couldn't explain this right now. Please try again." }, { status: 500 });
  }
}
