import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getCurrentUser } from "@/lib/get-session";
import { examDeadline } from "@/lib/national-exam";

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
      where: { studentId: user.id },
      select: { examId: true, mode: true, correctCount: true, totalQuestions: true, startedAt: true, completedAt: true },
    }),
  ]);

  const best = new Map<string, { percent: number; attempts: number }>();
  const inProgress = new Map<string, string[]>();
  const duration = new Map(exams.map((e) => [e.id, e.durationMinutes]));
  const now = new Date();
  for (const a of attempts) {
    if (!a.completedAt) {
      // An exam attempt whose time ran out cannot be continued.
      const minutes = duration.get(a.examId);
      if (minutes === undefined || (a.mode === "EXAM" && examDeadline(a.startedAt, minutes) <= now)) continue;
      inProgress.set(a.examId, [...(inProgress.get(a.examId) ?? []), a.mode]);
      continue;
    }
    const percent = a.totalQuestions ? Math.round((a.correctCount / a.totalQuestions) * 100) : 0;
    const prev = best.get(a.examId);
    best.set(a.examId, { percent: Math.max(prev?.percent ?? 0, percent), attempts: (prev?.attempts ?? 0) + 1 });
  }
  return NextResponse.json({
    exams: exams.map((e) => ({
      ...e,
      bestPercent: best.get(e.id)?.percent ?? null,
      attemptCount: best.get(e.id)?.attempts ?? 0,
      inProgress: inProgress.get(e.id) ?? [],
    })),
  });
}
