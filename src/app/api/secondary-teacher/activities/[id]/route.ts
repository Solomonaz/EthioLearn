import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getCurrentUser } from "@/lib/get-session";
import { validateCsrfOrigin } from "@/lib/csrf";
import { takeBackActivity } from "@/lib/activity-send";

/**
 * One teacher-set activity.
 *
 * GET   — who has done it, and which questions the class actually failed.
 * PATCH — close it, rename it, or move the due date.
 * DELETE — discard a draft, or take sent work back (lib/activity-send). Sent
 *          work can only be taken back while no student has started it —
 *          removing work students have done would destroy their history, so
 *          from then on closing is the way to stop it.
 */

async function getTeacher() {
  const user = await getCurrentUser();
  if (!user || user.role !== "SECONDARY_TEACHER" || !user.schoolId) return null;
  return user;
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await getTeacher();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 403 });

  const { id } = await params;

  // Scoped to the owner, so one teacher cannot read another's activity.
  const activity = await db.classActivity.findFirst({
    where: { id, teacherId: user.id },
    select: {
      id: true,
      kind: true,
      status: true,
      title: true,
      instructions: true,
      dueAt: true,
      subject: true,
      grade: true,
      section: true,
      questionCount: true,
      createdAt: true,
      format: true,
      body: true,
      // The class it was set for, so "give to another class" can leave it out.
      teachingAssignmentId: true,
      // Teacher-only. This route is scoped to the owning teacher, which is
      // what makes selecting it safe here — and why no student-facing route
      // may ever copy this select.
      answerKey: true,
      publishedAt: true,
      requiresSubmission: true,
      maxMarks: true,
      chapter: { select: { id: true, title: true, chapterNumber: true } },
      questions: {
        orderBy: { order: "asc" },
        select: {
          order: true,
          question: { select: { id: true, questionText: true, difficulty: true } },
        },
      },
      targets: {
        select: {
          completedAt: true,
          submissionText: true,
          submittedAt: true,
          marks: true,
          feedback: true,
          markedAt: true,
          // What the student attached. Withdrawn files are excluded — the
          // teacher marks what was handed in, not what was taken back.
          files: {
            where: { deletedAt: null },
            orderBy: { uploadedAt: "asc" },
            select: { id: true, originalName: true, sizeBytes: true, mimeType: true },
          },
          student: { select: { id: true, name: true, section: true } },
        },
      },
    },
  });

  if (!activity) {
    return NextResponse.json({ error: "Activity not found" }, { status: 404 });
  }

  // Every attempt at this activity, with its answers — one query, then folded
  // into per-student and per-question views in memory.
  const quizzes = await db.quiz.findMany({
    where: { activityId: id },
    select: {
      studentId: true,
      score: true,
      totalQuestions: true,
      correctAnswers: true,
      startedAt: true,
      completedAt: true,
      answers: { select: { questionId: true, isCorrect: true } },
    },
  });

  const byStudent = new Map<string, (typeof quizzes)[number]>();
  for (const q of quizzes) {
    const existing = byStudent.get(q.studentId);
    // Keep the most complete attempt: a finished one beats an abandoned one.
    if (!existing || (!existing.completedAt && q.completedAt)) {
      byStudent.set(q.studentId, q);
    }
  }

  const perQuestion = new Map<string, { answered: number; correct: number }>();
  for (const q of quizzes) {
    for (const a of q.answers) {
      const stat = perQuestion.get(a.questionId) ?? { answered: 0, correct: 0 };
      stat.answered++;
      if (a.isCorrect) stat.correct++;
      perQuestion.set(a.questionId, stat);
    }
  }

  const isDocument = activity.format === "DOCUMENT";

  const students = activity.targets
    .map((t) => {
      // Written work has nothing to auto-mark, so the student marking it done
      // on their target row IS the completion signal. A question paper keeps
      // deriving completion from its quiz, so the two never drift.
      if (isDocument) {
        // Three states once work is handed in: nothing yet, handed in and
        // waiting, or marked. Without submissions it stays the simple pair.
        const state = t.markedAt
          ? "marked"
          : t.submittedAt || t.completedAt
            ? activity.requiresSubmission
              ? "submitted"
              : "done"
            : "not_started";

        return {
          id: t.student.id,
          name: t.student.name,
          section: t.student.section,
          state,
          completedAt: t.completedAt,
          submissionText: t.submissionText,
          files: t.files,
          submittedAt: t.submittedAt,
          marks: t.marks,
          feedback: t.feedback,
          markedAt: t.markedAt,
          correctAnswers: null as number | null,
          totalQuestions: null as number | null,
          accuracy: null as number | null,
        };
      }

      const attempt = byStudent.get(t.student.id);
      return {
        id: t.student.id,
        name: t.student.name,
        section: t.student.section,
        // "not started" / "in progress" / "done" — never "late". Late work is
        // accepted and not flagged; it may well have come in on paper.
        state: !attempt ? "not_started" : attempt.completedAt ? "done" : "in_progress",
        completedAt: attempt?.completedAt ?? null,
        correctAnswers: attempt?.correctAnswers ?? null,
        totalQuestions: attempt?.totalQuestions ?? null,
        accuracy:
          attempt && attempt.totalQuestions > 0
            ? attempt.correctAnswers / attempt.totalQuestions
            : null,
      };
    })
    .sort((a, b) => {
      // Work waiting to be marked comes first — that is the teacher's queue.
      // Then not started, then everything already dealt with.
      const rank: Record<string, number> = {
        submitted: 0,
        not_started: 1,
        in_progress: 2,
        done: 3,
        marked: 4,
      };
      const d = (rank[a.state] ?? 9) - (rank[b.state] ?? 9);
      if (d !== 0) return d;
      if (a.accuracy === null && b.accuracy === null) return a.name.localeCompare(b.name);
      if (a.accuracy === null) return -1;
      if (b.accuracy === null) return 1;
      return a.accuracy - b.accuracy;
    });

  const questions = activity.questions.map((q) => {
    const stat = perQuestion.get(q.question.id);
    return {
      order: q.order,
      id: q.question.id,
      questionText: q.question.questionText,
      difficulty: q.question.difficulty,
      answered: stat?.answered ?? 0,
      accuracy: stat && stat.answered > 0 ? stat.correct / stat.answered : null,
    };
  });

  // "Completed" means the student has done the work — handing it in counts,
  // whether or not it has been marked yet. The activities LIST counts the same
  // rows (targets with completedAt set), so the two views agree.
  const done = students.filter(
    (s) => s.state === "done" || s.state === "marked" || s.state === "submitted",
  );

  // How many are waiting on the teacher. Only meaningful for hand-in work.
  const awaitingMarking = students.filter((s) => s.state === "submitted").length;

  return NextResponse.json({
    activity: {
      id: activity.id,
      teachingAssignmentId: activity.teachingAssignmentId,
      kind: activity.kind,
      format: activity.format,
      body: activity.body,
      answerKey: activity.answerKey,
      publishedAt: activity.publishedAt,
      requiresSubmission: activity.requiresSubmission,
      maxMarks: activity.maxMarks,
      status: activity.status,
      title: activity.title,
      instructions: activity.instructions,
      dueAt: activity.dueAt,
      subject: activity.subject,
      grade: activity.grade,
      section: activity.section,
      questionCount: activity.questionCount,
      createdAt: activity.createdAt,
      chapter: activity.chapter,
      assignedCount: activity.targets.length,
      completedCount: done.length,
      awaitingMarking,
      averageAccuracy:
        done.length > 0
          ? done.reduce((sum, s) => sum + (s.accuracy ?? 0), 0) / done.length
          : null,
    },
    students,
    questions,
  });
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  if (!validateCsrfOrigin(req)) {
    return NextResponse.json({ error: "Invalid request origin" }, { status: 403 });
  }

  const user = await getTeacher();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 403 });

  const { id } = await params;

  let body: {
    title?: unknown;
    instructions?: unknown;
    dueAt?: unknown;
    status?: unknown;
    /** DRAFT only: corrected student-facing content. */
    documentBody?: unknown;
    /** DRAFT only: questions to drop from the paper before sending. */
    removeQuestionIds?: unknown;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const owned = await db.classActivity.findFirst({
    where: { id, teacherId: user.id },
    select: { id: true, status: true, format: true },
  });
  if (!owned) {
    return NextResponse.json({ error: "Activity not found" }, { status: 404 });
  }

  const data: Record<string, unknown> = {};

  if (body.title !== undefined) {
    const title = typeof body.title === "string" ? body.title.trim() : "";
    if (title.length < 2 || title.length > 120) {
      return NextResponse.json(
        { error: "Title must be between 2 and 120 characters." },
        { status: 400 },
      );
    }
    data.title = title;
  }

  if (body.instructions !== undefined) {
    const instructions =
      typeof body.instructions === "string" ? body.instructions.trim() : "";
    data.instructions = instructions ? instructions.slice(0, 2000) : null;
  }

  if (body.dueAt !== undefined) {
    if (body.dueAt === null || body.dueAt === "") {
      data.dueAt = null;
    } else if (typeof body.dueAt === "string") {
      const parsed = new Date(body.dueAt);
      if (Number.isNaN(parsed.getTime())) {
        return NextResponse.json({ error: "Invalid due date." }, { status: 400 });
      }
      data.dueAt = parsed;
    } else {
      return NextResponse.json({ error: "Invalid due date." }, { status: 400 });
    }
  }

  if (body.status !== undefined) {
    if (body.status !== "PUBLISHED" && body.status !== "CLOSED") {
      return NextResponse.json(
        { error: "Status must be PUBLISHED or CLOSED." },
        { status: 400 },
      );
    }
    // Publishing is not a field edit. It notifies a class, so it goes through
    // the publish route which actually does that — allowing it here would
    // send work to students that nobody was told about.
    if (owned.status === "DRAFT" && body.status === "PUBLISHED") {
      return NextResponse.json(
        { error: "Use the publish action to send a draft to the class." },
        { status: 400 },
      );
    }
    data.status = body.status;
  }

  // ── Corrections, only while it is still a draft ───────────────────────
  //
  // Once work is published students may already have read or answered it, so
  // rewriting it underneath them would change the task they were set.
  if (body.documentBody !== undefined) {
    if (owned.status !== "DRAFT") {
      return NextResponse.json(
        { error: "This has already been sent, so its content can no longer be changed." },
        { status: 409 },
      );
    }
    if (owned.format !== "DOCUMENT") {
      return NextResponse.json(
        { error: "That activity is a question paper, not a document." },
        { status: 400 },
      );
    }
    const text = typeof body.documentBody === "string" ? body.documentBody.trim() : "";
    if (text.length < 10) {
      return NextResponse.json(
        { error: "There is no content to give to the class." },
        { status: 400 },
      );
    }
    if (text.length > 60_000) {
      return NextResponse.json({ error: "That is too long to assign." }, { status: 400 });
    }
    data.body = text;
  }

  // Dropping a bad generated question before the class ever sees it.
  let removeIds: string[] = [];
  if (body.removeQuestionIds !== undefined) {
    if (owned.status !== "DRAFT") {
      return NextResponse.json(
        { error: "This has already been sent, so its questions can no longer be changed." },
        { status: 409 },
      );
    }
    removeIds = Array.isArray(body.removeQuestionIds)
      ? (body.removeQuestionIds as unknown[]).filter(
          (v): v is string => typeof v === "string" && v.length > 0,
        )
      : [];
  }

  if (removeIds.length > 0) {
    await db.classActivityQuestion.deleteMany({
      where: { activityId: owned.id, questionId: { in: removeIds } },
    });
    // `questionCount` is what the student UI reports, so it has to follow.
    const left = await db.classActivityQuestion.count({
      where: { activityId: owned.id },
    });
    data.questionCount = left;
  }

  if (Object.keys(data).length === 0 && removeIds.length === 0) {
    return NextResponse.json({ error: "No fields to update" }, { status: 400 });
  }

  const activity = await db.classActivity.update({
    where: { id },
    data,
    select: {
      id: true,
      kind: true,
      status: true,
      title: true,
      instructions: true,
      dueAt: true,
      questionCount: true,
    },
  });

  return NextResponse.json({ activity });
}

/**
 * Discard a draft, or take sent work back from the class.
 *
 * `?toDraft=1` returns sent work to a draft instead of deleting it — the undo
 * for "Send to class" on a reviewed draft.
 */
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  if (!validateCsrfOrigin(req)) {
    return NextResponse.json({ error: "Invalid request origin" }, { status: 403 });
  }

  const user = await getTeacher();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 403 });

  const { id } = await params;
  const result = await takeBackActivity(user.id, id, {
    toDraft: req.nextUrl.searchParams.get("toDraft") === "1",
  });
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }
  return NextResponse.json({ ok: true, outcome: result.outcome });
}
