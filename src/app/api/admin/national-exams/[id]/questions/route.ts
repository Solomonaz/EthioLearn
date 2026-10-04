import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getCurrentUser } from "@/lib/get-session";
import { validateCsrfOrigin } from "@/lib/csrf";
import { validateQuestionInput } from "./validate";

/** POST /api/admin/national-exams/[id]/questions — add a question the extraction missed. */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (user?.role !== "SUPER_ADMIN") return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  if (!validateCsrfOrigin(request)) return NextResponse.json({ error: "Invalid request origin" }, { status: 403 });
  const { id } = await params;

  const exam = await db.nationalExam.findUnique({ where: { id }, select: { status: true } });
  if (!exam) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (exam.status === "EXTRACTING") return NextResponse.json({ error: "Wait for extraction to finish." }, { status: 409 });

  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const parsed = validateQuestionInput(body, true);
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });

  const last = await db.nationalExamQuestion.findFirst({ where: { examId: id }, orderBy: { number: "desc" }, select: { number: true } });
  const number = parsed.data.number ?? (last?.number ?? 0) + 1;
  const clash = await db.nationalExamQuestion.findUnique({ where: { examId_number: { examId: id, number } } });
  if (clash) return NextResponse.json({ error: `Question ${number} already exists.` }, { status: 409 });

  const question = await db.nationalExamQuestion.create({
    data: {
      examId: id,
      number,
      questionText: parsed.data.questionText!,
      options: parsed.data.options!,
      correctAnswer: parsed.data.correctAnswer ?? null,
      explanation: parsed.data.explanation ?? null,
    },
  });
  await db.nationalExam.update({ where: { id }, data: { questionCount: { increment: 1 } } });
  return NextResponse.json({ question: { ...question, imageFile: undefined, hasImage: false } }, { status: 201 });
}
