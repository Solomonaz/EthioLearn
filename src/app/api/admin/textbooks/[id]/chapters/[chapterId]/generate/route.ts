import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getCurrentUser } from "@/lib/get-session";
import { validateCsrfOrigin } from "@/lib/csrf";
import { rateLimit } from "@/lib/rate-limit";
import { generateQuestionsBatched } from "@/lib/ai-provider";

interface RouteParams {
  params: Promise<{ id: string; chapterId: string }>;
}

export async function POST(request: NextRequest, { params }: RouteParams) {
  const user = await getCurrentUser();
  if (!user || !["SUPER_ADMIN", "SCHOOL_ADMIN"].includes(user.role)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  }

  if (!validateCsrfOrigin(request)) {
    return NextResponse.json({ error: "Invalid request origin" }, { status: 403 });
  }

  // Rate limit: 5 AI generations per minute per user
  const rl = rateLimit(`ai:gen:${user.id}`, 5, 60_000);
  if (!rl.success) {
    return NextResponse.json(
      { error: "Too many AI generation requests. Please wait a moment." },
      { status: 429, headers: { "Retry-After": String(rl.retryAfter) } }
    );
  }

  const { id: textbookId, chapterId } = await params;

  // Verify textbook + school isolation — also fetch book-level content
  const textbook = await db.textbook.findUnique({
    where: { id: textbookId },
    select: { id: true, title: true, schoolId: true, subject: true, grade: true, content: true },
  });

  if (!textbook) {
    return NextResponse.json({ error: "Textbook not found" }, { status: 404 });
  }

  if (
    user.role === "SCHOOL_ADMIN" &&
    textbook.schoolId &&
    user.schoolId &&
    textbook.schoolId !== user.schoolId
  ) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  let finalContent = "";
  let finalTitle = "";

  if (chapterId === "all") {
    // Cumulative generation from all chapters
    const chapters = await db.chapter.findMany({
      where: { textbookId },
      orderBy: { chapterNumber: "asc" },
      select: { title: true, content: true, chapterNumber: true },
    });

    if (chapters.length === 0) {
      return NextResponse.json({ error: "No chapters found to generate from" }, { status: 400 });
    }

    finalTitle = `All Chapters of ${textbook.title}`;
    // Concatenate chapter contents (with a reasonable limit for token safety)
    finalContent = chapters
      .map((c) => `CHAPTER ${c.chapterNumber}: ${c.title}\n${c.content || ""}`)
      .join("\n\n")
      .slice(0, 80000); // 80k chars is roughly 20k tokens, safe for most LLMs
  } else {
    // Verify specific chapter exists
    const chapter = await db.chapter.findFirst({
      where: { id: chapterId, textbookId },
      select: { id: true, title: true, content: true },
    });

    if (!chapter) {
      return NextResponse.json({ error: "Chapter not found" }, { status: 404 });
    }
    finalTitle = chapter.title;
    finalContent = chapter.content || textbook.content || "";
  }

  if (!finalContent || finalContent.length < 100) {
    return NextResponse.json(
      { error: "No book content found. Upload the textbook content first before generating questions." },
      { status: 400 }
    );
  }

  // Parse request body
  let body: {
    count?: number;
    difficulty?: string;
    questionTypes?: string[];
  } = {};
  try {
    body = await request.json();
  } catch {
    // Use defaults
  }

  const count = Math.min(Math.max(Number(body.count) || 10, 1), 30);

  const validDifficulties = ["EASY", "MEDIUM", "HARD", "MIXED"];
  const difficulty = validDifficulties.includes(String(body.difficulty))
    ? (body.difficulty as "EASY" | "MEDIUM" | "HARD" | "MIXED")
    : "MIXED";

  const validTypes = ["MCQ", "TRUE_FALSE", "FILL_IN_BLANK", "MATCH_PAIRS", "ORDERING"];
  const questionTypes = Array.isArray(body.questionTypes) && body.questionTypes.length > 0
    ? (body.questionTypes.filter((t) => validTypes.includes(t)) as ("MCQ" | "TRUE_FALSE" | "FILL_IN_BLANK" | "MATCH_PAIRS" | "ORDERING")[])
    : ["MCQ" as const];

  // Check at least one AI provider is configured. The provider chain supports
  // Gemini, Cerebras, NVIDIA and Groq — accept ANY of them, not just the first two.
  if (
    !process.env.GEMINI_API_KEY &&
    !process.env.GROQ_API_KEY &&
    !process.env.CEREBRAS_API_KEY &&
    !process.env.NVIDIA_API_KEY
  ) {
    return NextResponse.json(
      { error: "AI generation is not configured. Set GEMINI_API_KEY, GROQ_API_KEY, CEREBRAS_API_KEY, or NVIDIA_API_KEY." },
      { status: 503 }
    );
  }

  try {
    const { questions, provider } = await generateQuestionsBatched({
      content: finalContent,
      chapterTitle: finalTitle,
      subject: textbook.subject,
      grade: textbook.grade,
      count,
      difficulty,
      questionTypes: questionTypes as any,
    });

    console.log(`[AI Generation] Used provider: ${provider}`);

    // Run Post-Processing Quality Pipeline
    const { runQualityPipeline } = await import("@/lib/ai-provider");
    const qualityResults = await runQualityPipeline(
      questions,
      finalContent,
      textbook.subject,
      textbook.grade,
      provider
    );

    // Map quality results back to questions
    const finalQuestions = questions.map((q, i) => {
      const qResult = qualityResults.results[i];
      return {
        ...q,
        qualityScore: qResult.qualityScore,
        qualityFlags: qResult.flags,
        qualityPassed: qResult.passed,
        qualityVerified: qResult.verified,
        qualityDetails: qResult.details,
      };
    });

    return NextResponse.json({
      questions: finalQuestions,
      provider,
      quality: {
        averageScore: qualityResults.averageScore,
        passCount: qualityResults.passCount,
        failCount: qualityResults.failCount,
        duplicatePairs: qualityResults.duplicatePairs,
      },
      generatedAt: new Date().toISOString(),
      chapterId: chapterId === "all" ? "all" : chapterId,
      chapterTitle: finalTitle,
    });
  } catch (error) {
    console.error("[AI Generation Error]", error);
    const message =
      error instanceof Error ? error.message : "AI generation failed";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
