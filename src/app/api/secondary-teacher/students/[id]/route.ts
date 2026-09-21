import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getCurrentUser } from "@/lib/get-session";
import { rateLimit } from "@/lib/rate-limit";
import { getMasteryLevel } from "@/lib/class-insights";
import { subjectInFilter } from "@/lib/subject";

/**
 * One student, as their teacher sees them.
 *
 * Scope — a teacher may open a student only when BOTH hold:
 *   1. the student is at the teacher's own school, and
 *   2. the student's (grade, section) matches one of the teacher's classes.
 *
 * And they see only the SUBJECTS they teach that student. A physics teacher
 * has no business reading the same child's biology marks, so the subject list
 * is derived from the teacher's own assignments rather than from the student.
 */

/** How far back the activity and quiz history reaches. */
const WINDOW_DAYS = 180;

/** Cap on answers scanned when building chapter mastery. */
const MAX_ANSWERS = 4000;

interface ChapterAccum {
  id: string;
  title: string;
  chapterNumber: number;
  subject: string;
  answered: number;
  correct: number;
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await getCurrentUser();
  if (!user || user.role !== "SECONDARY_TEACHER" || !user.schoolId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  }

  const rl = rateLimit("secondary-teacher:student:" + user.id, 120, 60_000);
  if (!rl.success) {
    return NextResponse.json(
      { error: "Too many requests. Please slow down." },
      { status: 429, headers: { "Retry-After": String(rl.retryAfter) } },
    );
  }

  const { id: studentId } = await params;

  const student = await db.user.findFirst({
    where: { id: studentId, role: "STUDENT", schoolId: user.schoolId },
    select: {
      id: true,
      name: true,
      grade: true,
      section: true,
      lastActiveAt: true,
      createdAt: true,
      streakDays: true,
      isActive: true,
    },
  });

  // Same 404 for "no such student" and "not one of yours", so a teacher cannot
  // probe the school roster for students they do not teach.
  if (!student) {
    return NextResponse.json({ error: "Student not found" }, { status: 404 });
  }

  // Which of this teacher's classes contain this student?
  const myClasses = await db.teachingAssignment.findMany({
    where: {
      teacherId: user.id,
      grade: student.grade ?? -1,
      // A null section on a legacy row means "every section of that grade".
      OR: [{ section: student.section }, { section: null }],
    },
    select: { id: true, subject: true, grade: true, section: true },
  });

  if (myClasses.length === 0) {
    return NextResponse.json({ error: "Student not found" }, { status: 404 });
  }

  const subjects = Array.from(new Set(myClasses.map((c) => c.subject)));
  const since = new Date(Date.now() - WINDOW_DAYS * 24 * 60 * 60 * 1000);

  // ── Chapter mastery, limited to the subjects this teacher teaches ─────
  const answers = await db.quizAnswer.findMany({
    where: {
      quiz: { studentId: student.id, startedAt: { gte: since } },
      // Case-insensitive: the teacher's class and the textbook are separate
      // free-text fields, and an exact `in` silently hid a whole subject when
      // the two spellings differed only in case.
      question: { chapter: { textbook: { OR: subjectInFilter(subjects) } } },
    },
    take: MAX_ANSWERS,
    orderBy: { id: "desc" },
    select: {
      isCorrect: true,
      question: {
        select: {
          chapter: {
            select: {
              id: true,
              title: true,
              chapterNumber: true,
              textbook: { select: { subject: true } },
            },
          },
        },
      },
    },
  });

  const chapterMap = new Map<string, ChapterAccum>();
  for (const a of answers) {
    const ch = a.question?.chapter;
    if (!ch) continue;
    const accum =
      chapterMap.get(ch.id) ?? {
        id: ch.id,
        title: ch.title,
        chapterNumber: ch.chapterNumber,
        subject: ch.textbook?.subject ?? "",
        answered: 0,
        correct: 0,
      };
    accum.answered++;
    if (a.isCorrect) accum.correct++;
    chapterMap.set(ch.id, accum);
  }

  const chapters = Array.from(chapterMap.values())
    .map((c) => {
      const avgScore = c.answered > 0 ? (c.correct / c.answered) * 100 : 0;
      return {
        id: c.id,
        title: c.title,
        chapterNumber: c.chapterNumber,
        subject: c.subject,
        answered: c.answered,
        accuracy: c.answered > 0 ? c.correct / c.answered : null,
        masteryLevel: getMasteryLevel(avgScore, c.answered),
      };
    })
    // Weakest first: the chapters a teacher would act on.
    .sort((a, b) => (a.accuracy ?? 0) - (b.accuracy ?? 0));

