import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getCurrentUser } from "@/lib/get-session";

/**
 * GET /api/national-exams — published past papers, with the student's best
 * finished score on each. Practice only: no points are involved anywhere.
 */
export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const [exams, attempts] = await Promise.all([
    db.nationalExam.findMany({
      where: { status: "PUBLISHED" },
      orderBy: [{ subject: "asc" }, { yearLabel: "desc" }],
      select: { id: true, subject: true, yearLabel: true, stream: true, durationMinutes: true, questionCount: true },
    }),
    db.nationalExamAttempt.findMany({
      where: { studentId: user.id, completedAt: { not: null } },
      select: { examId: true, correctCount: true, totalQuestions: true, completedAt: true },
    }),
  ]);

  const best = new Map<string, { percent: number; attempts: number }>();
  for (const a of attempts) {
    const percent = a.totalQuestions ? Math.round((a.correctCount / a.totalQuestions) * 100) : 0;
    const prev = best.get(a.examId);
    best.set(a.examId, { percent: Math.max(prev?.percent ?? 0, percent), attempts: (prev?.attempts ?? 0) + 1 });
  }
  return NextResponse.json({
    exams: exams.map((e) => ({ ...e, bestPercent: best.get(e.id)?.percent ?? null, attemptCount: best.get(e.id)?.attempts ?? 0 })),
  });
}
