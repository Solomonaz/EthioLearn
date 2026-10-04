import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getCurrentUser } from "@/lib/get-session";
import { buildReview } from "@/lib/national-exam";

/** GET /api/national-exams/attempts/[aid] — a finished attempt's score and full review. */
export async function GET(_request: NextRequest, { params }: { params: Promise<{ aid: string }> }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { aid } = await params;

  const attempt = await db.nationalExamAttempt.findFirst({
    where: { id: aid, studentId: user.id },
    select: {
      id: true, mode: true, answers: true, correctCount: true, totalQuestions: true, startedAt: true, completedAt: true,
      exam: {
        select: {
          id: true, subject: true, yearLabel: true, stream: true,
          questions: {
            orderBy: { number: "asc" },
            select: { id: true, number: true, questionText: true, options: true, correctAnswer: true, explanation: true, imageFile: true },
          },
        },
      },
    },
  });
  if (!attempt) return NextResponse.json({ error: "Not found" }, { status: 404 });
  // The answers stay hidden until the attempt is submitted.
  if (!attempt.completedAt) return NextResponse.json({ error: "This attempt is not finished yet." }, { status: 409 });

  const { exam, answers, ...rest } = attempt;
  const { questions, ...examMeta } = exam;
  return NextResponse.json({
    attempt: { ...rest, exam: examMeta, review: buildReview(questions, (answers as Record<string, string>) ?? {}) },
  });
}
