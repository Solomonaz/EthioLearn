import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getCurrentUser } from "@/lib/get-session";
import { validateCsrfOrigin } from "@/lib/csrf";

/**
 * POST /api/national-exams/attempts/[aid]/answer — practice mode only: record
 * one answer and reveal whether it was right, with the explanation. The first
 * answer to a question counts, so trying options until one turns green does
 * not inflate the score.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ aid: string }> }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!validateCsrfOrigin(request)) return NextResponse.json({ error: "Invalid request origin" }, { status: 403 });
  const { aid } = await params;
  const body = (await request.json().catch(() => ({}))) as { questionId?: string; answer?: string };

  const attempt = await db.nationalExamAttempt.findFirst({
    where: { id: aid, studentId: user.id },
    select: { id: true, mode: true, completedAt: true, answers: true, examId: true },
  });
  if (!attempt) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (attempt.mode !== "PRACTICE") return NextResponse.json({ error: "Answers are checked at the end in exam mode." }, { status: 409 });
  if (attempt.completedAt) return NextResponse.json({ error: "This attempt is finished." }, { status: 409 });

  const q = await db.nationalExamQuestion.findFirst({
    where: { id: String(body.questionId ?? ""), examId: attempt.examId },
    select: { id: true, options: true, correctAnswer: true, explanation: true },
  });
  if (!q) return NextResponse.json({ error: "Question not found" }, { status: 404 });
  const answer = String(body.answer ?? "");
  if (!(q.options as string[]).includes(answer)) return NextResponse.json({ error: "Invalid answer" }, { status: 400 });

  const answers = { ...((attempt.answers as Record<string, string>) ?? {}) };
  if (!(q.id in answers)) {
    answers[q.id] = answer;
    await db.nationalExamAttempt.update({ where: { id: aid }, data: { answers } });
  }
  return NextResponse.json({
    isCorrect: answer === q.correctAnswer,
    correctAnswer: q.correctAnswer,
    explanation: q.explanation,
  });
}
