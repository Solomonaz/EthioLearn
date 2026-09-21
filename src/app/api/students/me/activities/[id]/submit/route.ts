import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireCompleteProfile } from "@/lib/get-session";
import { validateCsrfOrigin } from "@/lib/csrf";

/**
 * Hand in written work as TEXT.
 *
 * Files go through `./files` instead. Either is a valid hand-in on its own:
 * a typed answer survives a connection that a photo would not, and a photo of
 * an exercise book is what most written work actually looks like. A student
 * who has already attached a file may therefore clear their typed answer
 * without withdrawing the submission.
 *
 * A student may revise and resubmit freely UNTIL the teacher marks it. Once
 * marked, the submission is frozen — otherwise a student could change their
 * answer after seeing the feedback, and the mark would no longer describe the
 * work it was given for.
 */

const MAX_SUBMISSION = 20_000;

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  if (!validateCsrfOrigin(req)) {
    return NextResponse.json({ error: "Invalid request origin" }, { status: 403 });
  }

  const user = await requireCompleteProfile();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id: activityId } = await params;

  let body: { text?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const text = typeof body.text === "string" ? body.text.trim() : "";
  if (text.length > MAX_SUBMISSION) {
    return NextResponse.json(
      { error: "That answer is too long. Please shorten it." },
      { status: 400 },
    );
  }

  // Membership is the authorisation: only a targeted student may submit.
  const target = await db.classActivityTarget.findUnique({
    where: { activityId_studentId: { activityId, studentId: user.id } },
    select: {
      id: true,
      markedAt: true,
      _count: { select: { files: { where: { deletedAt: null } } } },
    },
  });
  if (!target) {
    return NextResponse.json({ error: "Activity not found" }, { status: 404 });
  }

  if (target.markedAt) {
    return NextResponse.json(
      { error: "Your teacher has already marked this, so it can no longer be changed." },
      { status: 409 },
    );
  }

  const activity = await db.classActivity.findUnique({
    where: { id: activityId },
    select: { format: true, status: true, requiresSubmission: true },
  });
  if (!activity) {
    return NextResponse.json({ error: "Activity not found" }, { status: 404 });
  }
  if (activity.format !== "DOCUMENT" || !activity.requiresSubmission) {
    return NextResponse.json(
      { error: "This activity does not take a written answer." },
      { status: 400 },
    );
  }
  // Anything other than PUBLISHED, not just CLOSED: a DRAFT has not been
  // given to anyone yet, and must not become reachable by guessing its id.
  if (activity.status !== "PUBLISHED") {
    return NextResponse.json(
      { error: "This activity is not open." },
      { status: 403 },
    );
  }

  // Empty text is only a withdrawal if there is nothing attached either.
  const hasFiles = target._count.files > 0;
  if (text.length < 1 && !hasFiles) {
    return NextResponse.json(
      { error: "Write your answer or attach a file first." },
      { status: 400 },
    );
  }

  const now = new Date();
  await db.classActivityTarget.update({
    where: { id: target.id },
    data: {
      submissionText: text || null,
      // Handing in IS completing it, so the two stay in step rather than
      // asking the student to press two different buttons.
      submittedAt: now,
      completedAt: now,
    },
  });

  return NextResponse.json({ ok: true, submittedAt: now });
}
