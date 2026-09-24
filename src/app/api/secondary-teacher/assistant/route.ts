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
import {
  embedInstructions,
  normaliseInstructions,
  serveFromBank,
  storeResource,
  isReusableTask,
} from "@/lib/teacher-library";

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
    /** The stored result a revision replaces (see the end of this handler). */
    resourceId?: string | null;
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
  /** Full chapter text — only read into a prompt if the AI is actually called. */
  let chapterText = "";

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
    chapterText = chapter.content || chapter.textbook?.content || "";
  }

  // The class it is for, when no chapter says so: the subject and grade are
  // what the stored result is filed and shared under.
  if (!subject && typeof body.teachingAssignmentId === "string" && body.teachingAssignmentId) {
    const cls = await db.teachingAssignment.findFirst({
      where: { id: body.teachingAssignmentId, teacherId: user.id },
      select: { subject: true, grade: true },
    });
    if (cls) {
      subject = cls.subject;
      grade = cls.grade;
    }
  }

  // ── Bank first (lib/teacher-library) ───────────────────────────────────
  // Another teacher of this subject and grade may already have had exactly
  // this written. If so it is served — before any chapter search or AI call —
  // and this teacher never knows it wasn't written just now. Revisions and
  // "Anything else" are always written fresh.
  const instructions = normaliseInstructions(prompt);
  const requestKey = `${task}|${chapterId || "-"}`;
  const reusable = !revise && isReusableTask(task) && Boolean(subject) && grade !== null;
  const embedding = reusable ? await embedInstructions(instructions, usageActor(user)) : null;
  if (reusable) {
    const served = await serveFromBank({
      teacherId: user.id,
      task,
      subject,
      grade,
      requestKey,
      instructions,
      embedding,
      chapterTitle,
      source: "ASSISTANT",
    });
    if (served) {
      report({ message: "Formatting the document...", percent: 88 });
      return NextResponse.json({
        title: served.title,
        markdown: served.body,
        grounded: Boolean(chapterTitle),
        resourceId: served.resourceId,
      });
    }
  }

  if (chapterId) {
    chapterContent = await groundingFor(chapterId, chapterText, prompt, usageActor(user));
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

  // Every result is stored (lib/teacher-library). A revision replaces the
  // document it revised — and takes it out of the bank, since it is now
  // tailored to this teacher. Anything else is a new entry, and curriculum
  // work joins the bank for the next teacher of this subject and grade.
  let resourceId: string | null = null;
  if (revise && typeof body.resourceId === "string" && body.resourceId) {
    const updated = await db.teacherResource
      .updateMany({
        where: { id: body.resourceId, teacherId: user.id },
        data: { title: result.title.slice(0, 160), body: result.markdown, reusable: false },
      })
      .catch(() => ({ count: 0 }));
    if (updated.count > 0) resourceId = body.resourceId;
  }
  if (!resourceId) {
    resourceId = await storeResource({
      teacherId: user.id,
      task,
      title: result.title,
      body: result.markdown,
      subject,
      grade,
      chapterTitle,
      source: "ASSISTANT",
      // A revision that lost its original is stored, but never reused.
      requestKey: revise ? null : requestKey,
      instructions,
      embedding,
    });
  }

  return NextResponse.json({
    title: result.title,
    markdown: result.markdown,
    grounded: Boolean(chapterTitle),
    resourceId,
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
