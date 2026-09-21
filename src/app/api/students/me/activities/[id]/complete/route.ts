import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireCompleteProfile } from "@/lib/get-session";
import { validateCsrfOrigin } from "@/lib/csrf";

/**
 * Mark a DOCUMENT activity done (or undo that).
 *
 * Written work has nothing to auto-mark — it may well have been done in an
 * exercise book — so the student saying "done" is the only honest completion
 * signal. Question papers do NOT go through here: their completion is derived
 * from the submitted quiz, and letting a student set it directly would let
 * them mark a paper done without sitting it.
 *
 * Undo is allowed: a mis-tap should not be permanent. Nothing about this is
 * graded, so there is nothing to protect by making it one-way.
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

  const { id: activityId } = await params;

  let body: { done?: unknown };
  try {
    body = await req.json();
  } catch {
    body = {};
  }
  const done = body.done !== false;

  // Membership is the authorisation: only a targeted student may touch this.
  const target = await db.classActivityTarget.findUnique({
    where: { activityId_studentId: { activityId, studentId: user.id } },
    select: { id: true },
  });
  if (!target) {
    return NextResponse.json({ error: "Activity not found" }, { status: 404 });
  }

  const activity = await db.classActivity.findUnique({
    where: { id: activityId },
    select: { format: true, status: true },
  });
  if (!activity) {
    return NextResponse.json({ error: "Activity not found" }, { status: 404 });
  }
  if (activity.format !== "DOCUMENT") {
    return NextResponse.json(
      { error: "Finish this by answering the questions." },
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

  await db.classActivityTarget.update({
    where: { id: target.id },
    data: { completedAt: done ? new Date() : null },
  });

  return NextResponse.json({ ok: true, done });
}
