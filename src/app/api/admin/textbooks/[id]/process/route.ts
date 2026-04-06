import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getCurrentUser } from "@/lib/get-session";
import { chunkContent } from "@/lib/content-chunker";
import { generateEmbeddings, storeChunkEmbeddings, enablePgvector, isPgvectorAvailable } from "@/lib/embeddings";
import { tagChunksWithBloomLevel } from "@/lib/bloom-tagger";

interface RouteParams {
  params: Promise<{ id: string }>;
}

/**
 * POST /api/admin/textbooks/[id]/process
 *
 * Triggers the full content processing pipeline:
 * 1. Enable pgvector extension (if not already)
 * 2. Chunk all chapter content (500-1000 tokens)
 * 3. Tag chunks with Bloom's Taxonomy levels
 * 4. Generate embeddings for all chunks
 * 5. Store chunks + embeddings in pgvector
 * 6. Update textbook chunkingStatus
 */
export async function POST(_request: NextRequest, { params }: RouteParams) {
  const user = await getCurrentUser();
  if (!user || !["SUPER_ADMIN", "SCHOOL_ADMIN"].includes(user.role)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  }

  const { id: textbookId } = await params;

  // Verify textbook + school isolation
  const textbook = (await db.textbook.findUnique({
    where: { id: textbookId },
    select: {
      id: true,
      title: true,
      subject: true,
      grade: true,
      schoolId: true,
      chunkingStatus: true,
    } as any,
  })) as any;

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

  // Don't re-process if already processing
  if ((textbook as any).chunkingStatus === "PROCESSING") {
    return NextResponse.json(
      { error: "Processing is already in progress for this textbook." },
      { status: 409 }
    );
  }

  // Get all chapters with content
  const chapters = (await db.chapter.findMany({
    where: { textbookId },
    select: { id: true, title: true, content: true, chapterNumber: true },
    orderBy: { chapterNumber: "asc" },
  })) as any;

  const mapped = (chapters as any[]).map(({ content, ...rest }: any) => ({
    ...rest,
    hasContent: !!content && content.length > 100,
    contentLength: content?.length ?? 0,
  }));

  const chaptersWithContent = (chapters as any[]).filter(
    (ch: any) => ch.content && ch.content.trim().length > 50
  );

  if (chaptersWithContent.length === 0) {
    return NextResponse.json(
      { error: "No chapter content found. Upload textbook content first." },
      { status: 400 }
    );
  }

  // Mark as processing
  await db.textbook.update({
    where: { id: textbookId },
    data: { chunkingStatus: "PROCESSING" } as any,
  });

  try {
    // Step 1: Enable pgvector
    const pgvectorEnabled = await isPgvectorAvailable();
    if (!pgvectorEnabled) {
      console.log("[Process] Enabling pgvector extension...");
      await enablePgvector();
    }

    // Step 2: Chunk all chapters
    console.log(`[Process] Chunking ${chaptersWithContent.length} chapters...`);

    let totalChunks = 0;
    let totalEmbeddings = 0;
    const chapterResults: {
      chapterId: string;
      chapterTitle: string;
      chunkCount: number;
      embeddingsStored: number;
    }[] = [];

    for (const chapter of chaptersWithContent) {
      const chunks = chunkContent(chapter.content!);

      if (chunks.length === 0) {
        chapterResults.push({
          chapterId: chapter.id,
          chapterTitle: chapter.title,
          chunkCount: 0,
          embeddingsStored: 0,
        });
        continue;
      }

      // Step 3: Tag with Bloom's Taxonomy
      console.log(
        `[Process] Tagging ${chunks.length} chunks for chapter "${chapter.title}" with Bloom's Taxonomy...`
      );

      const bloomTags = await tagChunksWithBloomLevel(
        chunks.map((c: any) => ({ chunkIndex: c.chunkIndex, content: c.content })),
        (textbook as any).subject,
        (textbook as any).grade
      );

      // Merge Bloom tags into chunks
      const taggedChunks = chunks.map((chunk) => {
        const tag = bloomTags.find((t) => t.chunkIndex === chunk.chunkIndex);
        return {
          ...chunk,
          bloomLevel: tag?.bloomLevel || undefined,
        };
      });

      // Step 4: Generate embeddings
      console.log(
        `[Process] Generating embeddings for ${chunks.length} chunks...`
      );

      const embeddingResults = await generateEmbeddings(
        chunks.map((c) => c.content)
      );
      const embeddings = embeddingResults.map((r) => r.embedding);

      // Step 5: Store in DB
      const stored = await storeChunkEmbeddings(
        chapter.id,
        taggedChunks,
        embeddings
      );

      // Update chapter bloom levels
      const uniqueBlooms = Array.from(
        new Set(bloomTags.map((t: any) => t.bloomLevel))
      );
      await db.chapter.update({
        where: { id: chapter.id },
        data: { bloomLevels: uniqueBlooms } as any,
      });

      totalChunks += chunks.length;
      totalEmbeddings += stored;

      chapterResults.push({
        chapterId: chapter.id,
        chapterTitle: chapter.title,
        chunkCount: chunks.length,
        embeddingsStored: stored,
      });
    }

    // Step 6: Mark as completed
    await db.textbook.update({
      where: { id: textbookId },
      data: { chunkingStatus: "COMPLETED" } as any,
    });

    console.log(
      `[Process] Completed: ${totalChunks} chunks, ${totalEmbeddings} embeddings for "${(textbook as any).title}"`
    );

    return NextResponse.json({
      success: true,
      textbookId,
      textbookTitle: (textbook as any).title,
      chaptersProcessed: (chaptersWithContent as any[]).length,
      totalChunks,
      totalEmbeddings,
      pgvectorEnabled: true,
      chapters: chapterResults,
    });
  } catch (error) {
    console.error("[Process] Pipeline failed:", error);

    // Mark as failed
    await db.textbook.update({
      where: { id: textbookId },
      data: { chunkingStatus: "FAILED" } as any,
    });

    return NextResponse.json(
      {
        error: `Processing failed: ${
          error instanceof Error ? error.message : "Unknown error"
        }`,
      },
      { status: 500 }
    );
  }
}

