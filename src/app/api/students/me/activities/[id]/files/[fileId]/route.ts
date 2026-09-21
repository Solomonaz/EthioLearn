import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireCompleteProfile } from "@/lib/get-session";
import { validateCsrfOrigin } from "@/lib/csrf";

/**
 * Remove a file the student attached, before it has been marked.
 *
 * Soft delete. The bytes stay on disk and the row stays in the table with
 * `deletedAt` set, because "the student withdrew page 2" is a thing a teacher
 * may need to see later — and because a hard delete here would race with a
 * teacher who is reading the file at that moment.
 *
 * Ownership is checked on the row itself, not inferred from the activity: the
 * file id is the thing being acted on, so it is the thing that must belong to
 * the caller.
 */

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; fileId: string }> },
) {
  if (!validateCsrfOrigin(req)) {
    return NextResponse.json({ error: "Invalid request origin" }, { status: 403 });
  }

  const user = await requireCompleteProfile();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id: activityId, fileId } = await params;

  const file = await db.submissionFile.findFirst({
    where: {
      id: fileId,
      studentId: user.id,
      deletedAt: null,
      target: { activityId },
    },
    select: {
      id: true,
      targetId: true,
      target: { select: { markedAt: true } },
    },
  });

  if (!file) {
    return NextResponse.json({ error: "File not found" }, { status: 404 });
  }

  if (file.target.markedAt) {
    return NextResponse.json(
      { error: "Your teacher has already marked this, so it can no longer be changed." },
      { status: 409 },
    );
  }

  await db.submissionFile.update({
    where: { id: file.id },
    data: { deletedAt: new Date() },
  });

  // If that was the last attachment and nothing was typed either, the work is
  // no longer handed in — saying otherwise would show the teacher a
  // submission with nothing in it.
  const remaining = await db.submissionFile.count({
    where: { targetId: file.targetId, deletedAt: null },
  });
  if (remaining === 0) {
    const target = await db.classActivityTarget.findUnique({
      where: { id: file.targetId },
      select: { submissionText: true },
    });
    if (!target?.submissionText) {
      await db.classActivityTarget.update({
        where: { id: file.targetId },
        data: { submittedAt: null, completedAt: null },
      });
    }
  }

  return NextResponse.json({ ok: true, remaining });
}
