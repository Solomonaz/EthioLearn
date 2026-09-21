import { NextRequest, NextResponse } from "next/server";
import { readFile } from "fs/promises";
import { db } from "@/lib/db";
import { getCurrentUser } from "@/lib/get-session";
import { resolveStoredPath, safeDownloadName } from "@/lib/uploads";

/**
 * Download one student's submitted file.
 *
 * This is the only way bytes leave the upload directory — nothing is served
 * statically — so the whole access decision lives here.
 *
 * Who may read a submission:
 *
 *   • THE STUDENT who uploaded it. Nobody else's student account, ever: a
 *     classmate is not entitled to another child's work.
 *   • THE TEACHER who set the activity. Not "any teacher of that class" —
 *     the activity records who set it, and that is who marks it.
 *   • A SCHOOL_ADMIN of the school the activity belongs to. They are
 *     accountable for the work their school sets, and they are the one who
 *     handles a dispute about a mark.
 *   • A SUPER_ADMIN.
 *
 * Everyone else gets 404, not 403 — a 403 would confirm the file exists, and
 * these ids should not be probeable.
 *
 * Files always go out as ATTACHMENTS with the content type this server
 * decided at upload time, never the one the client declared. A submission is
 * never rendered in the origin of a logged-in user.
 */

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ fileId: string }> },
) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { fileId } = await params;

  const file = await db.submissionFile.findUnique({
    where: { id: fileId },
    select: {
      id: true,
      studentId: true,
      schoolId: true,
      originalName: true,
      storedPath: true,
      mimeType: true,
      deletedAt: true,
      target: {
        select: {
          activity: { select: { teacherId: true } },
        },
      },
    },
  });

  if (!file) {
    return NextResponse.json({ error: "File not found" }, { status: 404 });
  }

  const isOwner = user.id === file.studentId;
  const isTeacher = user.id === file.target.activity.teacherId;
  const isSchoolAdmin =
    user.role === "SCHOOL_ADMIN" && !!user.schoolId && user.schoolId === file.schoolId;
  const isSuperAdmin = user.role === "SUPER_ADMIN";

  if (!isOwner && !isTeacher && !isSchoolAdmin && !isSuperAdmin) {
    return NextResponse.json({ error: "File not found" }, { status: 404 });
  }

  // A withdrawn file stays readable to staff — a teacher may have already
  // marked against it — but the student who withdrew it no longer sees it.
  if (file.deletedAt && isOwner && !isTeacher && !isSchoolAdmin && !isSuperAdmin) {
    return NextResponse.json({ error: "File not found" }, { status: 404 });
  }

  const abs = resolveStoredPath(file.storedPath);
  if (!abs) {
    console.error("[Submission download] path escaped upload root:", file.id);
    return NextResponse.json({ error: "File not found" }, { status: 404 });
  }

  let bytes: Buffer;
  try {
    bytes = await readFile(abs);
  } catch {
    // The row exists but the bytes do not — a lost volume, or a restore that
    // brought the database back without the files. Say so plainly rather than
    // returning an empty download.
    console.error("[Submission download] missing bytes for", file.id, file.storedPath);
    return NextResponse.json(
      { error: "That file is no longer available on the server." },
      { status: 410 },
    );
  }

  return new NextResponse(new Uint8Array(bytes), {
    headers: {
      "Content-Type": file.mimeType,
      "Content-Length": String(bytes.length),
      "Content-Disposition": `attachment; filename="${safeDownloadName(file.originalName)}"`,
      // Submissions are personal data; no shared cache should keep a copy.
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
