import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireCompleteProfile } from "@/lib/get-session";

/**
 * A student's inbox of teacher-set activities.
 *
 * Nothing here is ever marked late. A due date is advisory — the same work may
 * have been handed in on paper — so overdue items simply stay open.
 */
export async function GET() {
  const user = await requireCompleteProfile();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const targets = await db.classActivityTarget.findMany({
    where: { studentId: user.id, activity: { status: "PUBLISHED" } },
    orderBy: { activity: { createdAt: "desc" } },
    take: 100,
    select: {
      completedAt: true,
      submissionText: true,
      submittedAt: true,
      marks: true,
      feedback: true,
      markedAt: true,
      files: {
        where: { deletedAt: null },
        orderBy: { uploadedAt: "asc" },
        select: { id: true, originalName: true, sizeBytes: true, uploadedAt: true },
      },
      activity: {
        select: {
          id: true,
          kind: true,
          format: true,
          requiresSubmission: true,
          maxMarks: true,
          title: true,
          instructions: true,
          body: true,
          dueAt: true,
          subject: true,
          grade: true,
          questionCount: true,
          createdAt: true,
          chapter: { select: { title: true, chapterNumber: true } },
          teacher: { select: { name: true } },
        },
      },
    },
  });

  if (targets.length === 0) {
    return NextResponse.json({ activities: [] });
  }

  const activityIds = targets.map((t) => t.activity.id);

  // This student's own attempts, so the inbox can say done / in progress.
  const attempts = await db.quiz.findMany({
    where: { studentId: user.id, activityId: { in: activityIds } },
    select: {
      id: true,
      activityId: true,
      completedAt: true,
      correctAnswers: true,
      totalQuestions: true,
    },
  });

  const bestByActivity = new Map<string, (typeof attempts)[number]>();
  for (const a of attempts) {
    if (!a.activityId) continue;
    const existing = bestByActivity.get(a.activityId);
    if (!existing || (!existing.completedAt && a.completedAt)) {
      bestByActivity.set(a.activityId, a);
    }
  }

  const activities = targets.map((t) => {
    const a = t.activity;
    const isDoc = a.format === "DOCUMENT";
    const attempt = bestByActivity.get(a.id);

    // Written work: marked beats handed-in beats acknowledged. A question
    // paper is done when its quiz is submitted.
    const state = isDoc
      ? t.markedAt
        ? "marked"
        : t.submittedAt
          ? "submitted"
          : t.completedAt
            ? "done"
            : "not_started"
      : !attempt
        ? "not_started"
        : attempt.completedAt
          ? "done"
          : "in_progress";

    return {
      id: a.id,
      kind: a.kind,
      format: a.format,
      title: a.title,
      instructions: a.instructions,
      // Only sent for written work — a question paper's body is null anyway.
      body: isDoc ? a.body : null,
      dueAt: a.dueAt,
      subject: a.subject,
      grade: a.grade,
      questionCount: a.questionCount,
      createdAt: a.createdAt,
      chapter: a.chapter,
      teacherName: a.teacher?.name ?? null,
      requiresSubmission: isDoc ? a.requiresSubmission : false,
      maxMarks: isDoc ? a.maxMarks : null,
      submissionText: isDoc ? t.submissionText : null,
      // What they attached. Only for written work — a question paper has no
      // hand-in — and only files they have not withdrawn.
      files: isDoc ? t.files : [],
      submittedAt: isDoc ? t.submittedAt : null,
      marks: isDoc ? t.marks : null,
      feedback: isDoc ? t.feedback : null,
      markedAt: isDoc ? t.markedAt : null,
      state,
      quizId: !isDoc && attempt && !attempt.completedAt ? attempt.id : null,
      correctAnswers: !isDoc && attempt?.completedAt ? attempt.correctAnswers : null,
      totalQuestions: !isDoc && attempt?.completedAt ? attempt.totalQuestions : null,
    };
  });

  // Unfinished work first; among those, the soonest due date leads.
  activities.sort((a, b) => {
    const rank: Record<string, number> = {
      not_started: 0,
      in_progress: 0,
      submitted: 1,
      done: 2,
      marked: 2,
    };
    const d = (rank[a.state] ?? 0) - (rank[b.state] ?? 0);
    if (d !== 0) return d;
    if (a.dueAt && b.dueAt) return new Date(a.dueAt).getTime() - new Date(b.dueAt).getTime();
    if (a.dueAt) return -1;
    if (b.dueAt) return 1;
    return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
  });

  return NextResponse.json({ activities });
}
