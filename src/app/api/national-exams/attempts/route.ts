import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getCurrentUser } from "@/lib/get-session";

/** GET /api/national-exams/attempts — the student's finished papers, newest first, to track progress. */
export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const attempts = await db.nationalExamAttempt.findMany({
    where: { studentId: user.id, completedAt: { not: null }, exam: { status: "PUBLISHED" } },
    orderBy: { completedAt: "desc" },
    take: 50,
    select: {
      id: true, mode: true, correctCount: true, totalQuestions: true, startedAt: true, completedAt: true,
      exam: { select: { id: true, subject: true, yearLabel: true, stream: true } },
    },
  });
  return NextResponse.json({
    attempts: attempts.map((a) => ({
      ...a,
      percent: a.totalQuestions ? Math.round((a.correctCount / a.totalQuestions) * 100) : 0,
    })),
  });
}
