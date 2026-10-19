import { NextRequest, NextResponse } from "next/server";
import { validateCsrfOrigin } from "@/lib/csrf";
import { rateLimit } from "@/lib/rate-limit";
import { isAiFeatureEnabled } from "@/lib/platform-settings";
import { generateQuestions } from "@/lib/ai-provider";
import { getCurrentUser } from "@/lib/get-session";
import { getEntitlements, UPGRADE_MESSAGES } from "@/lib/entitlements";
import { isElementaryStudent } from "@/lib/teacher-band";
import { usageActor, withUsageActor } from "@/lib/usage-logger";

/** Generations a grades 1-8 student may run per day (each is one AI call). */
const DAILY_LIMIT = 30;
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * POST /api/play/generate — AI questions for a grades 1-8 student's games
 * (Tug of War, Find the Pair), on a topic they type. The student twin of
 * /api/teacher/games/generate: the questions are always for the student's own
 * grade, and access comes from their plan (games + AI), not a school.
 * Nothing is saved; the questions go straight into the game.
 */
export async function POST(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user || !isElementaryStudent(user)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  }
  if (!validateCsrfOrigin(request)) {
    return NextResponse.json({ error: "Invalid request origin" }, { status: 403 });
  }

  const ent = await getEntitlements(user);
  if (!ent.games) {
    return NextResponse.json({ error: UPGRADE_MESSAGES.games }, { status: 403 });
  }
  if (!ent.ai) {
    return NextResponse.json({ error: UPGRADE_MESSAGES.ai }, { status: 403 });
  }
  if (!(await isAiFeatureEnabled("aiQuizGen"))) {
    return NextResponse.json({ error: "AI generation is turned off" }, { status: 403 });
  }

  const body = await request.json().catch(() => null);
  const subject = String(body?.subject ?? "").trim().slice(0, 60) || "General";
  const topic = String(body?.topic ?? "").trim().slice(0, 120);
  const language = body?.language === "am" ? "am" : "en";
  const count = Math.min(10, Math.max(3, Number(body?.count) || 8));
  if (!topic) {
    return NextResponse.json({ error: "Enter a topic" }, { status: 400 });
  }

  // Question generation is the priciest AI call in the app: a short burst
  // limit, and a daily cap so one account can't run up the bill.
  const burst = rateLimit(`ai:play:gen:${user.id}`, 5, 60_000);
  const daily = burst.success ? rateLimit(`ai:play:gen:day:${user.id}`, DAILY_LIMIT, DAY_MS) : null;
  if (!burst.success || !daily?.success) {
    const retryAfter = !burst.success ? burst.retryAfter : daily!.retryAfter;
    return NextResponse.json(
      {
        error: !burst.success
          ? "Too many requests. Please wait a moment."
          : `You have made ${DAILY_LIMIT} sets of AI questions today. Try again tomorrow.`,
      },
      { status: 429, headers: { "Retry-After": String(retryAfter) } },
    );
  }

  const grade = user.grade as number;
  try {
    const { questions } = await withUsageActor(usageActor(user), () =>
      generateQuestions({
        content: `Create simple multiple-choice questions for grade ${grade} pupils about "${topic}" in the subject ${subject}. Keep the language and numbers age-appropriate for young learners.`,
        chapterTitle: topic,
        subject,
        grade,
        count,
        difficulty: "EASY",
        questionTypes: ["MCQ"],
        language,
        mode: "GROUP",
      }),
    );

    const rows = questions
      .filter((q) => q.type === "MCQ" && q.options?.length >= 2)
      .map((q) => ({
        question: q.questionText,
        options: q.options,
        correctAnswer: q.correctAnswer,
      }))
      .filter((q) => q.options.includes(q.correctAnswer));

    if (rows.length === 0) {
      return NextResponse.json({ error: "No questions generated" }, { status: 502 });
    }
    return NextResponse.json({ questions: rows });
  } catch (err) {
    console.error("[play/generate]", err);
    return NextResponse.json({ error: "Generation failed" }, { status: 502 });
  }
}
