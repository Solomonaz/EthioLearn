import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getCurrentUser } from "@/lib/get-session";
import { rateLimit } from "@/lib/rate-limit";
import { validateCsrfOrigin } from "@/lib/csrf";
import { isAiFeatureEnabled } from "@/lib/platform-settings";
import { usageActor } from "@/lib/usage-logger";
import { askTeachingAssistant } from "@/lib/teaching-assistant";
import { ASSISTANT_TASKS, type AssistantTask } from "@/lib/assistant-tasks";
import { subjectFilter } from "@/lib/subject";
import { sseResponse, type ProgressFn } from "@/lib/sse";
import { semanticSearch } from "@/lib/embeddings";
import { selectGenerationContent } from "@/lib/generation-content";

/**
 * AI teaching assistant for a secondary teacher.
 *
 * Optionally grounded in a chapter of a textbook the teacher's own class
 * studies — the chapter is validated against their assignments, so this cannot
 * be used to read content outside what they teach.
 *
 * Gated by its own platform switch, `aiTeacherAssistant`. It used to share
 * the student tutor's switch, so turning off the tutor for students silently
 * took this away from teachers.
 *
 * Token cost lands on the teacher's school, not on any student — `usageActor`
 * sets studentId null for non-students.
 */

const MAX_PROMPT = 2000;
/** Chapter text sent with one request — chosen passages, not the opening pages. */
const CONTENT_BUDGET = 16000;
/** Passages retrieved for a request that names a topic. */
const RETRIEVED_CHUNKS = 10;
/** Longest earlier result accepted for a revision. */
const MAX_REVISE_CHARS = 20000;

const VALID_TASKS = new Set<string>(ASSISTANT_TASKS.map((t) => t.value));

/**
 * POST — generate a document.
 *
 * `?stream=1` returns Server-Sent Events carrying live progress, then a final
 * `done` (or `error`) event. Without it this is the plain JSON response it has
 * always been.
 */
export async function POST(req: NextRequest) {
  if (req.nextUrl.searchParams.get("stream") !== "1") {
    return generate(req);
  }

  return sseResponse(async (emit) => {
    const res = await generate(req, emit.progress);
    const body = await res.json().catch(() => ({}));
    if (res.ok) emit.done(body);
    else emit.error(body?.error ?? "The AI could not produce anything just now.");
  }, "The AI could not produce anything just now.");
}

