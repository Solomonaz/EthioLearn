import { NextRequest, NextResponse } from "next/server";
import { createHash } from "crypto";
import { db } from "@/lib/db";
import { getCurrentUser } from "@/lib/get-session";
import { validateCsrfOrigin } from "@/lib/csrf";
import { chunkContent } from "@/lib/content-chunker";
import { generateEmbeddings, storeChunkEmbeddings, enablePgvector, isPgvectorAvailable } from "@/lib/embeddings";
import { tagChunksWithBloomLevel } from "@/lib/bloom-tagger";
import { canManageTextbook, canViewTextbook } from "@/lib/textbook-access";

interface RouteParams {
  params: Promise<{ id: string }>;
}

/**
 * A PROCESSING run older than this is treated as dead and may be restarted.
 * Without it, a timeout or crash (which never reaches the catch block that sets
 * FAILED) left the textbook stuck on PROCESSING forever — permanently
 * unprocessable without editing the database by hand.
 */
const STALE_PROCESSING_MS = 30 * 60 * 1000; // 30 minutes

/** Fingerprint of a chapter's text — lets an unchanged chapter be skipped. */
function hashContent(content: string): string {
  return createHash("sha256").update(content).digest("hex");
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

  if (!validateCsrfOrigin(_request)) {
    return NextResponse.json({ error: "Invalid request origin" }, { status: 403 });
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
      approvalStatus: true,
      updatedAt: true,
    } as any,
  })) as any;

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

  // Don't re-process if a run is genuinely still in flight — but treat a run
  // that has been PROCESSING beyond STALE_PROCESSING_MS as dead and allow a
  // restart, so a crashed run can't strand the textbook permanently.
  if ((textbook as any).chunkingStatus === "PROCESSING") {
    const startedAt = (textbook as any).updatedAt as Date | undefined;
    const ageMs = startedAt ? Date.now() - new Date(startedAt).getTime() : Infinity;

    if (ageMs < STALE_PROCESSING_MS) {
      return NextResponse.json(
        {
          error: "Processing is already in progress for this textbook.",
          retryAfterMs: STALE_PROCESSING_MS - ageMs,
        },
        { status: 409 }
      );
    }

    console.warn(
      `[Process] Textbook ${textbookId} stuck in PROCESSING for ${Math.round(ageMs / 60000)} minutes — ` +
      `treating as a dead run and restarting.`
    );
  }

  // Get all chapters with content
  const chapters = (await db.chapter.findMany({
    where: { textbookId },
    select: {
      id: true,
      title: true,
      content: true,
      chapterNumber: true,
      contentHash: true,
    },
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
    // Step 1: Enable pgvector.
    //
    // Run this unconditionally. enablePgvector() does three idempotent things —
    // CREATE EXTENSION IF NOT EXISTS, the vector-column dimension repair, and
    // CREATE INDEX IF NOT EXISTS on the HNSW index — and only the first is
    // about the extension. Gating the whole call on "is the extension missing?"
    // meant that on any database where pgvector was installed by other means
    // (a pgvector Docker image, a managed add-on) the HNSW index was never
    // created, so every similarity query fell back to a sequential scan.
    const pgvectorEnabled = await isPgvectorAvailable();
    if (!pgvectorEnabled) {
      console.log("[Process] Enabling pgvector extension...");
    }
    await enablePgvector();

    // Step 2: Chunk all chapters
    console.log(`[Process] Chunking ${chaptersWithContent.length} chapters...`);

    let totalChunks = 0;
    let totalEmbeddings = 0;
    let skippedChapters = 0;
    const chapterResults: {
      chapterId: string;
      chapterTitle: string;
      chunkCount: number;
      embeddingsStored: number;
      skipped?: boolean;
    }[] = [];

    for (const chapter of chaptersWithContent) {
      // ── Change detection ────────────────────────────────────────────────
      // Re-processing used to re-chunk, re-Bloom-tag and re-embed every
      // chapter unconditionally, so clicking "Process" twice cost twice. Skip
      // any chapter whose text is byte-identical to the last successful run
      // AND whose chunks are already stored.
      const currentHash = hashContent(chapter.content!);
      if (chapter.contentHash === currentHash) {
        const existing: { count: bigint }[] = await db.$queryRawUnsafe(
          `SELECT COUNT(*)::bigint AS count FROM content_chunks
           WHERE "chapterId" = $1 AND embedding IS NOT NULL`,
          chapter.id
        );
        const existingCount = Number(existing[0]?.count ?? 0);

        if (existingCount > 0) {
          console.log(
            `[Process] Skipping "${chapter.title}" — content unchanged, ${existingCount} chunks already embedded.`
          );
          totalChunks += existingCount;
          totalEmbeddings += existingCount;
          chapterResults.push({
            chapterId: chapter.id,
            chapterTitle: chapter.title,
            chunkCount: existingCount,
            embeddingsStored: existingCount,
            skipped: true,
          });
          skippedChapters++;
          continue;
        }
      }

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

      // Chapter text is a stored passage, not a search string — embed it as
      // RETRIEVAL_DOCUMENT so it pairs correctly with RETRIEVAL_QUERY at
      // search time.
      const embeddingResults = await generateEmbeddings(
        chunks.map((c) => c.content),
        "RETRIEVAL_DOCUMENT",
        // Content-side work: no single student triggered it, so no actor. The
        // cost is one-time per textbook and amortised across everyone.
        { feature: "embedding-ingest" }
      );
      const embeddings = embeddingResults.map((r) => r.embedding);
      const providers = embeddingResults.map((r) => r.provider);

      // Step 5: Store in DB (with provenance, so degraded vectors are visible)
      const stored = await storeChunkEmbeddings(
        chapter.id,
        taggedChunks,
        embeddings,
        providers
      );

      // Update chapter bloom levels, and record the content fingerprint so the
      // next run can skip this chapter if nothing changed.
      const uniqueBlooms = Array.from(
        new Set(bloomTags.map((t: any) => t.bloomLevel))
      );
      await db.chapter.update({
        where: { id: chapter.id },
        data: { bloomLevels: uniqueBlooms, contentHash: currentHash } as any,
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
      chaptersSkippedUnchanged: skippedChapters,
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

  if (!canViewTextbook(user, textbook.schoolId)) {
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
