import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireCompleteProfile } from "@/lib/get-session";
import { validateCsrfOrigin } from "@/lib/csrf";
import { rateLimit } from "@/lib/rate-limit";
import {
  ACCEPTED_LABEL,
  MAX_FILE_BYTES,
  MAX_FILES_PER_SUBMISSION,
  deleteStoredFile,
  storeSubmissionFile,
} from "@/lib/uploads";

/**
 * Hand in a FILE against work a teacher set — a photo of worked calculations,
 * a scan, a typed document.
 *
 * Who may upload, and against what, is not a matter of trusting the request:
 *
 *   • The student must be TARGETED by the activity. Membership of
 *     `ClassActivityTarget` is the authorisation — it is how the platform
 *     already decides who owes the work, and it cannot be forged from the
 *     client because the teacher materialised it when setting the activity.
 *   • The activity must be one that actually takes a hand-in, and must still
 *     be open.
 *   • Nothing may change once the teacher has marked it, or the mark would
 *     stop describing the work it was given for.
 *
 * The file is stored under the activity and student that this route resolved
 * server-side — never under anything the client named.
 */

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

  // Uploads are the most expensive thing a student can do to this server, so
  // they are bounded well below the general API limit.
  const rl = rateLimit("student:upload:" + user.id, 20, 60_000);
  if (!rl.success) {
    return NextResponse.json(
      { error: "Too many uploads. Please wait a moment." },
      { status: 429, headers: { "Retry-After": String(rl.retryAfter) } },
    );
  }

  const { id: activityId } = await params;

  // ── May this student hand anything in here at all? ────────────────────
  const target = await db.classActivityTarget.findUnique({
    where: { activityId_studentId: { activityId, studentId: user.id } },
    select: {
      id: true,
      markedAt: true,
      activity: {
        select: {
          id: true,
          schoolId: true,
          status: true,
          format: true,
          requiresSubmission: true,
        },
      },
    },
  });

  // Same 404 for "no such activity" and "not yours", so this cannot be used
  // to discover which activity ids exist.
  if (!target) {
    return NextResponse.json({ error: "Activity not found" }, { status: 404 });
  }
  if (target.markedAt) {
    return NextResponse.json(
      { error: "Your teacher has already marked this, so it can no longer be changed." },
      { status: 409 },
    );
  }

  const activity = target.activity;
  if (activity.format !== "DOCUMENT" || !activity.requiresSubmission) {
    return NextResponse.json(
      { error: "This activity does not take a hand-in." },
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

  // ── The upload itself ─────────────────────────────────────────────────
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ error: "Could not read that upload." }, { status: 400 });
  }

  const incoming = form.getAll("files").filter((f): f is File => f instanceof File);
  if (incoming.length === 0) {
    return NextResponse.json({ error: "Choose a file first." }, { status: 400 });
  }

  const existingCount = await db.submissionFile.count({
    where: { targetId: target.id, deletedAt: null },
  });
  if (existingCount + incoming.length > MAX_FILES_PER_SUBMISSION) {
    return NextResponse.json(
      {
        error: `You can attach up to ${MAX_FILES_PER_SUBMISSION} files. Remove one first.`,
      },
      { status: 400 },
    );
  }

  // Refuse an oversized file before reading it into memory.
  for (const file of incoming) {
    if (file.size > MAX_FILE_BYTES) {
      return NextResponse.json(
        {
          error: `"${file.name}" is too large. The limit is ${Math.floor(
            MAX_FILE_BYTES / (1024 * 1024),
          )} MB per file.`,
        },
        { status: 413 },
      );
    }
  }

  const saved: { id: string; originalName: string; sizeBytes: number }[] = [];
  const writtenPaths: string[] = [];

  try {
    for (const file of incoming) {
      const buf = Buffer.from(await file.arrayBuffer());
      const stored = await storeSubmissionFile({
        buf,
        originalName: file.name,
        activityId: activity.id,
        studentId: user.id,
      });
      if (!stored.ok) {
        return NextResponse.json({ error: stored.error }, { status: 400 });
      }
      writtenPaths.push(stored.file.storedPath);

      const row = await db.submissionFile.create({
        data: {
          targetId: target.id,
          studentId: user.id,
          // From the activity, never from the student's own profile: the
          // activity is what decides which school may read this back.
          schoolId: activity.schoolId,
          originalName: file.name.slice(0, 200),
          storedPath: stored.file.storedPath,
          mimeType: stored.file.contentType,
          sizeBytes: stored.file.sizeBytes,
          checksum: stored.file.checksum,
        },
        select: { id: true, originalName: true, sizeBytes: true },
      });
      saved.push(row);
    }
  } catch (err) {
    // A half-written upload would leave orphaned bytes on disk with no row
    // pointing at them, so unwind what this request created.
    await Promise.allSettled(writtenPaths.map((p) => deleteStoredFile(p)));
    if (saved.length > 0) {
      await db.submissionFile
        .deleteMany({ where: { id: { in: saved.map((s) => s.id) } } })
        .catch(() => {});
    }
    console.error("[Submission upload]", err);
    return NextResponse.json(
      { error: `Upload failed. Accepted types are ${ACCEPTED_LABEL}.` },
      { status: 500 },
    );
  }

  // Attaching work IS handing it in. Without this a student could upload and
  // still show as "not started", which is exactly the confusion that made
  // written assignments unreadable on the teacher's side before.
  const now = new Date();
  await db.classActivityTarget.update({
    where: { id: target.id },
    data: { submittedAt: now, completedAt: now },
  });

  return NextResponse.json({ files: saved, submittedAt: now }, { status: 201 });
}
