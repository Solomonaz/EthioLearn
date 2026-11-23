import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getCurrentUser } from "@/lib/get-session";

/**
 * GET /api/ai/why-wrong/recent
 *
 * The signed-in student's own recent wrong answers (from finished quizzes),
 * newest first, for the Whiteboard Tutor page under the AI tutor. No AI here:
 * explaining one of them goes through POST /api/ai/why-wrong with all the
 * tutor rules. Each question is listed once (its latest wrong attempt).
 */
export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const rows = await db.quizAnswer.findMany({
    where: {
      isCorrect: false,
      quiz: { studentId: user.id, completedAt: { not: null } },
    },
    orderBy: { quiz: { completedAt: "desc" } },
    take: 80,
    select: {
      quizId: true,
      questionId: true,
      studentAnswer: true,
      quiz: { select: { completedAt: true } },
      question: {
        select: {
          questionText: true,
          correctAnswer: true,
          chapter: { select: { title: true, textbook: { select: { subject: true, grade: true } } } },
        },
      },
    },
  });

  const seen = new Set<string>();
  const mistakes = [];
  for (const r of rows) {
    if (seen.has(r.questionId) || !r.question.chapter) continue;
    seen.add(r.questionId);
    mistakes.push({
      quizId: r.quizId,
      questionId: r.questionId,
      questionText: r.question.questionText,
      studentAnswer: r.studentAnswer,
      correctAnswer: r.question.correctAnswer,
      chapterTitle: r.question.chapter.title,
      subject: r.question.chapter.textbook.subject,
      grade: r.question.chapter.textbook.grade,
      completedAt: r.quiz.completedAt,
    });
    if (mistakes.length >= 25) break;
  }

  return NextResponse.json({ mistakes });
}
