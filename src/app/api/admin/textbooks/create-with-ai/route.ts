import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/get-session";
import { validateCsrfOrigin } from "@/lib/csrf";
import { extractTextFromFile } from "@/lib/extract-text";
import {
  detectChapters,
  splitTextByChapters,
} from "@/lib/ai-provider";

// Simple in-memory rate limiter
const rateLimitMap = new Map<string, number[]>();

function checkRateLimit(userId: string): boolean {
  const now = Date.now();
  const windowMs = 60_000; // 1 minute
  const maxRequests = 5;

  const timestamps = rateLimitMap.get(userId) ?? [];
  const recent = timestamps.filter((t) => now - t < windowMs);
  if (recent.length >= maxRequests) return false;
  recent.push(now);
  rateLimitMap.set(userId, recent);
  return true;
}

export async function POST(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user || !["SUPER_ADMIN", "SCHOOL_ADMIN"].includes(user.role)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  }

  if (!validateCsrfOrigin(request)) {
    return NextResponse.json({ error: "Invalid request origin" }, { status: 403 });
  }

  if (!checkRateLimit(user.id)) {
    return NextResponse.json(
      { error: "Too many requests. Please wait a minute before trying again." },
      { status: 429 }
    );
  }

  // Parse multipart form data
  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return NextResponse.json(
      { error: "Invalid form data." },
      { status: 400 }
    );
  }

  // Extract metadata fields
  const title = formData.get("title") as string | null;
  const subject = formData.get("subject") as string | null;
  const gradeStr = formData.get("grade") as string | null;
  const file = formData.get("file");

  if (!title?.trim()) {
    return NextResponse.json({ error: "Title is required." }, { status: 400 });
  }
  if (!subject?.trim()) {
    return NextResponse.json(
      { error: "Subject is required." },
      { status: 400 }
    );
  }
  const grade = Number(gradeStr);
  if (!grade || grade < 1 || grade > 12) {
    return NextResponse.json(
      { error: "Grade must be between 1 and 12." },
      { status: 400 }
    );
  }
  if (!file || !(file instanceof File)) {
    return NextResponse.json(
      { error: "Please upload a PDF or DOCX file." },
      { status: 400 }
    );
  }

  // Validate file type
  const fileName = file.name.toLowerCase();
  if (
    ![".pdf", ".docx", ".doc", ".epub"].some((ext) => fileName.endsWith(ext))
  ) {
    return NextResponse.json(
      { error: "Invalid file type. Please upload a PDF, DOCX, or EPUB file." },
      { status: 400 }
    );
  }

  // Validate file size (50 MB max)
  if (file.size > 50 * 1024 * 1024) {
    return NextResponse.json(
      { error: "File too large. Maximum size is 50 MB." },
      { status: 400 }
    );
  }

  // Validate at least one AI API key
  if (!process.env.GEMINI_API_KEY && !process.env.GROQ_API_KEY) {
    return NextResponse.json(
      { error: "No AI API key configured. Set GEMINI_API_KEY or GROQ_API_KEY." },
      { status: 500 }
    );
  }

  try {
    // 1. Extract text from file
    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    const extraction = await extractTextFromFile(buffer, file.name);

    // 2. Detect chapters via AI (Gemini → Groq fallback)
    const language = (formData.get("language") as string) || "en";
    let detectedChapters: any[] = [];
    let provider = "fallback";

    try {
      const result = await detectChapters({
        content: extraction.text,
        subject: subject.trim(),
        grade,
        language,
      });
      detectedChapters = result.chapters;
      provider = result.provider;
      console.log(`[Create With AI] Chapter detection used: ${provider}`);
    } catch (aiError) {
      console.warn("[Create With AI] AI Chapter detection failed. Falling back to single chapter.", aiError);
      detectedChapters = [{ chapterNumber: 1, title: "Full Textbook Content" }];
    }

    // 3. Split text by chapter boundaries (if fallback, returns the whole text)
    const chaptersWithContent = splitTextByChapters(
      extraction.text,
      detectedChapters
    );

    // 4. Return results for review (no DB creation yet)
    return NextResponse.json({
      extractedContent: {
        contentLength: extraction.text.length,
        wordCount: extraction.wordCount,
        pageCount: extraction.pageCount,
        fullText: extraction.text,
      },
      chapters: chaptersWithContent.map((ch) => ({
        chapterNumber: ch.chapterNumber,
        title: ch.title,
        contentPreview: ch.content.slice(0, 200),
        contentLength: ch.content.length,
        content: ch.content,
      })),
    });
  } catch (error) {
    console.error("[Create With AI Error]", error);
    const message =
      error instanceof Error ? error.message : "Failed to process file";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
