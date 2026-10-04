import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getCurrentUser } from "@/lib/get-session";
import { validateCsrfOrigin } from "@/lib/csrf";
import { examDeadline, finishAttempt } from "@/lib/national-exam";

const SUBMIT_GRACE_MS = 2 * 60_000;

/**
 * POST /api/national-exams/attempts/[aid]/submit — finish an attempt.
 * Exam mode sends all its answers here; practice mode has already recorded
 * them one by one and sends nothing. No points are awarded.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ aid: string }> }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!validateCsrfOrigin(request)) return NextResponse.json({ error: "Invalid request origin" }, { status: 403 });
  const { aid } = await params;
  const body = (await request.json().catch(() => ({}))) as { answers?: unknown };

  const attempt = await db.nationalExamAttempt.findFirst({
    where: { id: aid, studentId: user.id },
    select: { id: true, mode: true, completedAt: true, startedAt: true, exam: { select: { durationMinutes: true } } },
  });
  if (!attempt) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (attempt.completedAt) return NextResponse.json({ id: attempt.id, alreadyFinished: true });

  // Answers sent well after the time ran out are ignored; what was saved in
  // time counts. The grace covers the auto-submit's own network delay.
  const inTime = examDeadline(attempt.startedAt, attempt.exam.durationMinutes).getTime() + SUBMIT_GRACE_MS > Date.now();
  const score = await finishAttempt(aid, attempt.mode === "EXAM" && inTime && body.answers ? body.answers : undefined);
  return NextResponse.json({ id: aid, ...score });
}
