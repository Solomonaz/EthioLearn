import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getCurrentUser } from "@/lib/get-session";
import { Difficulty } from "@prisma/client";

export async function GET() {
  const user = await getCurrentUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!["SUPER_ADMIN", "SCHOOL_ADMIN"].includes(user.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const schoolId = user.schoolId;

  const textbooks = await db.textbook.findMany({
    where: schoolId ? { schoolId } : {},
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      title: true,
      subject: true,
      grade: true,
      processingStatus: true,
      createdAt: true,
      content: true,
      _count: {
        select: { chapters: true },
      },
      chapters: {
        orderBy: { chapterNumber: "asc" as const },
        select: {
          id: true,
          title: true,
          chapterNumber: true,
          _count: {
            select: { questions: true },
          },
        },
      },
    },
  });

  // Map to include hasContent flag without sending full content to client
  const mapped = textbooks.map(({ content, ...rest }) => ({
    ...rest,
    hasContent: !!content && content.length > 100,
    contentLength: content?.length ?? 0,
  }));

  return NextResponse.json({ textbooks: mapped });
}

interface QuestionInput {
  question: string;
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
}

export async function POST(request: NextRequest) {
  const user = await getCurrentUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!["SUPER_ADMIN", "SCHOOL_ADMIN"].includes(user.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
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

  const validDifficulties = ["EASY", "MEDIUM", "HARD"];

  const textbook = await db.textbook.create({
    data: {
      title: title.trim(),
      subject: subject.trim(),
      grade,
      publisher: publisher?.trim() || undefined,
      academicYear: academicYear?.trim() || undefined,
      content: content || undefined,
      fileUrl: "",
      processingStatus: "COMPLETED",
      uploadedById: user.id,
      schoolId: user.schoolId ?? undefined,
      chapterCount: chapters.length,
      chapters: {
        create: chapters.map((chapter, index) => ({
          chapterNumber: chapter.chapterNumber ?? chapter.orderIndex ?? index + 1,
          title: chapter.title,
          content: chapter.content || undefined,
          questionCount: chapter.questions?.length ?? 0,
          questions: {
            create: (chapter.questions ?? []).map((q) => ({
              questionText: q.question,
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
