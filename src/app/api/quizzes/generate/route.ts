import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getCurrentUser } from "@/lib/get-session";
import { rateLimit } from "@/lib/rate-limit";

export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // 30 quiz generations per minute per user
  const rl = rateLimit(`quiz:gen:${user.id}`, 30, 60 * 1000);
  if (!rl.success) {
    return NextResponse.json(
      { error: "Slow down! Too many quiz requests." },
      { status: 429, headers: { "Retry-After": String(rl.retryAfter) } }
    );
  }

  try {
    const body = await request.json();
    const { chapterId, difficulty, questionCount = 10, mode = "SOLO" } = body;

    if (!chapterId) {
      return NextResponse.json(
        { error: "Chapter ID is required" },
        { status: 400 }
      );
    }

    // Validate question count (1–50)
    const count = Math.min(Math.max(Number(questionCount) || 10, 1), 50);

    // Validate difficulty enum
    if (difficulty && !["EASY", "MEDIUM", "HARD", "MIXED"].includes(difficulty)) {
      return NextResponse.json(
        { error: "difficulty must be EASY, MEDIUM, HARD, or MIXED" },
        { status: 400 }
      );
    }

    // Validate mode enum
    if (mode && !["SOLO", "TIMED", "GROUP"].includes(mode)) {
      return NextResponse.json(
        { error: "mode must be SOLO, TIMED, or GROUP" },
        { status: 400 }
      );
    }

    // Verify chapter exists
    const chapterExists = await db.chapter.findUnique({
      where: { id: chapterId },
      select: { id: true },
    });
    if (!chapterExists) {
      return NextResponse.json(
        { error: "Chapter not found" },
        { status: 404 }
      );
    }

    // Build query filter — only PUBLISHED questions (not DRAFT AI-generated ones)
    const where: Record<string, unknown> = { chapterId, status: "PUBLISHED" };
    if (difficulty && difficulty !== "MIXED") {
      where.difficulty = difficulty;
    }

    // Fetch all matching questions and shuffle
    const allQuestions = await db.question.findMany({
      where,
      select: {
        id: true,
        questionText: true,
        options: true,
        type: true,
        difficulty: true,
      },
    });

    if (allQuestions.length === 0) {
      return NextResponse.json(
        { error: "No questions available for this selection" },
        { status: 404 }
      );
    }

    // Fisher-Yates shuffle
    const shuffled = [...allQuestions];
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }

    const selected = shuffled.slice(0, Math.min(count, shuffled.length));

    // Create quiz record
    const quiz = await db.quiz.create({
      data: {
        studentId: user.id,
        mode,
        totalQuestions: selected.length,
      },
    });

    // Return questions WITHOUT correctAnswer (security)
    return NextResponse.json({
      quizId: quiz.id,
      mode: quiz.mode,
      totalQuestions: selected.length,
      questions: selected.map((q) => ({
        id: q.id,
        questionText: q.questionText,
        options: q.options,
        type: q.type,
        difficulty: q.difficulty,
      })),
    });
  } catch (error) {
    console.error("Quiz generation error:", error);
    return NextResponse.json(
      { error: "Failed to generate quiz" },
      { status: 500 }
    );
  }
}
