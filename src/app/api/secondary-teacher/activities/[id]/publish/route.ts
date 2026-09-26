import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getCurrentUser } from "@/lib/get-session";
import { validateCsrfOrigin } from "@/lib/csrf";
import { rateLimit } from "@/lib/rate-limit";
import { publishActivity } from "@/lib/activity-send";

/**
 * Send a reviewed draft to the class.
 *
 * Generated work is created as a DRAFT and goes nowhere until a teacher has
 * read it. AI writes wrong answers as confidently as right ones, and a class
 * cannot un-see a paper — so publishing is a deliberate act by the person
 * accountable for the content, not a side effect of generating it.
 *
 * This is the ONLY place a class is notified about work. Notifying at
 * creation is what made a half-checked worksheet arrive on thirty phones
 * before its author had read it.
 *
 * Only the teacher who set it may publish it. Not "a teacher of that class" —
 * the draft is that teacher's unfinished work until they say otherwise.
 */

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  if (!validateCsrfOrigin(req)) {
    return NextResponse.json({ error: "Invalid request origin" }, { status: 403 });
  }

  const user = await getCurrentUser();
  if (!user || user.role !== "SECONDARY_TEACHER" || !user.schoolId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  }

  const rl = rateLimit("secondary-teacher:publish:" + user.id, 30, 60_000);
  if (!rl.success) {
    return NextResponse.json(
      { error: "Too many requests. Please slow down." },
      { status: 429, headers: { "Retry-After": String(rl.retryAfter) } },
    );
  }

  const { id } = await params;

  const activity = await db.classActivity.findFirst({
    where: { id, teacherId: user.id },
    select: {
      id: true,
      status: true,
      kind: true,
      title: true,
      subject: true,
      format: true,
      body: true,
      _count: { select: { targets: true, questions: true } },
    },
  });

  if (!activity) {
    return NextResponse.json({ error: "Activity not found" }, { status: 404 });
  }

  // Publishing twice would send the class a second notification about work
  // they already have.
  if (activity.status !== "DRAFT") {
    return NextResponse.json(
      { error: "That activity has already been sent to the class." },
      { status: 409 },
    );
  }

  // An empty paper is not work. This can only happen if every question was
  // removed during review, and sending it would be worse than refusing.
  if (activity.format === "QUESTIONS" && activity._count.questions === 0) {
    return NextResponse.json(
      { error: "There are no questions left. Add some or discard this draft." },
      { status: 400 },
    );
  }
  if (activity.format === "DOCUMENT" && !activity.body?.trim()) {
    return NextResponse.json(
      { error: "There is nothing for the class to read." },
      { status: 400 },
    );
  }

  const { publishedAt, notified } = await publishActivity(activity);

  return NextResponse.json({ ok: true, publishedAt, notified });
}
