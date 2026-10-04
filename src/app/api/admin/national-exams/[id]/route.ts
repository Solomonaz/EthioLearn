import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getCurrentUser } from "@/lib/get-session";
import { validateCsrfOrigin } from "@/lib/csrf";
import { canonicalSubject } from "@/lib/subject";
import { deleteTextbookFile } from "@/lib/textbook-ingest";
import { EXAM_STREAMS, deleteExamImage } from "@/lib/national-exam";

type RouteParams = { params: Promise<{ id: string }> };

/** GET /api/admin/national-exams/[id] — the paper and all its questions, answers included. */
export async function GET(_request: NextRequest, { params }: RouteParams) {
  const user = await getCurrentUser();
  if (user?.role !== "SUPER_ADMIN") return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  const { id } = await params;
  const exam = await db.nationalExam.findUnique({
    where: { id },
    include: { questions: { orderBy: { number: "asc" } }, _count: { select: { attempts: true } } },
  });
  if (!exam) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const { sourceFile, _count, questions, ...rest } = exam;
  return NextResponse.json({
    exam: {
      ...rest,
      hasSourceFile: !!sourceFile,
      attemptCount: _count.attempts,
      questions: questions.map(({ imageFile, ...q }) => ({ ...q, hasImage: !!imageFile })),
    },
  });
}

/**
 * PATCH /api/admin/national-exams/[id] — edit the paper's details, or publish
 * / unpublish it. Publishing requires every question to have an answer.
 */
export async function PATCH(request: NextRequest, { params }: RouteParams) {
  const user = await getCurrentUser();
  if (user?.role !== "SUPER_ADMIN") return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  if (!validateCsrfOrigin(request)) return NextResponse.json({ error: "Invalid request origin" }, { status: 403 });
  const { id } = await params;
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;

  const exam = await db.nationalExam.findUnique({ where: { id }, select: { status: true } });
  if (!exam) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const data: Record<string, unknown> = {};
  if (typeof body.subject === "string" && body.subject.trim()) data.subject = await canonicalSubject(body.subject.trim());
  if (typeof body.yearLabel === "string" && body.yearLabel.trim()) data.yearLabel = body.yearLabel.trim().slice(0, 40);
  if ("stream" in body) {
    const s = String(body.stream ?? "").toUpperCase();
    data.stream = (EXAM_STREAMS as readonly string[]).includes(s) ? s : null;
  }
  if (body.durationMinutes !== undefined) {
    const d = Number(body.durationMinutes);
    if (!Number.isInteger(d) || d < 10 || d > 600) {
      return NextResponse.json({ error: "Duration must be between 10 and 600 minutes." }, { status: 400 });
    }
    data.durationMinutes = d;
  }

  if (body.action === "publish") {
    if (exam.status !== "REVIEW") {
      return NextResponse.json({ error: "Only a paper in review can be published." }, { status: 409 });
    }
    const [total, unanswered] = await Promise.all([
      db.nationalExamQuestion.count({ where: { examId: id } }),
      db.nationalExamQuestion.count({ where: { examId: id, correctAnswer: null } }),
    ]);
    if (total === 0) return NextResponse.json({ error: "This paper has no questions." }, { status: 409 });
    if (unanswered > 0) {
      return NextResponse.json(
        { error: `${unanswered} question(s) still have no answer. Set them before publishing.` },
        { status: 409 },
      );
    }
    data.status = "PUBLISHED";
    data.publishedAt = new Date();
    data.questionCount = total;
  } else if (body.action === "unpublish") {
    if (exam.status !== "PUBLISHED") return NextResponse.json({ error: "This paper is not published." }, { status: 409 });
    data.status = "REVIEW";
  }

  const updated = await db.nationalExam.update({ where: { id }, data, select: { id: true, status: true } });
  return NextResponse.json({ exam: updated });
}

/** DELETE /api/admin/national-exams/[id] — removes the paper, its questions, attempts and files. */
export async function DELETE(request: NextRequest, { params }: RouteParams) {
  const user = await getCurrentUser();
  if (user?.role !== "SUPER_ADMIN") return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  if (!validateCsrfOrigin(request)) return NextResponse.json({ error: "Invalid request origin" }, { status: 403 });
  const { id } = await params;
  const exam = await db.nationalExam.findUnique({
    where: { id },
    select: { sourceFile: true, questions: { select: { imageFile: true } } },
  });
  if (!exam) return NextResponse.json({ error: "Not found" }, { status: 404 });
  await db.nationalExam.delete({ where: { id } });
  await deleteTextbookFile(exam.sourceFile);
  await Promise.all(exam.questions.map((q) => deleteExamImage(q.imageFile)));
  return NextResponse.json({ success: true });
}