async function generate(req: NextRequest, onProgress?: ProgressFn) {
  const report = onProgress ?? (() => {});

  if (!validateCsrfOrigin(req)) {
    return NextResponse.json({ error: "Invalid request origin" }, { status: 403 });
  }

  const user = await getCurrentUser();
  if (!user || user.role !== "SECONDARY_TEACHER" || !user.schoolId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  }

  // Generous enough for real use, tight enough that a stuck client cannot run
  // up a bill.
  const rl = rateLimit("secondary-teacher:assistant:" + user.id, 15, 60_000);
  if (!rl.success) {
    return NextResponse.json(
      { error: "Too many requests. Please wait a moment." },
      { status: 429, headers: { "Retry-After": String(rl.retryAfter) } },
    );
  }

  if (!(await isAiFeatureEnabled("aiTeacherAssistant"))) {
    return NextResponse.json(
      { error: "AI features are currently switched off for this platform." },
      { status: 503 },
    );
  }

  let body: {
    task?: string;
    prompt?: string;
    chapterId?: string | null;
    teachingAssignmentId?: string | null;
    revise?: { previous?: unknown; instruction?: unknown } | null;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const task: AssistantTask = VALID_TASKS.has(body.task ?? "")
    ? (body.task as AssistantTask)
    : "FREEFORM";

  const prompt = typeof body.prompt === "string" ? body.prompt.trim().slice(0, MAX_PROMPT) : "";
  // A revision carries its own instruction, so it needs no new prompt.
  if (task === "FREEFORM" && prompt.length < 3 && !body.revise) {
    return NextResponse.json(
      { error: "Describe what you need." },
      { status: 400 },
    );
  }

  // A revision of an earlier result, if one was asked for.
  let revise: { previous: string; instruction: string } | null = null;
  if (body.revise) {
    const previous = typeof body.revise.previous === "string" ? body.revise.previous.trim() : "";
    const instruction =
      typeof body.revise.instruction === "string" ? body.revise.instruction.trim().slice(0, 500) : "";
    if (previous.length < 20 || instruction.length < 3) {
      return NextResponse.json({ error: "Describe the change you want." }, { status: 400 });
    }
    if (previous.length > MAX_REVISE_CHARS) {
      return NextResponse.json({ error: "That document is too long to revise." }, { status: 400 });
    }
    revise = { previous, instruction };
  }

  // Something to write ABOUT. A lesson plan with no chapter and no
  // instructions has no topic, and the model would invent one.
  const hasChapter = typeof body.chapterId === "string" && body.chapterId.length > 0;
  if (!revise && !hasChapter && prompt.length < 3) {
    return NextResponse.json(
      { error: "Pick a chapter, or describe the topic in your instructions." },
      { status: 400 },
    );
  }

  // ── Optional grounding in one of the teacher's own chapters ───────────
  let subject: string | null = null;
  let grade: number | null = null;
  let chapterTitle: string | null = null;
  let chapterContent: string | null = null;

  const chapterId = typeof body.chapterId === "string" ? body.chapterId : "";
  if (chapterId) {
    report({ message: "Reading your chapter...", percent: 8 });
    const chapter = await db.chapter.findUnique({
      where: { id: chapterId },
      select: {
        title: true,
        content: true,
        textbook: { select: { subject: true, grade: true, content: true } },
      },
    });
    if (!chapter) {
      return NextResponse.json({ error: "Chapter not found" }, { status: 404 });
    }

    // The teacher must actually teach that subject. Without this, the chapter
    // id would be an unchecked handle onto any textbook on the platform.
    //
    // A textbook with no subject matches nothing: falling through to an empty
    // string would have compared it against assignments that also store an
    // empty subject, which is an accident, not a grant of access.
    const chapterSubject = chapter.textbook?.subject ?? "";
    const teaches = chapterSubject
      ? await db.teachingAssignment.findFirst({
          where: { teacherId: user.id, subject: subjectFilter(chapterSubject) },
          select: { id: true },
        })
      : null;
    if (!teaches) {
      return NextResponse.json(
        { error: "That chapter is not one of your subjects." },
        { status: 403 },
      );
    }

    subject = chapter.textbook?.subject ?? null;
    grade = chapter.textbook?.grade ?? null;
    chapterTitle = chapter.title;
    chapterContent = await groundingFor(
      chapterId,
      chapter.content || chapter.textbook?.content || "",
      prompt,
      usageActor(user),
    );
  }

  report({ message: "Preparing the request...", percent: 15 });

  const result = await askTeachingAssistant({
    task,
    prompt,
    subject,
    grade,
    chapterTitle,
    chapterContent,
    revise,
    actor: usageActor(user),
    onProgress: report,
  });

  if ("failed" in result) {
    return NextResponse.json(
      {
        error: "The AI could not produce anything just now. Please try again.",
        // Only in development: without the per-provider reason, a 502 here is
        // undiagnosable.
        ...(process.env.NODE_ENV !== "production" ? { attempts: result.attempts } : {}),
      },
      { status: 502 },
    );
  }

  return NextResponse.json({
    title: result.title,
    markdown: result.markdown,
    grounded: Boolean(chapterTitle),
  });
}

/**
 * The chapter passages to ground a request in.
 *
 * It used to send the chapter's first 12,000 characters. Chapters run to
 * ~100,000, so anything past the opening pages was invisible: asked for a
 * worksheet on electron configuration (which starts at character 58,649 of
 * its chapter), the model told the teacher the textbook did not cover it.
 *
 * With instructions, the passages closest to them are retrieved (the chunks
 * are already embedded for the student tutor) and put back in reading order.
 * Without — or if retrieval fails — passages are spread across the WHOLE
 * chapter, the same selection question generation uses.
 */
async function groundingFor(
  chapterId: string,
  fullText: string,
  prompt: string,
  actor: ReturnType<typeof usageActor>,
): Promise<string> {
  if (prompt.length >= 3) {
    try {
      const hits = await semanticSearch(prompt, {
        chapterId,
        limit: RETRIEVED_CHUNKS,
        usage: { feature: "embedding-query", actor },
      });
      if (hits.length > 0) {
        const ordered = [...hits].sort((a, b) => a.chunkIndex - b.chunkIndex);
        const out: string[] = [];
        let used = 0;
        for (const h of ordered) {
          if (used + h.content.length > CONTENT_BUDGET) break;
          out.push(h.content);
          used += h.content.length;
        }
        if (out.length > 0) return out.join("\n\n---\n\n");
      }
    } catch {
      /* fall back to the spread selection below */
    }
  }
  const selected = await selectGenerationContent({
    chapterId,
    fallbackContent: fullText,
    budgetChars: CONTENT_BUDGET,
  });
  return selected.content;
}
