import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getCurrentUser } from "@/lib/get-session";
import { validateCsrfOrigin } from "@/lib/csrf";
import { cleanAnswers, examDeadline } from "@/lib/national-exam";

/**
 * POST /api/national-exams/attempts/[aid]/progress — exam mode: save the
 * answers chosen so far, without checking them, so a reload or a dropped
 * connection loses nothing. Refused once the time is up.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ aid: string }> }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!validateCsrfOrigin(request)) return NextResponse.json({ error: "Invalid request origin" }, { status: 403 });
  const { aid } = await params;
  const body = (await request.json().catch(() => ({}))) as { answers?: unknown };

  const attempt = await db.nationalExamAttempt.findFirst({
    where: { id: aid, studentId: user.id },
    select: {
      mode: true, completedAt: true, startedAt: true,
      exam: { select: { durationMinutes: true, questions: { select: { id: true, options: true } } } },
    },
  });
  if (!attempt) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (attempt.mode !== "EXAM") return NextResponse.json({ error: "Practice answers are saved as you go." }, { status: 409 });
  if (attempt.completedAt) return NextResponse.json({ error: "This attempt is finished." }, { status: 409 });
  if (examDeadline(attempt.startedAt, attempt.exam.durationMinutes) <= new Date()) {
    return NextResponse.json({ error: "Time is up." }, { status: 409 });
  }

  await db.nationalExamAttempt.updateMany({
    where: { id: aid, completedAt: null },
    data: { answers: cleanAnswers(body.answers, attempt.exam.questions) },
  });
  return NextResponse.json({ success: true });
}
