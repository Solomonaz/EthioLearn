import { NextRequest, NextResponse, after } from "next/server";
import { db } from "@/lib/db";
import { getCurrentUser } from "@/lib/get-session";
import { validateCsrfOrigin } from "@/lib/csrf";
import { createNotification } from "@/lib/notifications";
import { INGEST_TIMEOUT_MS, deleteTextbookFile, ingestApprovedTextbook } from "@/lib/textbook-ingest";

type RouteParams = { params: Promise<{ id: string }> };

interface ReviewBody {
  decision?: "approve" | "reject" | "retry";
  note?: string;
  /** Approve into the national library (schoolId = null) so every school gets it. */
  toLibrary?: boolean;
}

/**
 * POST /api/admin/textbooks/[id]/review — super admin decides on a school's
 * textbook request.
 *
 *   approve — unlocks the book and starts chapter detection in the background
 *             (the first paid step). Optionally promotes it to the library.
 *   reject  — records the reason, drops the held file, tells the school.
 *   retry   — re-runs ingestion after a failure.
 */
export async function POST(request: NextRequest, { params }: RouteParams) {
  const user = await getCurrentUser();
  if (!user || user.role !== "SUPER_ADMIN") {
    return NextResponse.json({ error: "Only the platform admin reviews textbook requests." }, { status: 403 });
  }
  if (!validateCsrfOrigin(request)) {
    return NextResponse.json({ error: "Invalid request origin" }, { status: 403 });
  }

  let body: ReviewBody;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { id } = await params;
  const tb = await db.textbook.findUnique({
    where: { id },
    select: {
      id: true,
      title: true,
      approvalStatus: true,
      processingStatus: true,
      sourceFile: true,
      uploadedById: true,
      updatedAt: true,
    },
  });
  if (!tb) return NextResponse.json({ error: "Textbook not found" }, { status: 404 });

  const note = body.note?.trim().slice(0, 1000) || null;
  const reviewedById = user.id === "env_super_admin" ? null : user.id;

  if (body.decision === "reject") {
    if (tb.approvalStatus !== "PENDING") {
      return NextResponse.json({ error: "Only pending requests can be rejected." }, { status: 409 });
    }
    if (!note) {
      return NextResponse.json({ error: "Give the school a reason for the rejection." }, { status: 400 });
    }
    await deleteTextbookFile(tb.sourceFile);
    await db.textbook.update({
      where: { id },
      data: { approvalStatus: "REJECTED", reviewNote: note, reviewedAt: new Date(), reviewedById, sourceFile: null },
    });
    if (tb.uploadedById) {
      await createNotification(
        tb.uploadedById,
        "system",
        "Textbook request declined",
        `"${tb.title}" was not approved: ${note}`,
        { textbookId: id, href: "/school-admin/textbooks" },
      ).catch(() => {});
    }
    return NextResponse.json({ success: true, approvalStatus: "REJECTED" });
  }

  if (body.decision === "approve") {
    if (tb.approvalStatus !== "PENDING") {
      return NextResponse.json({ error: "Only pending requests can be approved." }, { status: 409 });
    }
    await db.textbook.update({
      where: { id },
      data: {
        approvalStatus: "APPROVED",
        reviewNote: note,
        reviewedAt: new Date(),
        reviewedById,
        ...(body.toLibrary ? { schoolId: null } : {}),
        ...(tb.sourceFile ? { processingStatus: "PROCESSING", processingError: null } : {}),
      },
    });
    // Chapter detection can take minutes on a long book — respond now, ingest after.
    if (tb.sourceFile) after(() => ingestApprovedTextbook(id));
    return NextResponse.json({ success: true, approvalStatus: "APPROVED", processing: !!tb.sourceFile });
  }

  if (body.decision === "retry") {
    // A run still PROCESSING long past the timeout died with the server (a
    // restart drops in-flight background work) — let it be restarted too.
    const stale =
      tb.processingStatus === "PROCESSING" && Date.now() - tb.updatedAt.getTime() > INGEST_TIMEOUT_MS * 2;
    if (tb.approvalStatus !== "APPROVED" || !(tb.processingStatus === "FAILED" || stale) || !tb.sourceFile) {
      return NextResponse.json({ error: "Nothing to retry for this textbook." }, { status: 409 });
    }
    await db.textbook.update({
      where: { id },
      data: { processingStatus: "PROCESSING", processingError: null },
    });
    after(() => ingestApprovedTextbook(id));
    return NextResponse.json({ success: true, processing: true });
  }

  return NextResponse.json({ error: "decision must be approve, reject or retry" }, { status: 400 });
}
