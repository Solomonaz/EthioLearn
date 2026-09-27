import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getCurrentUser } from "@/lib/get-session";
import { validateCsrfOrigin } from "@/lib/csrf";
import { canonicalSubject } from "@/lib/subject";
import { duplicateResponseBody, findDuplicateTextbooks } from "@/lib/textbook-access";
import { MAX_TEXTBOOK_BYTES, storeTextbookFile, textbookFileExt } from "@/lib/textbook-ingest";

/** Open requests a school may have waiting at once, so the queue can't be flooded. */
const MAX_PENDING_PER_SCHOOL = 3;

/**
 * POST /api/admin/textbooks/requests — a school asks for a textbook.
 *
 * The file is held on disk and the book is created PENDING with no chapters.
 * Nothing paid runs here: chapter detection happens only after a super admin
 * approves it (./[id]/review). Until then there are no chapters, so no quiz,
 * question generation or embedding can touch it.
 */
export async function POST(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user || user.role !== "SCHOOL_ADMIN" || !user.schoolId) {
    return NextResponse.json({ error: "Only school admins submit textbook requests." }, { status: 403 });
  }
  if (!validateCsrfOrigin(request)) {
    return NextResponse.json({ error: "Invalid request origin" }, { status: 403 });
  }

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return NextResponse.json({ error: "Invalid form data." }, { status: 400 });
  }

  const title = (formData.get("title") as string | null)?.trim();
  const subjectRaw = (formData.get("subject") as string | null)?.trim();
  const grade = Number(formData.get("grade"));
  const publisher = (formData.get("publisher") as string | null)?.trim() || undefined;
  const academicYear = (formData.get("academicYear") as string | null)?.trim() || undefined;
  const reason = (formData.get("reason") as string | null)?.trim();
  const file = formData.get("file");

  if (!title) return NextResponse.json({ error: "Title is required." }, { status: 400 });
  if (!subjectRaw) return NextResponse.json({ error: "Subject is required." }, { status: 400 });
  if (!grade || grade < 1 || grade > 12) {
    return NextResponse.json({ error: "Grade must be between 1 and 12." }, { status: 400 });
  }
  if (!reason || reason.length < 10) {
    return NextResponse.json(
      { error: "Tell the reviewer why your school needs this book (at least 10 characters)." },
      { status: 400 },
    );
  }
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "Please attach the textbook file." }, { status: 400 });
  }
  if (!textbookFileExt(file.name)) {
    return NextResponse.json({ error: "Please upload a PDF, DOCX, DOC, or EPUB file." }, { status: 400 });
  }
  if (file.size > MAX_TEXTBOOK_BYTES) {
    return NextResponse.json({ error: "File too large. Maximum size is 50 MB." }, { status: 400 });
  }

  const duplicates = await findDuplicateTextbooks(user, grade, subjectRaw);
  if (duplicates.length > 0) {
    return NextResponse.json(duplicateResponseBody(user, duplicates), { status: 409 });
  }

  const pending = await db.textbook.count({
    where: { schoolId: user.schoolId, approvalStatus: "PENDING" },
  });
  if (pending >= MAX_PENDING_PER_SCHOOL) {
    return NextResponse.json(
      {
        error: `Your school already has ${pending} requests waiting for review. Wait for a decision before submitting more.`,
        code: "TOO_MANY_PENDING",
      },
      { status: 429 },
    );
  }

  let sourceFile: string;
  try {
    sourceFile = await storeTextbookFile(Buffer.from(await file.arrayBuffer()), file.name);
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Could not store the file." }, { status: 400 });
  }

  const textbook = await db.textbook.create({
    data: {
      title,
      subject: await canonicalSubject(subjectRaw),
      grade,
      publisher,
      academicYear,
      fileUrl: "",
      schoolId: user.schoolId,
      uploadedById: user.id,
      approvalStatus: "PENDING",
      processingStatus: "PENDING",
      requestNote: reason.slice(0, 1000),
      sourceFile,
      sourceFileName: file.name.slice(0, 200),
      sourceFileSize: file.size,
    },
    select: { id: true, title: true, approvalStatus: true },
  });

  return NextResponse.json({ textbook }, { status: 201 });
}
