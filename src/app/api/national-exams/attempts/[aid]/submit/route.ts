import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getCurrentUser } from "@/lib/get-session";
import { validateCsrfOrigin } from "@/lib/csrf";
import { cleanAnswers } from "@/lib/national-exam";

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
    select: {
      id: true, mode: true, completedAt: true, answers: true,
      exam: { select: { questions: { select: { id: true, options: true, correctAnswer: true } } } },
    },
  });
  if (!attempt) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (attempt.completedAt) return NextResponse.json({ id: attempt.id, alreadyFinished: true });

  const questions = attempt.exam.questions;
  const answers = attempt.mode === "EXAM" ? cleanAnswers(body.answers, questions) : cleanAnswers(attempt.answers, questions);
  const correctCount = questions.filter((q) => q.correctAnswer && answers[q.id] === q.correctAnswer).length;

  await db.nationalExamAttempt.update({
    where: { id: aid },
    data: { answers, correctCount, totalQuestions: questions.length, completedAt: new Date() },
  });
  return NextResponse.json({ id: aid, correctCount, totalQuestions: questions.length });
}
