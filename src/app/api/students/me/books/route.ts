import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireCompleteProfile } from "@/lib/get-session";
import { validateCsrfOrigin } from "@/lib/csrf";

const MAX_FILE_SIZE = 52428800; // 50 MB
const MAX_STORAGE = 209715200; // 200 MB

export async function GET() {
  const user = await requireCompleteProfile();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const books = await db.studentBook.findMany({
    where: { uploadedById: user.id },
    orderBy: { createdAt: "desc" },
  });

  return NextResponse.json({ books });
}

export async function POST(req: NextRequest) {
  const user = await requireCompleteProfile();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!validateCsrfOrigin(req)) {
    return NextResponse.json({ error: "Invalid request origin" }, { status: 403 });
  }

  let body: { title?: string; description?: string; fileSize?: number };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { title, description, fileSize } = body;

  // Validate title
  if (!title || typeof title !== "string" || title.trim().length === 0) {
    return NextResponse.json({ error: "Title is required" }, { status: 400 });
  }

  // Validate fileSize
  if (typeof fileSize !== "number" || fileSize <= 0) {
    return NextResponse.json(
      { error: "fileSize must be a positive number" },
      { status: 400 },
    );
  }

  if (fileSize > MAX_FILE_SIZE) {
    return NextResponse.json(
      { error: "File size exceeds 50 MB limit" },
      { status: 400 },
    );
  }

  // Check storage quota
  const storageAgg = await db.studentBook.aggregate({
    where: { uploadedById: user.id },
    _sum: { storageBytes: true },
  });

  const usedBytes = storageAgg._sum.storageBytes ?? 0;
  if (usedBytes + fileSize > MAX_STORAGE) {
    return NextResponse.json(
      { error: "Storage quota exceeded (200 MB total)" },
      { status: 400 },
    );
  }

  const book = await db.studentBook.create({
    data: {
      title: title.trim(),
      description: description?.trim() || null,
      fileUrl: "pending-upload",
      storageBytes: fileSize,
      uploadedById: user.id,
    },
    select: {
      id: true,
      title: true,
      processingStatus: true,
    },
  });

  return NextResponse.json({ book }, { status: 201 });
}