/**
 * GET /api/admin/textbooks/[id]/process
 *
 * Get processing status and chunk statistics for a textbook.
 */
export async function GET(_request: NextRequest, { params }: RouteParams) {
  const user = await getCurrentUser();
  if (!user || !["SUPER_ADMIN", "SCHOOL_ADMIN"].includes(user.role)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  }

  const { id: textbookId } = await params;

  const textbook = (await db.textbook.findUnique({
    where: { id: textbookId },
    select: {
      id: true,
      title: true,
      chunkingStatus: true,
      schoolId: true,
    } as any,
  })) as any;

  if (!textbook) {
    return NextResponse.json({ error: "Textbook not found" }, { status: 404 });
  }

  if (
    user.role === "SCHOOL_ADMIN" &&
    (textbook as any).schoolId &&
    user.schoolId &&
    (textbook as any).schoolId !== user.schoolId
  ) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // Get chunk stats per chapter using raw SQL (due to Unsupported vector type)
  let chunkStats: { chapterId: string; chunkCount: number; avgTokens: number }[] = [];
  try {
    chunkStats = (await db.$queryRawUnsafe(
      `SELECT "chapterId",
              COUNT(*)::int AS "chunkCount",
              ROUND(AVG("tokenCount"))::int AS "avgTokens"
       FROM content_chunks
       WHERE "chapterId" IN (
         SELECT id FROM chapters WHERE "textbookId" = $1
       )
       GROUP BY "chapterId"`,
      textbookId
    )) as any;
  } catch {
    // Content chunks table might not exist yet
  }

  const totalChunks = (chunkStats as any[]).reduce((s: number, c: any) => s + c.chunkCount, 0);

  return NextResponse.json({
    textbookId,
    chunkingStatus: textbook.chunkingStatus,
    totalChunks,
    chapterStats: chunkStats,
  });
}
