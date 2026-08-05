import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getCurrentUser } from "@/lib/get-session";
import { rateLimit } from "@/lib/rate-limit";
import { generateQuestions } from "@/lib/ai-provider";
import { QuestionType, Difficulty } from "@prisma/client";
import { normalizeOption, shuffleArray } from "@/lib/utils";
import { getRecommendedDifficulty } from "@/lib/adaptive-learning";
import { getEntitlements, UPGRADE_MESSAGES } from "@/lib/entitlements";

export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const ent = await getEntitlements(user);
  if (!ent.ai) {
    return NextResponse.json(
      { error: UPGRADE_MESSAGES.ai, code: "UPGRADE_REQUIRED" },
      { status: 403 }
    );
  }

  // Rate limit: 3 AI generations per minute for students (stricter than admins)
  const rl = rateLimit(`ai:student:gen:${user.id}`, 3, 60_000);
  if (!rl.success) {
    return NextResponse.json(
      { error: "Too many AI generation requests. Please wait a moment." },
      { status: 429, headers: { "Retry-After": String(rl.retryAfter) } }
    );
  }

  try {
    const body = await request.json();
    let { textbookId, chapterId, difficulty = "MIXED", questionCount = 10, mode = "SOLO", isDailyChallenge = false } = body;

    if (!textbookId) {
      return NextResponse.json({ error: "Textbook ID is required" }, { status: 400 });
    }

    // Resolve Adaptive Difficulty
    if (difficulty === "ADAPTIVE") {
      difficulty = await getRecommendedDifficulty(user.id);
      console.log(`[Adaptive AI] Calibrated difficulty to: ${difficulty}`);
    }

    // 1. Fetch Textbook & Content
    const textbook = await db.textbook.findUnique({
      where: { id: textbookId },
      select: { title: true, subject: true, grade: true, content: true },
    });

    if (!textbook) {
      return NextResponse.json({ error: "Textbook not found" }, { status: 404 });
    }

    let finalContent = "";
    let finalTitle = "";
    let targetChapterId: string | null = null;

    // 2. Resolve Content (Chapter or All)
    if (chapterId === "all") {
      const chapters = await db.chapter.findMany({
        where: { textbookId },
        orderBy: { chapterNumber: "asc" },
        select: { id: true, title: true, content: true, chapterNumber: true },
      });

      if (chapters.length === 0) {
        return NextResponse.json({ error: "No chapters found" }, { status: 400 });
      }

      finalTitle = `All Chapters of ${textbook.title}`;
      finalContent = chapters
        .map((c) => `CHAPTER ${c.chapterNumber}: ${c.title}\n${c.content || ""}`)
        .join("\n\n")
        .slice(0, 80000);
      
      // Use the first chapter as a placeholder for DB linkage if needed, 
      // or we can handle null chapterId if our schema allows (it doesn't).
      // For "All", we'll just pick the first chapter for now.
      targetChapterId = chapters[0].id;
    } else {
      const chapter = await db.chapter.findFirst({
        where: { id: chapterId, textbookId },
        select: { id: true, title: true, content: true },
      });

      if (!chapter) {
        return NextResponse.json({ error: "Chapter not found" }, { status: 404 });
      }
      finalTitle = chapter.title;
      finalContent = chapter.content || textbook.content || "";
      targetChapterId = chapter.id;
    }

    if (!finalContent || finalContent.length < 100) {
      return NextResponse.json({ error: "Not enough book content to generate questions." }, { status: 400 });
    }

    // 3. AI Generation
    const count = Math.min(Math.max(Number(questionCount) || 10, 1), 20);
    const validTypes = ["MCQ", "TRUE_FALSE", "FILL_IN_BLANK", "MATCH_PAIRS", "ORDERING"];
    const questionTypes = Array.isArray(body.questionTypes) && body.questionTypes.length > 0
      ? (body.questionTypes.filter((t: string) => validTypes.includes(t)) as ("MCQ" | "TRUE_FALSE" | "FILL_IN_BLANK" | "MATCH_PAIRS" | "ORDERING")[])
      : ["MCQ" as const];

    const { questions: aiQuestions } = await generateQuestions({
      content: finalContent,
      chapterTitle: finalTitle,
      subject: textbook.subject,
      grade: textbook.grade,
      count,
      difficulty: difficulty as any,
      questionTypes: questionTypes as any,
    });

    // 4. Save to DB (Filtered by Deduplication)
    // We fetch existing questions for this chapter to avoid duplicates
    const questionTexts = aiQuestions.map((q) => q.questionText);
    const existingQuestions = await db.question.findMany({
      where: {
        chapterId: targetChapterId!,
        questionText: { in: questionTexts },
      },
    });

    // Separate New vs. existing (Exact Text Match)
    const existingTexts = new Set(existingQuestions.map((q) => q.questionText));
    const newQuestionsData = aiQuestions.filter((q) => !existingTexts.has(q.questionText));

    const newlyCreatedQuestions = await Promise.all(
      newQuestionsData.map((q) =>
        db.question.create({
          data: {
            chapterId: targetChapterId!,
            questionText: q.questionText,
            type: q.type as any,
            difficulty: q.difficulty as any,
            options: q.options,
            correctAnswer: q.correctAnswer,
            explanation: q.explanation,
            status: "PUBLISHED",
          },
        })
      )
    );

    // Combine for final quiz (maintaining original AI order if possible, or just concat)
    const allQuizQuestions = [...existingQuestions, ...newlyCreatedQuestions];

    // 5. Create Quiz Session
    const quiz = await db.quiz.create({
      data: {
        studentId: user.id,
        mode: mode as any,
        isDailyChallenge,
        totalQuestions: allQuizQuestions.length,
      } as any,
    });

    return NextResponse.json({
      quizId: quiz.id,
      questions: allQuizQuestions.map((q) => {
        const options = (q.options as any[]).map(normalizeOption);
        return {
          id: q.id,
          questionText: q.questionText,
          // Randomise MCQ order (grading is by text — display order is safe).
          options: q.type === "MCQ" ? shuffleArray(options) : options,
          type: q.type,
          difficulty: q.difficulty,
        };
      }),
      adaptiveCalibrated: body.difficulty === "ADAPTIVE" ? difficulty : undefined,
    });
  } catch (error) {
    console.error("[Student AI Generation Error]", error);
    return NextResponse.json({ error: "Failed to generate practice quiz" }, { status: 500 });
  }
}