  // ── Everything this teacher set that this student was given ───────────
  const targets = await db.classActivityTarget.findMany({
    where: { studentId: student.id, activity: { teacherId: user.id } },
    orderBy: { activity: { createdAt: "desc" } },
    take: 50,
    select: {
      // The target carries its own completion for DOCUMENT work. Reading only
      // the activity here is what made every written assignment report
      // "not started" even after it had been handed in and marked.
      completedAt: true,
      submittedAt: true,
      markedAt: true,
      marks: true,
      activity: {
        select: {
          id: true,
          kind: true,
          format: true,
          maxMarks: true,
          requiresSubmission: true,
          title: true,
          dueAt: true,
          subject: true,
          questionCount: true,
          createdAt: true,
        },
      },
    },
  });

  const activityIds = targets.map((t) => t.activity.id);
  const activityQuizzes = activityIds.length
    ? await db.quiz.findMany({
        where: { studentId: student.id, activityId: { in: activityIds } },
        select: {
          activityId: true,
          completedAt: true,
          score: true,
          correctAnswers: true,
          totalQuestions: true,
        },
      })
    : [];

  const attemptByActivity = new Map<string, (typeof activityQuizzes)[number]>();
  for (const q of activityQuizzes) {
    if (!q.activityId) continue;
    const existing = attemptByActivity.get(q.activityId);
    if (!existing || (!existing.completedAt && q.completedAt)) {
      attemptByActivity.set(q.activityId, q);
    }
  }

  const activities = targets.map((t) => {
    const a = t.activity;
    const isDoc = a.format === "DOCUMENT";
    const attempt = attemptByActivity.get(a.id);

    // Written work has no quiz, so its state lives on the target row. A
    // question paper keeps deriving state from its quiz, exactly as the
    // activity views do — the two must not disagree about the same student.
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
      subject: a.subject,
      dueAt: a.dueAt,
      createdAt: a.createdAt,
      questionCount: a.questionCount,
      maxMarks: isDoc ? a.maxMarks : null,
      marks: isDoc ? t.marks : null,
      // Never "late" — a due date is advisory and the work may have come in
      // on paper.
      state,
      score: !isDoc && attempt?.completedAt ? attempt.score : null,
      correctAnswers: !isDoc && attempt?.completedAt ? attempt.correctAnswers : null,
      totalQuestions: !isDoc && attempt?.completedAt ? attempt.totalQuestions : null,
    };
  });

  // ── Their own practice in these subjects, so the teacher can see effort
  //    that happened outside anything they set ──────────────────────────
  const practiceQuizzes = await db.quiz.findMany({
    where: {
      studentId: student.id,
      completedAt: { not: null },
      startedAt: { gte: since },
      answers: {
        some: { question: { chapter: { textbook: { OR: subjectInFilter(subjects) } } } },
      },
    },
    orderBy: { completedAt: "desc" },
    take: 15,
    select: {
      id: true,
      mode: true,
      score: true,
      correctAnswers: true,
      totalQuestions: true,
      completedAt: true,
      activityId: true,
    },
  });

  const totalAnswered = answers.length;
  const totalCorrect = answers.filter((a) => a.isCorrect).length;
  const doneActivities = activities.filter(
    (a) => a.state === "done" || a.state === "submitted" || a.state === "marked",
  );

  return NextResponse.json({
    student: {
      id: student.id,
      name: student.name,
      grade: student.grade,
      section: student.section,
      lastActiveAt: student.lastActiveAt,
      streakDays: student.streakDays,
      isActive: student.isActive,
    },
    subjects,
    classes: myClasses,
    summary: {
      windowDays: WINDOW_DAYS,
      answered: totalAnswered,
      accuracy: totalAnswered > 0 ? totalCorrect / totalAnswered : null,
      activitiesAssigned: activities.length,
      activitiesCompleted: doneActivities.length,
      // Averaged over scored work only. Written work carries no score, so
      // including it would pull the average down with zeroes.
      activityAverage: (() => {
        const scored = doneActivities.filter((a) => a.score !== null);
        if (scored.length === 0) return null;
        return scored.reduce((sum, a) => sum + (a.score ?? 0), 0) / scored.length / 100;
      })(),
    },
    chapters,
    activities,
    practiceQuizzes: practiceQuizzes.map((q) => ({
      id: q.id,
      mode: q.mode,
      score: q.score,
      correctAnswers: q.correctAnswers,
      totalQuestions: q.totalQuestions,
      completedAt: q.completedAt,
      fromActivity: Boolean(q.activityId),
    })),
  });
}
