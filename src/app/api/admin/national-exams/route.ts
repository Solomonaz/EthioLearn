import { NextRequest, NextResponse, after } from "next/server";
import { db } from "@/lib/db";
import { getCurrentUser } from "@/lib/get-session";
import { validateCsrfOrigin } from "@/lib/csrf";
import { canonicalSubject } from "@/lib/subject";
import { MAX_TEXTBOOK_BYTES, storeTextbookFile } from "@/lib/textbook-ingest";
import { EXAM_STREAMS, extractNationalExam } from "@/lib/national-exam";

/** GET /api/admin/national-exams — every uploaded paper, newest first. */
export async function GET() {
  const user = await getCurrentUser();
  if (user?.role !== "SUPER_ADMIN") return NextResponse.json({ error: "Unauthorized" }, { status: 403 });

  const exams = await db.nationalExam.findMany({
    orderBy: [{ createdAt: "desc" }],
    select: {
      id: true, subject: true, yearLabel: true, stream: true, durationMinutes: true, status: true,
      sourceFileName: true, extractionError: true, questionCount: true, publishedAt: true, createdAt: true,
      _count: { select: { attempts: true, questions: { where: { needsReview: true } } } },
    },
  });
  return NextResponse.json({
    exams: exams.map(({ _count, ...e }) => ({ ...e, attemptCount: _count.attempts, needsReviewCount: _count.questions })),
  });
}

/**
 * POST /api/admin/national-exams — upload a past paper (multipart: file,
 * subject, yearLabel, stream, durationMinutes). The questions are extracted in
 * the background; the paper stays hidden from students until published.
 */
export async function POST(request: NextRequest) {
  const user = await getCurrentUser();
  if (user?.role !== "SUPER_ADMIN") return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  if (!validateCsrfOrigin(request)) return NextResponse.json({ error: "Invalid request origin" }, { status: 403 });

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return NextResponse.json({ error: "Invalid form data." }, { status: 400 });
  }

  const file = form.get("file");
  const subjectRaw = String(form.get("subject") ?? "").trim();
  const yearLabel = String(form.get("yearLabel") ?? "").trim().slice(0, 40);
  const streamRaw = String(form.get("stream") ?? "").trim().toUpperCase();
  const duration = Number(form.get("durationMinutes") ?? 120);

  if (!(file instanceof File)) return NextResponse.json({ error: "Please choose the exam PDF." }, { status: 400 });
  if (!file.name.toLowerCase().endsWith(".pdf")) return NextResponse.json({ error: "Please upload a PDF." }, { status: 400 });
  if (file.size > MAX_TEXTBOOK_BYTES) return NextResponse.json({ error: "File too large. Maximum size is 50 MB." }, { status: 400 });
  if (!subjectRaw) return NextResponse.json({ error: "Subject is required." }, { status: 400 });
  if (!yearLabel) return NextResponse.json({ error: "Year is required (e.g. 2016 E.C.)." }, { status: 400 });
  if (!Number.isInteger(duration) || duration < 10 || duration > 600) {
    return NextResponse.json({ error: "Duration must be between 10 and 600 minutes." }, { status: 400 });
  }
  const stream = (EXAM_STREAMS as readonly string[]).includes(streamRaw) ? streamRaw : null;

  let sourceFile: string;
  try {
    sourceFile = await storeTextbookFile(Buffer.from(await file.arrayBuffer()), file.name);
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Could not store the file." }, { status: 400 });
  }

  const exam = await db.nationalExam.create({
    data: {
      subject: await canonicalSubject(subjectRaw),
      yearLabel,
      stream,
      durationMinutes: duration,
      sourceFile,
      sourceFileName: file.name.slice(0, 200),
    },
    select: { id: true },
  });
  after(() => extractNationalExam(exam.id));
  return NextResponse.json({ id: exam.id }, { status: 201 });
}
