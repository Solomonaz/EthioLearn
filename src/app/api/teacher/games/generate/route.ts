import { NextRequest, NextResponse } from "next/server";
import { validateCsrfOrigin } from "@/lib/csrf";
import { rateLimit } from "@/lib/rate-limit";
import { isAiFeatureEnabled } from "@/lib/platform-settings";
import { generateQuestions } from "@/lib/ai-provider";
import { getRequester } from "../_shared";
import { getCurrentUser } from "@/lib/get-session";
import { usageActor, withUsageActor } from "@/lib/usage-logger";

/**
 * POST /api/teacher/games/generate — best-effort AI question generation for
 * Tug of War. Elementary content is topic-based (no source document), so the
 * topic is passed as the "content" the generator draws from. Returns MCQ rows
 * ready to play; the teacher can save them via POST /api/teacher/games.
 *
 * Gated by the platform-wide aiQuizGen switch; degrades with a clear error when
 * AI is off or no provider key is configured.
 */
export async function POST(request: NextRequest) {
  const req = await getRequester();
  if (!req) return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  if (!validateCsrfOrigin(request)) {
    return NextResponse.json({ error: "Invalid request origin" }, { status: 403 });
  }

  // Question generation is the priciest AI call in the app, so it is capped
  // harder than the chat paths. `ownerId` is null for the env super-admin, who
  // still needs a distinct bucket rather than sharing one keyed on "null".
  const rl = rateLimit(`ai:teacher:gen:${req.ownerId ?? "env-super-admin"}`, 5, 60_000);
  if (!rl.success) {
    return NextResponse.json(
      { error: "Too many AI generation requests. Please wait a moment." },
      { status: 429, headers: { "Retry-After": String(rl.retryAfter) } }
    );
  }

  if (!(await isAiFeatureEnabled("aiQuizGen"))) {
    return NextResponse.json({ error: "AI generation is turned off" }, { status: 403 });
  }

  const body = await request.json().catch(() => null);
  const subject = String(body?.subject ?? "").trim() || "General";
  const topic = String(body?.topic ?? "").trim();
  const grade = Math.min(8, Math.max(1, Number(body?.grade) || 3));
  const language = body?.language === "am" ? "am" : "en";
  const count = Math.min(20, Math.max(3, Number(body?.count) || 8));

  if (!topic) {
    return NextResponse.json({ error: "Enter a topic" }, { status: 400 });
  }

  try {
    // Bill the tokens to the teacher's school in Admin -> Usage.
    const actor = usageActor(await getCurrentUser());
    const { questions } = await withUsageActor(actor, () => generateQuestions({
      content: `Create simple multiple-choice questions for grade ${grade} pupils about "${topic}" in the subject ${subject}. Keep the language and numbers age-appropriate for young learners.`,
      chapterTitle: topic,
      subject,
      grade,
      count,
      difficulty: "EASY",
      questionTypes: ["MCQ"],
      language,
      mode: "GROUP",
    }));

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
    console.error("[teacher/games/generate]", err);
    return NextResponse.json({ error: "Generation failed" }, { status: 502 });
  }
}
