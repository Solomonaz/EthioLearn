import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getCurrentUser } from "@/lib/get-session";
import { rateLimit } from "@/lib/rate-limit";
import { generateQuestions } from "@/lib/ai-provider";

interface RouteParams {
  params: Promise<{ id: string; chapterId: string }>;
}

export async function POST(request: NextRequest, { params }: RouteParams) {
  const user = await getCurrentUser();
  if (!user || !["SUPER_ADMIN", "SCHOOL_ADMIN"].includes(user.role)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
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
    select: { id: true, schoolId: true, subject: true, grade: true, content: true },
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

  // Verify chapter exists
  const chapter = await db.chapter.findFirst({
    where: { id: chapterId, textbookId },
    select: { id: true, title: true, content: true },
  });

  if (!chapter) {
    return NextResponse.json({ error: "Chapter not found" }, { status: 404 });
  }

  // Use chapter content if available, otherwise fall back to textbook content
  const content = chapter.content || textbook.content;

  if (!content || content.length < 100) {
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

  const validTypes = ["MCQ", "TRUE_FALSE"];
  const questionTypes = Array.isArray(body.questionTypes)
    ? (body.questionTypes.filter((t) => validTypes.includes(t)) as ("MCQ" | "TRUE_FALSE")[])
    : ["MCQ" as const];

  // Check at least one AI API key
  if (!process.env.GEMINI_API_KEY && !process.env.GROQ_API_KEY) {
    return NextResponse.json(
      { error: "AI generation is not configured. Set GEMINI_API_KEY or GROQ_API_KEY." },
      { status: 503 }
    );
  }

  try {
    const { questions, provider } = await generateQuestions({
      content,
      chapterTitle: chapter.title,
      subject: textbook.subject,
      grade: textbook.grade,
      count,
      difficulty,
      questionTypes,
    });

    console.log(`[AI Generation] Used provider: ${provider}`);

    return NextResponse.json({
      questions,
      provider,
      generatedAt: new Date().toISOString(),
      chapterId: chapter.id,
      chapterTitle: chapter.title,
    });
  } catch (error) {
    console.error("[AI Generation Error]", error);
    const message =
      error instanceof Error ? error.message : "AI generation failed";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
