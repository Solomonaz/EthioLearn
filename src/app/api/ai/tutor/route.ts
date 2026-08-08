import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getCurrentUser } from "@/lib/get-session";
import { chatWithTutor } from "@/lib/ai-provider";
import { semanticSearch } from "@/lib/embeddings";
import { getEntitlements, UPGRADE_MESSAGES } from "@/lib/entitlements";
import { isAiFeatureEnabled } from "@/lib/platform-settings";

// How many of the most relevant chunks to retrieve as tutor context.
const TUTOR_RETRIEVAL_LIMIT = 8;

/**
 * Build the grounding content for the tutor. Prefers semantic retrieval over
 * the chapter's embedded chunks — the chunks most relevant to the student's
 * question — so the model receives focused context instead of a blindly
 * truncated prefix of a possibly-huge chapter. Falls back to the raw chapter
 * text when the chapter has not been processed into embeddings yet (or pgvector
 * is unavailable), preserving the previous behaviour in that case.
 */
async function buildTutorContext(
  chapterId: string,
  message: string,
  fallback: string
): Promise<string> {
  try {
    const hits = await semanticSearch(message, {
      chapterId,
      limit: TUTOR_RETRIEVAL_LIMIT,
    });

    if (hits.length > 0) {
      // Preserve the chapter's natural reading order for coherence.
      return hits
        .slice()
        .sort((a, b) => a.chunkIndex - b.chunkIndex)
        .map((h) => h.content)
        .join("\n\n---\n\n");
    }
  } catch (err) {
    console.warn("[Tutor API] Semantic retrieval failed, using raw chapter content:", err);
  }

  return fallback;
}

export async function POST(req: Request) {
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
  if (!(await isAiFeatureEnabled("aiTutor"))) {
    return NextResponse.json(
      { error: "The AI tutor is currently turned off.", code: "AI_DISABLED" },
      { status: 503 }
    );
  }

  try {
    const { chapterId, message, history = [] } = await req.json();

    if (!chapterId || !message) {
      return NextResponse.json({ error: "Chapter ID and message are required" }, { status: 400 });
    }

    // 1. Fetch Chapter Content
    const chapter = await db.chapter.findUnique({
      where: { id: chapterId },
      include: {
        textbook: true,
      },
    });

    if (!chapter) {
      return NextResponse.json({ error: "Chapter not found" }, { status: 404 });
    }

    // 2. Retrieve the most relevant chunks for this question (RAG), falling
    //    back to raw chapter text when embeddings aren't available.
    const content = await buildTutorContext(
      chapterId,
      message,
      chapter.content || chapter.textbook.content || ""
    );

    // 3. Chat with Tutor
    const result = await chatWithTutor({
      message,
      history,
      content,
      chapterTitle: chapter.title,
      subject: chapter.textbook.subject,
      grade: chapter.textbook.grade,
    });

    return NextResponse.json({
      response: result.response,
      provider: result.provider,
    });
  } catch (error) {
    console.error("[Tutor API Error]", error);
    return NextResponse.json({ error: "Failed to generate tutor response" }, { status: 500 });
  }
}
