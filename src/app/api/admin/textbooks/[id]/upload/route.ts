import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getCurrentUser } from "@/lib/get-session";
import { validateCsrfOrigin } from "@/lib/csrf";
import { extractTextFromFile } from "@/lib/extract-text";
import { canManageTextbook } from "@/lib/textbook-access";

interface RouteParams {
  params: Promise<{ id: string }>;
}

export async function POST(request: NextRequest, { params }: RouteParams) {
  const user = await getCurrentUser();
  if (!user || !["SUPER_ADMIN", "SCHOOL_ADMIN"].includes(user.role)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  }

  if (!validateCsrfOrigin(request)) {
    return NextResponse.json({ error: "Invalid request origin" }, { status: 403 });
  }

  const { id: textbookId } = await params;

  // Verify textbook + school isolation
  const textbook = await db.textbook.findUnique({
    where: { id: textbookId },
    select: { id: true, schoolId: true, title: true, approvalStatus: true },
  });

  if (!textbook) {
    return NextResponse.json({ error: "Textbook not found" }, { status: 404 });
  }

  if (!canManageTextbook(user, textbook.schoolId)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // Nothing paid runs on a school request until a super admin approves it.
  if (textbook.approvalStatus !== "APPROVED") {
    return NextResponse.json(
      { error: "This textbook is awaiting approval.", code: "NOT_APPROVED" },
      { status: 409 },
    );
  }

  // Parse multipart form data
  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return NextResponse.json(
      { error: "Invalid form data. Please upload a file." },
      { status: 400 }
    );
  }

  const file = formData.get("file");
  if (!file || !(file instanceof File)) {
    return NextResponse.json(
      { error: "No file uploaded. Please select a PDF or DOCX file." },
      { status: 400 }
    );
  }

  // Validate file type
  const fileName = file.name.toLowerCase();
  const validExtensions = [".pdf", ".docx", ".doc", ".epub"];
  if (!validExtensions.some((ext) => fileName.endsWith(ext))) {
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

  try {
    // Convert file to buffer
    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    // Extract text from file
    const result = await extractTextFromFile(buffer, file.name);

    // Save extracted text to textbook
    await db.textbook.update({
      where: { id: textbookId },
      data: { content: result.text },
    });

    return NextResponse.json({
      success: true,
      fileName: file.name,
      contentLength: result.text.length,
      wordCount: result.wordCount,
      pageCount: result.pageCount,
      // Extraction problems the admin must see — chiefly a scanned PDF longer
      // than the OCR page cap, whose tail was never read. Reporting a clean
      // success there used to hide the loss of most of the book.
      usedOcr: result.usedOcr ?? false,
      ocrConfidence: result.ocrConfidence,
      truncated: result.truncated ?? false,
      pagesSkipped: result.pagesSkipped ?? 0,
      warnings: result.warnings ?? [],
    });
  } catch (error) {
    console.error("[File Upload Error]", error);
    const message =
      error instanceof Error ? error.message : "Failed to process file";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
