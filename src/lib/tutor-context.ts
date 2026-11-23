import { semanticSearch } from "@/lib/embeddings";
import type { UsageActor } from "@/lib/usage-logger";

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
export async function buildTutorContext(
  chapterId: string,
  message: string,
  fallback: string,
  actor?: UsageActor
): Promise<string> {
  try {
    const hits = await semanticSearch(message, {
      chapterId,
      limit: TUTOR_RETRIEVAL_LIMIT,
      // One short vector per student message — small, but it is the only
      // embedding cost that scales with student traffic, so it is attributed
      // to the student who caused it.
      usage: { feature: "embedding-query", actor },
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
