import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getCurrentUser } from "@/lib/get-session";
import { validateCsrfOrigin } from "@/lib/csrf";
import { deleteExamImage } from "@/lib/national-exam";
import { validateQuestionInput } from "../validate";

type RouteParams = { params: Promise<{ id: string; qid: string }> };

async function load(id: string, qid: string) {
  return db.nationalExamQuestion.findFirst({
    where: { id: qid, examId: id },
    select: { id: true, options: true, correctAnswer: true, imageFile: true, exam: { select: { status: true } } },
  });
}

/** PATCH /api/admin/national-exams/[id]/questions/[qid] — fix a question, its options, answer or explanation. */
export async function PATCH(request: NextRequest, { params }: RouteParams) {
  const user = await getCurrentUser();
  if (user?.role !== "SUPER_ADMIN") return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  if (!validateCsrfOrigin(request)) return NextResponse.json({ error: "Invalid request origin" }, { status: 403 });
  const { id, qid } = await params;
  const current = await load(id, qid);
  if (!current) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const parsed = validateQuestionInput(body, false);
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });
  const d = parsed.data;

  // The answer must stay one of the options. When the options change and the
  // old answer is no longer among them, drop it rather than keep a dangling key.
  const options = d.options ?? (current.options as string[]);
  let correctAnswer = d.correctAnswer !== undefined ? d.correctAnswer : current.correctAnswer;
  if (correctAnswer && !options.includes(correctAnswer)) {
    if (d.correctAnswer !== undefined) return NextResponse.json({ error: "The answer must be one of the options." }, { status: 400 });
    correctAnswer = null;
  }
  if (current.exam.status === "PUBLISHED" && !correctAnswer) {
    return NextResponse.json({ error: "A published question must keep an answer." }, { status: 409 });
  }

  if (d.number !== undefined) {
    const clash = await db.nationalExamQuestion.findFirst({ where: { examId: id, number: d.number, NOT: { id: qid } } });
    if (clash) return NextResponse.json({ error: `Question ${d.number} already exists.` }, { status: 409 });
  }

  const question = await db.nationalExamQuestion.update({
    where: { id: qid },
    data: {
      ...(d.number !== undefined ? { number: d.number } : {}),
      ...(d.questionText !== undefined ? { questionText: d.questionText } : {}),
      ...(d.options !== undefined ? { options: d.options } : {}),
      correctAnswer,
      ...(d.explanation !== undefined ? { explanation: d.explanation } : {}),
      ...(d.needsReview !== undefined ? { needsReview: d.needsReview, ...(d.needsReview ? {} : { reviewNote: null }) } : {}),
    },
  });
  const { imageFile, ...rest } = question;
  return NextResponse.json({ question: { ...rest, hasImage: !!imageFile } });
}

/** DELETE /api/admin/national-exams/[id]/questions/[qid] — remove a question that is not really one. */
export async function DELETE(request: NextRequest, { params }: RouteParams) {
  const user = await getCurrentUser();
  if (user?.role !== "SUPER_ADMIN") return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  if (!validateCsrfOrigin(request)) return NextResponse.json({ error: "Invalid request origin" }, { status: 403 });
  const { id, qid } = await params;
  const current = await load(id, qid);
  if (!current) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (current.exam.status === "PUBLISHED") return NextResponse.json({ error: "Unpublish the paper first." }, { status: 409 });
  await db.nationalExamQuestion.delete({ where: { id: qid } });
  await db.nationalExam.update({ where: { id }, data: { questionCount: { decrement: 1 } } });
  await deleteExamImage(current.imageFile);
  return NextResponse.json({ success: true });
}
