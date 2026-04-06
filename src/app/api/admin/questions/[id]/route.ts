import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getCurrentUser } from "@/lib/get-session";
import { Difficulty, QuestionType } from "@prisma/client";

async function getQuestionForUser(id: string, userId: string, userRole: string, userSchoolId: string | null | undefined) {
  const question = await db.question.findUnique({
    where: { id },
    select: {
      id: true,
      chapter: {
        select: {
          textbook: { select: { schoolId: true } },
        },
      },
    },
  });

  if (!question) return null;

  // SCHOOL_ADMIN can only access questions from their school
  if (
    userRole === "SCHOOL_ADMIN" &&
    userSchoolId &&
    question.chapter.textbook.schoolId !== userSchoolId
  ) {
    return null;
  }

  return question;
}

interface UpdateQuestionBody {
  questionText?: string;
  options?: unknown;
  correctAnswer?: string;
  difficulty?: string;
  explanation?: string;
  videoUrl?: string | null;
  type?: string;
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await getCurrentUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!["SUPER_ADMIN", "SCHOOL_ADMIN"].includes(user.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id } = await params;

  const existing = await getQuestionForUser(id, user.id, user.role, user.schoolId);

  if (!existing) {
    return NextResponse.json({ error: "Question not found" }, { status: 404 });
  }

  let body: UpdateQuestionBody;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { questionText, options, correctAnswer, difficulty, explanation, videoUrl, type } = body;

  const validDifficulties: string[] = ["EASY", "MEDIUM", "HARD"];
  const validTypes: string[] = ["MCQ", "TRUE_FALSE", "FILL_IN_BLANK", "MATCH_PAIRS", "ORDERING"];

  // Build update data selectively
  const updateData: Record<string, unknown> = {};

  if (questionText !== undefined) {
    if (typeof questionText !== "string" || questionText.trim() === "") {
      return NextResponse.json({ error: "questionText cannot be empty" }, { status: 400 });
    }
    updateData.questionText = questionText.trim();
  }

  if (options !== undefined) {
    if (!Array.isArray(options) || options.length < 2) {
      return NextResponse.json(
        { error: "options must be an array with at least 2 items" },
        { status: 400 },
      );
    }
    updateData.options = options as string[];
  }

  if (correctAnswer !== undefined) {
    if (typeof correctAnswer !== "string" || correctAnswer.trim() === "") {
      return NextResponse.json({ error: "correctAnswer cannot be empty" }, { status: 400 });
    }
    // Validate against provided options or already-stored options
    const effectiveOptions = (updateData.options ?? options) as string[] | undefined;
    if (effectiveOptions && !effectiveOptions.includes(correctAnswer)) {
      return NextResponse.json(
        { error: "correctAnswer must be one of the options" },
        { status: 400 },
      );
    }
    updateData.correctAnswer = correctAnswer;
  }

  if (difficulty !== undefined) {
    if (validDifficulties.includes(difficulty)) {
      updateData.difficulty = difficulty as Difficulty;
    } else {
      return NextResponse.json(
        { error: "difficulty must be EASY, MEDIUM, or HARD" },
        { status: 400 },
      );
    }
  }

  if (explanation !== undefined) {
    updateData.explanation = explanation ?? null;
  }

  if (videoUrl !== undefined) {
    if (videoUrl !== null && typeof videoUrl !== "string") {
      return NextResponse.json({ error: "videoUrl must be a string or null" }, { status: 400 });
    }
    updateData.videoUrl = videoUrl ?? null;
  }

  if (type !== undefined) {
    if (validTypes.includes(type)) {
      updateData.type = type as QuestionType;
    } else {
      return NextResponse.json({ error: "Invalid question type" }, { status: 400 });
    }
  }

  const question = await db.question.update({
    where: { id },
    data: updateData,
    include: {
      chapter: {
        select: {
          id: true,
          title: true,
          chapterNumber: true,
          textbook: {
            select: { id: true, title: true, subject: true, grade: true },
          },
        },
      },
    },
  });

  return NextResponse.json({ question });
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await getCurrentUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!["SUPER_ADMIN", "SCHOOL_ADMIN"].includes(user.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id } = await params;

  const existing = await getQuestionForUser(id, user.id, user.role, user.schoolId);

  if (!existing) {
    return NextResponse.json({ error: "Question not found" }, { status: 404 });
  }

  await db.question.delete({ where: { id } });

  return NextResponse.json({ success: true });
}
