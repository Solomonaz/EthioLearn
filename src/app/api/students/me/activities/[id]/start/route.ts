import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireCompleteProfile } from "@/lib/get-session";
import { validateCsrfOrigin } from "@/lib/csrf";
import { normalizeOption, shuffleArray } from "@/lib/utils";

/**
 * Open a teacher-set activity.
 *
 * Returns the PINNED questions in the teacher's order, so every student in the
 * class sits the same paper. Only the MCQ option order is randomised, exactly
 * as the practice quiz route does — grading matches by answer text, so display
 * order is safe to change.
 *
 * An unfinished attempt is resumed rather than replaced: a dropped connection
 * mid-activity must not cost the answers already given, and must not let a
 * student reroll onto an easier paper.
 *
 * Submission goes through the normal POST /api/quizzes/[id]/submit. That route
 * awards no points to anything that is not the daily challenge, so activities
 * stay outside the prize economy without needing a special case.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  if (!validateCsrfOrigin(req)) {
    return NextResponse.json({ error: "Invalid request origin" }, { status: 403 });
  }

  const user = await requireCompleteProfile();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id: activityId } = await params;

  // Membership is the authorisation: only a targeted student may open it.
  const target = await db.classActivityTarget.findUnique({
    where: { activityId_studentId: { activityId, studentId: user.id } },
    select: { id: true },
  });
  if (!target) {
    return NextResponse.json({ error: "Activity not found" }, { status: 404 });
  }

  const activity = await db.classActivity.findUnique({
    where: { id: activityId },
    select: {
      id: true,
      kind: true,
      status: true,
      title: true,
      instructions: true,
      dueAt: true,
      subject: true,
      questions: {
        orderBy: { order: "asc" },
        select: {
          question: {
            select: {
              id: true,
              questionText: true,
              options: true,
              type: true,
              difficulty: true,
            },
          },
        },
      },
    },
  });

  if (!activity) {
    return NextResponse.json({ error: "Activity not found" }, { status: 404 });
  }
  // Anything other than PUBLISHED, not just CLOSED: a DRAFT has not been
  // given to anyone yet, and must not become reachable by guessing its id.
  if (activity.status !== "PUBLISHED") {
    return NextResponse.json(
      { error: "This activity is not open." },
      { status: 403 },
    );
  }

  const alreadyDone = await db.quiz.findFirst({
    where: { activityId, studentId: user.id, completedAt: { not: null } },
    select: { id: true },
  });
  if (alreadyDone) {
    return NextResponse.json(
      { error: "You have already submitted this.", quizId: alreadyDone.id },
      { status: 409 },
    );
  }

  const questions = activity.questions.map((q) => q.question);
  if (questions.length === 0) {
    return NextResponse.json(
      { error: "This activity has no questions." },
      { status: 404 },
    );
  }

  // Resume an unfinished attempt rather than starting a fresh one.
  const inProgress = await db.quiz.findFirst({
    where: { activityId, studentId: user.id, completedAt: null },
    select: { id: true },
  });

  const quiz =
    inProgress ??
    (await db.quiz.create({
      data: {
        studentId: user.id,
        activityId,
        mode: "SOLO",
        totalQuestions: questions.length,
      },
      select: { id: true },
    }));

  return NextResponse.json({
    quizId: quiz.id,
    resumed: Boolean(inProgress),
    activity: {
      id: activity.id,
      kind: activity.kind,
      title: activity.title,
      instructions: activity.instructions,
      dueAt: activity.dueAt,
      subject: activity.subject,
    },
    totalQuestions: questions.length,
    questions: questions.map((q) => {
      const options = (q.options as unknown[]).map(normalizeOption);
      return {
        id: q.id,
        questionText: q.questionText,
        options: q.type === "MCQ" ? shuffleArray(options) : options,
        type: q.type,
        difficulty: q.difficulty,
      };
    }),
  });
}
