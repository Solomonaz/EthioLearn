/**
 * POST /api/students/me/books/[id]/upload
 * Accepts a multipart form with the actual file, stores its text content
 * in the StudentBook record, and marks it ready for processing.
 *
 * SRS §4.8 — Student Book Upload & Custom Quiz Generation
 */
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireCompleteProfile } from "@/lib/get-session";
import { extractTextFromFile } from "@/lib/extract-text";

const MAX_FILE_BYTES = 52_428_800; // 50 MB

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await requireCompleteProfile();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id: bookId } = await params;

  // Verify book belongs to this student and is still pending
  const book = await db.studentBook.findUnique({ where: { id: bookId } });
  if (!book || book.uploadedById !== user.id) {
    return NextResponse.json({ error: "Book not found" }, { status: 404 });
  }
  if (book.processingStatus !== "PENDING") {
    return NextResponse.json({ error: "Book already uploaded" }, { status: 400 });
  }

  // Parse the multipart form
  let formData: FormData;
  try {
    formData = await req.formData();
  } catch {
    return NextResponse.json({ error: "Invalid multipart form" }, { status: 400 });
  }

  const file = formData.get("file");
  if (!file || typeof file === "string") {
    return NextResponse.json({ error: "File is required" }, { status: 400 });
  }

  const fileObj = file as File;
  if (fileObj.size > MAX_FILE_BYTES) {
    return NextResponse.json({ error: "File too large (max 50 MB)" }, { status: 400 });
  }

  const ext = fileObj.name.toLowerCase().split(".").pop() ?? "";
  if (!["pdf", "docx", "doc", "epub"].includes(ext)) {
    return NextResponse.json(
      { error: "Unsupported file type. Use PDF, DOCX, or EPUB." },
      { status: 400 }
    );
  }

  // ── Content moderation: basic keyword blocklist ──────────────────────────────
  const BLOCKED_KEYWORDS = ["pornography", "explicit", "adult content"];
  const titleLower = book.title.toLowerCase();
  if (BLOCKED_KEYWORDS.some((kw) => titleLower.includes(kw))) {
    return NextResponse.json(
      { error: "Content moderation: inappropriate title detected." },
      { status: 400 }
    );
  }

  // Mark as PROCESSING
  await db.studentBook.update({
    where: { id: bookId },
    data: { processingStatus: "PROCESSING", storageBytes: fileObj.size },
  });

  try {
    // Extract text from the file
    const buffer = Buffer.from(await fileObj.arrayBuffer());
    const extraction = await extractTextFromFile(buffer, fileObj.name);

    // Content moderation: scan extracted text for blocked terms
    const textLower = extraction.text.toLowerCase();
    if (BLOCKED_KEYWORDS.some((kw) => textLower.includes(kw))) {
      await db.studentBook.update({
        where: { id: bookId },
        data: { processingStatus: "FAILED" },
      });
      return NextResponse.json(
        { error: "Content moderation: inappropriate content detected in file." },
        { status: 400 }
      );
    }

    // Store extracted content and mark COMPLETED
    await db.studentBook.update({
      where: { id: bookId },
      data: {
        content: extraction.text,
        processingStatus: "COMPLETED",
        storageBytes: fileObj.size,
        fileUrl: `student-books/${user.id}/${bookId}.${ext}`,
      },
    });

    // Award +300 points on first successful upload (SRS §4.7.1)
    const updated = await db.studentBook.findUnique({ where: { id: bookId } });
    if (updated && !updated.pointsAwarded) {
      await db.studentBook.update({ where: { id: bookId }, data: { pointsAwarded: true } });
      await db.pointLedger.create({
        data: {
          userId: user.id,
          actionType: "BOOK_UPLOAD",
          points: 300,
          description: `Book uploaded: "${book.title}"`,
        },
      });
      await db.user.update({
        where: { id: user.id },
        data: { totalPoints: { increment: 300 } },
      });

      // Check Knowledge Sharer achievement (fire-and-forget)
      const { checkBookUploadAchievement } = await import("@/lib/achievements");
      checkBookUploadAchievement(user.id).catch(console.error);
    }

    return NextResponse.json({
      success: true,
      wordCount: extraction.wordCount,
      pageCount: extraction.pageCount,
    });
  } catch (err) {
    console.error("[student-book-upload] error:", err);
    await db.studentBook.update({
      where: { id: bookId },
      data: { processingStatus: "FAILED" },
    });
    return NextResponse.json(
      { error: "Failed to process file. Please try again." },
      { status: 500 }
    );
  }
}
