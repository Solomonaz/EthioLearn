import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getCurrentUser } from "@/lib/get-session";
import { validateCsrfOrigin } from "@/lib/csrf";

/**
 * Mark one student's submission.
 *
 * A mark is optional: plenty of classwork earns written feedback and no score,
 * and an activity set without `maxMarks` has nothing to score against. So
 * `markedAt` — never `marks` — is what "has this been marked" tests.
 *
 * Marking freezes the submission (the student route refuses to overwrite once
 * `markedAt` is set), so a mark always describes the work it was given for.
 * Clearing the mark unfreezes it, which is how a teacher hands something back
 * to be redone.
 */

const MAX_FEEDBACK = 4000;

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; studentId: string }> },
) {
  if (!validateCsrfOrigin(req)) {
    return NextResponse.json({ error: "Invalid request origin" }, { status: 403 });
  }

  const user = await getCurrentUser();
  if (!user || user.role !== "SECONDARY_TEACHER" || !user.schoolId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  }

  const { id: activityId, studentId } = await params;

  let body: {
    marks?: unknown;
    feedback?: unknown;
    clear?: unknown;
    /**
     * What the work is out of, when the activity was set without a total.
     * Only accepted while it is still unset — see below.
     */
    maxMarks?: unknown;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  // Scoped to the owning teacher, so one teacher cannot mark another's class.
  const activity = await db.classActivity.findFirst({
    where: { id: activityId, teacherId: user.id },
    select: { id: true, maxMarks: true, format: true },
  });
  if (!activity) {
    return NextResponse.json({ error: "Activity not found" }, { status: 404 });
  }

  const target = await db.classActivityTarget.findUnique({
    where: { activityId_studentId: { activityId, studentId } },
    select: { id: true, submittedAt: true },
  });
  if (!target) {
    return NextResponse.json({ error: "Student not found" }, { status: 404 });
  }

  // ── Hand it back: clears the mark and unfreezes the submission ────────
  if (body.clear === true) {
    await db.classActivityTarget.update({
      where: { id: target.id },
      data: { marks: null, feedback: null, markedAt: null, markedById: null },
    });
    return NextResponse.json({ ok: true, marked: false });
  }

  if (!target.submittedAt) {
    return NextResponse.json(
      { error: "That student has not handed anything in yet." },
      { status: 400 },
    );
  }

  // ── What the work is out of ───────────────────────────────────────────
  //
  // A teacher often decides the total only once they start marking and see
  // what the work actually demanded. Refusing a mark because the total was
  // left blank at creation strands them with no way to fix it — the activity
  // is already published and its content is frozen.
  //
  // So the total may be set HERE, but only while it is still unset. Changing
  // it afterwards would silently rescale every mark already awarded: a 16
  // that meant 16/20 would quietly become 16/25.
  let effectiveMax = activity.maxMarks;
  if (
    activity.maxMarks === null &&
    body.maxMarks !== null &&
    body.maxMarks !== undefined &&
    body.maxMarks !== ""
  ) {
    const m = Number(body.maxMarks);
    if (!Number.isInteger(m) || m < 1 || m > 1000) {
      return NextResponse.json(
        { error: "The total must be a whole number between 1 and 1000." },
        { status: 400 },
      );
    }
    effectiveMax = m;
  }

  // ── Marks ─────────────────────────────────────────────────────────────
  let marks: number | null = null;
  if (body.marks !== null && body.marks !== undefined && body.marks !== "") {
    const n = Number(body.marks);
    if (!Number.isInteger(n) || n < 0) {
      return NextResponse.json(
        { error: "Marks must be a whole number, or left blank." },
        { status: 400 },
      );
    }
    if (effectiveMax === null) {
      return NextResponse.json(
        { error: "Set what this work is out of before giving a mark." },
        { status: 400 },
      );
    }
    if (n > effectiveMax) {
      return NextResponse.json(
        { error: `Marks cannot be more than ${effectiveMax}.` },
        { status: 400 },
      );
    }
    marks = n;
  }

  const feedback =
    typeof body.feedback === "string" && body.feedback.trim()
      ? body.feedback.trim().slice(0, MAX_FEEDBACK)
      : null;

  if (marks === null && !feedback) {
    return NextResponse.json(
      { error: "Give a mark or some feedback before saving." },
      { status: 400 },
    );
  }

  // One transaction: a mark that saved while the total it depends on did not
  // would be meaningless.
  const [updated] = await db.$transaction([
    db.classActivityTarget.update({
      where: { id: target.id },
      data: {
        marks,
        feedback,
        markedAt: new Date(),
        markedById: user.id,
      },
      select: { marks: true, feedback: true, markedAt: true },
    }),
    ...(effectiveMax !== null && activity.maxMarks === null
      ? [
          db.classActivity.update({
            where: { id: activity.id },
            data: { maxMarks: effectiveMax, requiresSubmission: true },
          }),
        ]
      : []),
  ]);

  return NextResponse.json({
    ok: true,
    marked: true,
    ...updated,
    maxMarks: effectiveMax,
  });
}
