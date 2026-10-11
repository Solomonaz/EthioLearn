import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/get-session";
import { validateCsrfOrigin } from "@/lib/csrf";
import { extractAndDetectChapters } from "@/lib/textbook-ingest";
import { isAiFeatureEnabled } from "@/lib/platform-settings";
import { duplicateResponseBody, findDuplicateTextbooks } from "@/lib/textbook-access";

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

  // Schools don't run AI detection themselves — they submit a request that is
  // held until a super admin approves it (POST /api/admin/textbooks/requests).
  if (user.role !== "SUPER_ADMIN") {
    return NextResponse.json(
      { error: "Submit a textbook request instead — uploads are reviewed before processing.", code: "APPROVAL_REQUIRED" },
      { status: 403 },
    );
  }

  // Global kill-switch: AI chapter detection can be turned off platform-wide.
  if (!(await isAiFeatureEnabled("aiQuizGen"))) {
    return NextResponse.json(
      { error: "AI features are currently turned off.", code: "AI_DISABLED" },
      { status: 503 }
    );
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

  // Duplicate check comes before extraction and AI chapter detection, so a
  // redundant upload is refused before it costs anything.
  const duplicates = await findDuplicateTextbooks(user, grade, subject);
  if (duplicates.length > 0 && !(formData.get("allowDuplicate") === "1" && user.role === "SUPER_ADMIN")) {
    return NextResponse.json(duplicateResponseBody(user, duplicates), { status: 409 });
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

  // Validate at least one AI provider is configured (Gemini, NVIDIA, or Groq).
  if (
    !process.env.GEMINI_API_KEY &&
    !process.env.GEMINI_VERTEX_API_KEY &&
    !process.env.GROQ_API_KEY &&
    !process.env.NVIDIA_API_KEY
  ) {
    return NextResponse.json(
      { error: "No AI API key configured. Set GEMINI_API_KEY, GEMINI_VERTEX_API_KEY, GROQ_API_KEY, or NVIDIA_API_KEY." },
      { status: 500 }
    );
  }

  try {
    const buffer = Buffer.from(await file.arrayBuffer());
    const language = (formData.get("language") as string) || "en";
    const { extraction, chapters, warnings } = await extractAndDetectChapters(buffer, file.name, {
      subject,
      grade,
      language,
    });

    // Return results for review (no DB creation yet)
    return NextResponse.json({
      extractedContent: {
        contentLength: extraction.text.length,
        wordCount: extraction.wordCount,
        pageCount: extraction.pageCount,
        fullText: extraction.text,
      },
      // Extraction problems (OCR truncation) plus detection problems (failed
      // windows, implausibly large chapters) — shown to the admin before they
      // commit the split.
      warnings,
      chapters: chapters.map((ch) => ({
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
