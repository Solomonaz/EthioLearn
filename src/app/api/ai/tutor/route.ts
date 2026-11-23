import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getCurrentUser } from "@/lib/get-session";
import { rateLimit } from "@/lib/rate-limit";
import { usageActor } from "@/lib/usage-logger";
import { chatWithTutor } from "@/lib/ai-provider";
import { recordStudyActivity } from "@/lib/streak";
import { validateCsrfOrigin } from "@/lib/csrf";
import { buildTutorContext } from "@/lib/tutor-context";
import { getEntitlements, UPGRADE_MESSAGES } from "@/lib/entitlements";
import { isAiFeatureEnabled } from "@/lib/platform-settings";
import { rewriteQueryForRAG } from "@/lib/query-rewriter";
import {
  getTutorDailyStatus,
  recordTutorMessage,
  tutorLimitMessage,
  tutorLimitReached,
} from "@/lib/tutor-allowance";

// Cost guard. The client sends the WHOLE conversation on every message, so
// without a cap each turn re-bills every earlier turn and a long session grows
// quadratically. The last 6 messages (3 exchanges) is plenty of context for a
// follow-up; each is also length-capped so one pasted wall of text can't
// dominate the prompt.
const MAX_HISTORY_TURNS = 6;
const MAX_TURN_CHARS = 2000;

type TutorTurn = { role: "user" | "model"; parts: { text: string }[] };

/** Validate, trim and cap the client-supplied history. Never throws. */
function capHistory(raw: unknown): TutorTurn[] {
  if (!Array.isArray(raw)) return [];
  const turns: TutorTurn[] = [];
  for (const h of raw) {
    const role = h?.role;
    const text = h?.parts?.[0]?.text;
    if ((role !== "user" && role !== "model") || typeof text !== "string" || !text.trim()) continue;
    const capped = text.length > MAX_TURN_CHARS ? `${text.slice(0, MAX_TURN_CHARS)}…` : text;
    turns.push({ role, parts: [{ text: capped }] });
  }
  const recent = turns.slice(-MAX_HISTORY_TURNS);
  // Gemini rejects a chat history that opens with a model turn, which slicing
  // can produce — drop any leading model turns.
  while (recent.length && recent[0].role !== "user") recent.shift();
  return recent;
}


export async function POST(req: Request) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  // Same-site requests only: another site must not spend a student's tutor
  // messages (and our AI budget) through their session.
  if (!validateCsrfOrigin(req)) {
    return NextResponse.json({ error: "Invalid request origin" }, { status: 403 });
  }

  // Every call here spends real tokens at a paid provider, so an unmetered
  // endpoint is a cost attack as much as an availability one. 20/min per
  // user is far above human pace for chat turns and still bounds the damage.
  const rl = rateLimit(`ai:tutor:${user.id}`, 20, 60_000);
  if (!rl.success) {
    return NextResponse.json(
      { error: "Too many AI requests. Please wait a moment." },
      { status: 429, headers: { "Retry-After": String(rl.retryAfter) } }
    );
  }

  const ent = await getEntitlements(user);
  if (!ent.ai) {
    return NextResponse.json(
      { error: UPGRADE_MESSAGES.ai, code: "UPGRADE_REQUIRED" },
      { status: 403 }
    );
  }
  if (!(await isAiFeatureEnabled("aiTutor"))) {
    return NextResponse.json(
      { error: "The AI tutor is currently turned off.", code: "AI_DISABLED" },
      { status: 503 }
    );
  }

  // Daily cap (the platform setting). The env super admin tests uncapped.
  const capped = user.role !== "SUPER_ADMIN";
  const daily = capped ? await getTutorDailyStatus(user.id) : null;
  if (daily && tutorLimitReached(daily)) {
    return NextResponse.json(
      { error: tutorLimitMessage(daily.limit!), code: "DAILY_LIMIT", remainingToday: 0 },
      { status: 429 }
    );
  }

  try {
    const { chapterId, message, history: rawHistory } = await req.json();
    const history = capHistory(rawHistory);

    if (!chapterId || !message) {
      return NextResponse.json({ error: "Chapter ID and message are required" }, { status: 400 });
    }

    // 1. Fetch Chapter Content
    const chapter = await db.chapter.findUnique({
      where: { id: chapterId },
      include: {
        textbook: true,
      },
    });

    if (!chapter) {
      return NextResponse.json({ error: "Chapter not found" }, { status: 404 });
    }

    // 2. Synthesize a standalone search query if this is a follow-up turn in a conversation
    const searchQuery = await rewriteQueryForRAG({
      message,
      history,
      subject: chapter.textbook.subject,
      chapterTitle: chapter.title,
      actor: usageActor(user),
    });

    // Retrieve the most relevant chunks for this question (RAG), falling
    // back to raw chapter text when embeddings aren't available.
    const content = await buildTutorContext(
      chapterId,
      searchQuery,
      chapter.content || chapter.textbook.content || "",
      usageActor(user)
    );

    // 3. Chat with Tutor
    const result = await chatWithTutor({
      actor: usageActor(user),
      message,
      history,
      content,
      chapterTitle: chapter.title,
      subject: chapter.textbook.subject,
      grade: chapter.textbook.grade,
    });

    // Count only a delivered reply, so a failed call never uses up a message.
    const usedToday = capped ? await recordTutorMessage(user.id) : null;
    if (user.role === "STUDENT") await recordStudyActivity(user.id, "tutor");
    const limit = daily?.limit ?? null;

    return NextResponse.json({
      response: result.response,
      provider: result.provider,
      remainingToday: limit !== null && usedToday !== null ? Math.max(0, limit - usedToday) : null,
    });
  } catch (error) {
    console.error("[Tutor API Error]", error);
    return NextResponse.json({ error: "Failed to generate tutor response" }, { status: 500 });
  }
}
