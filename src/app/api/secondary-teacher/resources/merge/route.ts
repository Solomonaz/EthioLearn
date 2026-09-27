import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getCurrentUser } from "@/lib/get-session";
import { rateLimit } from "@/lib/rate-limit";
import { validateCsrfOrigin } from "@/lib/csrf";
import { isAiFeatureEnabled } from "@/lib/platform-settings";
import { usageActor } from "@/lib/usage-logger";
import {
  getTeacherAiStatus,
  recordTeacherAiUse,
  teacherAiDenial,
  TEACHER_AI_CREDITS,
} from "@/lib/teacher-ai-allowance";
import { askTeachingAssistant } from "@/lib/teaching-assistant";
import { splitAnswerKey } from "@/lib/answer-key";
import { ASSISTANT_TASKS, type AssistantTask } from "@/lib/assistant-tasks";
import { sseResponse, type ProgressFn } from "@/lib/sse";
import { normaliseInstructions, storeResource } from "@/lib/teacher-library";
import { subjectKey } from "@/lib/subject";

/**
 * Merge several of a teacher's own materials into one polished document.
 *
 * The assistant writes best from one chapter at a time, so the recommended
 * way to cover several is to generate chapter by chapter and merge here. The
 * result is a new item in their Materials; the originals are left as they were.
 *
 * Only ever the teacher's own rows. A merge is tailored to its author, so it is
 * stored without a request key and never enters the shared bank.
 *
 * `?stream=1` streams progress, like the assistant route.
 */

const MIN_DOCS = 2;
const MAX_DOCS = 6;
/** Combined source size — the merged result has to fit the output cap too. */
const MAX_SOURCE_CHARS = 48_000;
/** Output cap for a merge: roughly the size of the sources, which can be long. */
const MERGE_MAX_TOKENS = 16_000;
const MAX_INSTRUCTIONS = 1000;
const VALID_TASKS = new Set<string>(ASSISTANT_TASKS.map((t) => t.value));

export async function POST(req: NextRequest) {
  if (req.nextUrl.searchParams.get("stream") !== "1") {
    return merge(req);
  }
  return sseResponse(async (emit) => {
    const res = await merge(req, emit.progress);
    const body = await res.json().catch(() => ({}));
    if (res.ok) emit.done(body);
    else emit.error(body?.error ?? "The AI could not merge those just now.");
  }, "The AI could not merge those just now.");
}

async function merge(req: NextRequest, onProgress?: ProgressFn) {
  const report = onProgress ?? (() => {});

  if (!validateCsrfOrigin(req)) {
    return NextResponse.json({ error: "Invalid request origin" }, { status: 403 });
  }

  const user = await getCurrentUser();
  if (!user || user.role !== "SECONDARY_TEACHER" || !user.schoolId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  }

  const rl = rateLimit("secondary-teacher:merge:" + user.id, 6, 60_000);
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

  // A merge is always written fresh, so it counts from the start.
  const denied = teacherAiDenial(await getTeacherAiStatus(user), TEACHER_AI_CREDITS.merge);
  if (denied) return NextResponse.json({ error: denied.error }, { status: denied.status });

  let body: { resourceIds?: unknown; instructions?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  // In the order the teacher picked them — that is the order of the result.
  const ids = Array.isArray(body.resourceIds)
    ? [...new Set(body.resourceIds.filter((x): x is string => typeof x === "string" && x.length > 0))]
    : [];
  if (ids.length < MIN_DOCS) {
    return NextResponse.json({ error: `Pick at least ${MIN_DOCS} materials to merge.` }, { status: 400 });
  }
  if (ids.length > MAX_DOCS) {
    return NextResponse.json({ error: `You can merge up to ${MAX_DOCS} at a time.` }, { status: 400 });
  }
  const instructions =
    typeof body.instructions === "string" ? body.instructions.trim().slice(0, MAX_INSTRUCTIONS) : "";

  report({ message: "Reading your materials...", percent: 8 });

  const rows = await db.teacherResource.findMany({
    where: { id: { in: ids }, teacherId: user.id },
    select: { id: true, task: true, title: true, body: true, subject: true, grade: true, chapterTitle: true },
  });
  if (rows.length !== ids.length) {
    return NextResponse.json({ error: "Some of those materials could not be found." }, { status: 404 });
  }
  const docs = ids.map((id) => rows.find((r) => r.id === id)!);

  // One subject per merge: Biology and Chemistry material are not one
  // document, and the result is sent to classes of its subject.
  const subjectKeys = new Set(docs.map((d) => subjectKey(d.subject)));
  if (subjectKeys.size > 1) {
    return NextResponse.json(
      { error: "Those are from different subjects. Merge materials of one subject at a time." },
      { status: 400 },
    );
  }

  // One kind per merge: a worksheet and board notes are not one document.
  if (new Set(docs.map((d) => d.task)).size > 1) {
    return NextResponse.json(
      { error: "Those are different kinds of material. Merge one kind at a time — worksheets with worksheets, notes with notes." },
      { status: 400 },
    );
  }

  const sourceChars = docs.reduce((n, d) => n + d.body.length, 0);
  if (sourceChars > MAX_SOURCE_CHARS) {
    return NextResponse.json(
      { error: "Those are too long to merge in one go. Pick fewer, or merge them in two steps." },
      { status: 400 },
    );
  }

  // What the merged document is filed under: shared values only.
  const same = <T,>(values: T[]): T | null => (values.every((v) => v === values[0]) ? values[0] : null);
  // One kind, checked above.
  const task: AssistantTask = VALID_TASKS.has(docs[0].task) ? (docs[0].task as AssistantTask) : "FREEFORM";
  // One subject, checked above — the first spelling stands for it.
  const subject = docs[0].subject;
  const grade = same(docs.map((d) => d.grade));
  const chapterTitle =
    [...new Set(docs.map((d) => d.chapterTitle).filter((t): t is string => Boolean(t)))]
      .join("; ")
      .slice(0, 200) || null;

  report({ message: "Preparing the merge...", percent: 15 });

  const result = await askTeachingAssistant({
    task,
    prompt: instructions,
    subject,
    grade,
    // Not passed as context: stored chapter labels can be messy ("Part 4:
    // Solve the Following Problems"), and the model named the whole merge
    // after one. The documents' own titles say what it covers.
    chapterTitle: null,
    // Split here, so each document's answer key reaches the model labelled as
    // teacher-only and the merged key can be gathered behind one fence.
    merge: docs.map((d) => {
      const split = splitAnswerKey(d.body);
      return { title: d.title, body: split.body, answerKey: split.answerKey };
    }),
    maxTokens: MERGE_MAX_TOKENS,
    actor: usageActor(user),
    onProgress: report,
  });

  if ("failed" in result) {
    return NextResponse.json(
      {
        error: "The AI could not merge those just now. Please try again.",
        ...(process.env.NODE_ENV !== "production" ? { attempts: result.attempts } : {}),
      },
      { status: 502 },
    );
  }
  await recordTeacherAiUse(user, "merge", TEACHER_AI_CREDITS.merge);

  const resourceId = await storeResource({
    teacherId: user.id,
    task,
    title: result.title,
    body: result.markdown,
    subject,
    grade,
    chapterTitle,
    source: "ASSISTANT",
    requestKey: null,
    instructions: normaliseInstructions(instructions),
    embedding: null,
  });

  return NextResponse.json({
    title: result.title,
    markdown: result.markdown,
    resourceId,
    task,
    subject,
    grade,
    chapterTitle,
  });
}
