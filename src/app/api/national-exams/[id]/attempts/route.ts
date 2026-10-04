import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getCurrentUser } from "@/lib/get-session";
import { validateCsrfOrigin } from "@/lib/csrf";
import { publicQuestion } from "@/lib/national-exam";

/**
 * POST /api/national-exams/[id]/attempts — start a paper in EXAM (timed,
 * answers revealed only after submitting) or PRACTICE (untimed, answer shown
 * after each question) mode. Returns the questions without their answers.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (user.role !== "STUDENT") return NextResponse.json({ error: "Only students can take a paper." }, { status: 403 });
  if (!validateCsrfOrigin(request)) return NextResponse.json({ error: "Invalid request origin" }, { status: 403 });

  const { id } = await params;
  const body = (await request.json().catch(() => ({}))) as { mode?: string };
  const mode = body.mode === "PRACTICE" ? "PRACTICE" : "EXAM";

  const exam = await db.nationalExam.findFirst({
    where: { id, status: "PUBLISHED" },
    select: {
      id: true, subject: true, yearLabel: true, stream: true, durationMinutes: true,
      questions: {
        orderBy: { number: "asc" },
        select: { id: true, number: true, questionText: true, options: true, imageFile: true },
      },
    },
  });
  if (!exam) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const attempt = await db.nationalExamAttempt.create({
    data: { examId: exam.id, studentId: user.id, mode, totalQuestions: exam.questions.length },
    select: { id: true, startedAt: true },
  });

  const { questions, ...meta } = exam;
  return NextResponse.json({
    attemptId: attempt.id,
    startedAt: attempt.startedAt,
    mode,
    exam: meta,
    questions: questions.map(publicQuestion),
  });
}
