import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getCurrentUser } from "@/lib/get-session";
import { Difficulty, QuestionType } from "@prisma/client";
import { validateCsrfOrigin } from "@/lib/csrf";
import { canonicalSubject } from "@/lib/subject";
import { cleanChapterTitle } from "@/lib/display-text";
import { storedPdfSize } from "@/lib/textbook-ingest";
import {
  canManageTextbook,
  duplicateResponseBody,
  findDuplicateTextbooks,
  isLibraryBook,
  visibleTextbookWhere,
} from "@/lib/textbook-access";

export async function GET() {
  const user = await getCurrentUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!["SUPER_ADMIN", "SCHOOL_ADMIN"].includes(user.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // School admins see the national library alongside their own uploads.
  const textbooks = (await db.textbook.findMany({
    where: visibleTextbookWhere(user),
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      title: true,
      subject: true,
      grade: true,
      processingStatus: true,
      chunkingStatus: true,
      createdAt: true,
      content: true,
      schoolId: true,
      school: { select: { name: true } },
      approvalStatus: true,
      requestNote: true,
      reviewNote: true,
      reviewedAt: true,
      sourceFile: true,
      sourceFileName: true,
      sourceFileSize: true,
      readerFile: true,
      readerFileSize: true,
      processingError: true,
      updatedAt: true,
      uploadedBy: { select: { name: true } },
      _count: {
        select: { chapters: true },
      },
      chapters: {
        orderBy: { chapterNumber: "asc" as const },
        select: {
          id: true,
          title: true,
          chapterNumber: true,
          ocrConfidence: true,
          _count: {
            select: { questions: true },
          },
        },
      },
    } as any,
  })) as any;

  // Map to include hasContent flag without sending full content to client
  const mapped = (textbooks as any[]).map(({ content, school, sourceFile, readerFile, uploadedBy, ...rest }: any) => ({
    ...rest,
    hasSourceFile: !!sourceFile,
    hasReaderFile: !!readerFile,
    requestedBy: uploadedBy?.name ?? null,
    hasContent: !!content && content.length > 100,
    contentLength: content?.length ?? 0,
    isLibrary: isLibraryBook(rest.schoolId),
    schoolName: school?.name ?? null,
    canManage: canManageTextbook(user, rest.schoolId),
  }));

  return NextResponse.json({
    textbooks: mapped,
    viewer: { isSuperAdmin: user.role === "SUPER_ADMIN" },
    pendingCount: mapped.filter((t: any) => t.approvalStatus === "PENDING").length,
  });
}

interface QuestionInput {
  question: string;
  type?: string;
  options: string[];
  correctAnswer: string;
  explanation?: string;
  difficulty?: string;
}

interface ChapterInput {
  title: string;
  orderIndex?: number;
  chapterNumber?: number;
  content?: string;
  questions?: QuestionInput[];
}

interface CreateTextbookBody {
  title?: string;
  subject?: string;
  grade?: number;
  publisher?: string;
  academicYear?: string;
  content?: string;
  chapters?: ChapterInput[];
  /** Super admin only: upload even though the grade + subject already exists. */
  allowDuplicate?: boolean;
  /** Key of the PDF create-with-ai kept, to become the book's Library copy. */
  readerFile?: string;
}

export async function POST(request: NextRequest) {
  const user = await getCurrentUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!["SUPER_ADMIN", "SCHOOL_ADMIN"].includes(user.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  if (!validateCsrfOrigin(request)) {
    return NextResponse.json({ error: "Invalid request origin" }, { status: 403 });
  }

  // Schools add books through the approval queue (./requests), never directly.
  if (user.role !== "SUPER_ADMIN") {
    return NextResponse.json(
      { error: "Submit a textbook request instead — uploads are reviewed before processing.", code: "APPROVAL_REQUIRED" },
      { status: 403 },
    );
  }

  let body: CreateTextbookBody;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { title, subject, grade, publisher, academicYear, content, chapters = [] } = body;

  if (!title || typeof title !== "string" || title.trim() === "") {
    return NextResponse.json({ error: "Title is required" }, { status: 400 });
  }
  if (!subject || typeof subject !== "string" || subject.trim() === "") {
    return NextResponse.json({ error: "Subject is required" }, { status: 400 });
  }
  if (grade === undefined || grade === null || typeof grade !== "number") {
    return NextResponse.json({ error: "Grade is required" }, { status: 400 });
  }

  // Don't let a school pay to re-upload a book its students already have.
  const duplicates = await findDuplicateTextbooks(user, grade, subject);
  if (duplicates.length > 0 && !(body.allowDuplicate && user.role === "SUPER_ADMIN")) {
    return NextResponse.json(duplicateResponseBody(user, duplicates), { status: 409 });
  }

  // Only a stored PDF that no other book has claimed.
  const readerFileSize = await storedPdfSize(body.readerFile);
  const readerFile =
    readerFileSize !== null && !(await db.textbook.findFirst({ where: { readerFile: body.readerFile }, select: { id: true } }))
      ? (body.readerFile as string)
      : null;

  const validDifficulties = ["EASY", "MEDIUM", "HARD"];
  const validTypes = ["MCQ", "TRUE_FALSE", "FILL_IN_BLANK", "MATCH_PAIRS", "ORDERING"];

  const textbook = await db.textbook.create({
    data: {
      title: title.trim(),
      // Snapped to the managed subject list, so a textbook filed as
      // "biology" still lines up with the classes recorded as "Biology".
      subject: await canonicalSubject(subject),
      grade,
      publisher: publisher?.trim() || undefined,
      academicYear: academicYear?.trim() || undefined,
      content: content || undefined,
      fileUrl: "",
      readerFile,
      readerFileSize: readerFile ? readerFileSize : null,
      processingStatus: "COMPLETED",
      uploadedById: user.id === "env_super_admin" ? undefined : user.id,
      schoolId: user.schoolId ?? undefined,
      chapterCount: chapters.length,
      chapters: {
        create: chapters.map((chapter, index) => ({
          chapterNumber: chapter.chapterNumber ?? chapter.orderIndex ?? index + 1,
          // One consistent form, whether the AI or the scan found it.
          title: cleanChapterTitle(chapter.title),
          content: chapter.content || undefined,
          questionCount: chapter.questions?.length ?? 0,
          questions: {
            create: (chapter.questions ?? []).map((q) => ({
              questionText: q.question,
              type: validTypes.includes(q.type || "") ? (q.type as QuestionType) : QuestionType.MCQ,
              options: Array.isArray(q.options) ? q.options : [],
              correctAnswer: q.correctAnswer,
              explanation: q.explanation ?? null,
              difficulty: validDifficulties.includes(q.difficulty ?? "")
                ? (q.difficulty as Difficulty)
                : Difficulty.MEDIUM,
            })),
          },
        })),
      },
    },
    include: {
      chapters: {
        include: {
          questions: true,
        },
      },
    },
  });

  return NextResponse.json({ textbook }, { status: 201 });
}
