/**
 * Semantic Content Chunker — §4.4.2
 *
 * Splits chapter text into 500–1000 token semantic chunks using
 * sentence boundaries. Preserves paragraph coherence and never
 * splits mid-sentence.
 *
 * Token estimation: ~4 characters per token (standard English approx.)
 */

// ─── Constants ──────────────────────────────────────────

const MIN_CHUNK_TOKENS = 500;
const MAX_CHUNK_TOKENS = 1000;
const CHARS_PER_TOKEN = 4; // reasonable approximation

const MIN_CHUNK_CHARS = MIN_CHUNK_TOKENS * CHARS_PER_TOKEN; // 2000
const MAX_CHUNK_CHARS = MAX_CHUNK_TOKENS * CHARS_PER_TOKEN; // 4000

// ─── Types ──────────────────────────────────────────────

export interface ContentChunk {
  chunkIndex: number;
  content: string;
  tokenCount: number;
}

// ─── Helpers ────────────────────────────────────────────

function estimateTokens(text: string): number {
  return Math.ceil(text.length / CHARS_PER_TOKEN);
}

/**
 * Split text into sentences. Handles common English and Amharic punctuation.
 * Tries to keep sentences intact.
 */
function splitIntoSentences(text: string): string[] {
  // Split on sentence-ending punctuation followed by whitespace or end-of-string
  // Also handles Amharic full stop (።) and question mark (?)
  const sentences = text.split(/(?<=[.!?።])\s+/);
  return sentences.filter((s) => s.trim().length > 0);
}

/**
 * Split text into paragraphs first, preserving natural boundaries.
 */
function splitIntoParagraphs(text: string): string[] {
  const paragraphs = text.split(/\n\s*\n/);
  return paragraphs.filter((p) => p.trim().length > 0).map((p) => p.trim());
}

// ─── Main Chunking Function ────────────────────────────

/**
 * Split chapter content into semantic chunks of 500–1000 tokens.
 *
 * Strategy:
 * 1. Split into paragraphs
 * 2. Accumulate paragraphs until we reach the target range
 * 3. If a single paragraph exceeds MAX, split it by sentences
 * 4. Never break mid-sentence
 */
export function chunkContent(text: string): ContentChunk[] {
  if (!text || text.trim().length === 0) {
    return [];
  }

  const cleanText = text.trim();
  const totalTokens = estimateTokens(cleanText);

  // If the entire text fits in a single chunk, return it as-is
  if (totalTokens <= MAX_CHUNK_TOKENS) {
    return [
      {
        chunkIndex: 0,
        content: cleanText,
        tokenCount: totalTokens,
      },
    ];
  }

  const paragraphs = splitIntoParagraphs(cleanText);
  const chunks: ContentChunk[] = [];
  let currentChunk = "";
  let chunkIndex = 0;

  for (const paragraph of paragraphs) {
    const paragraphTokens = estimateTokens(paragraph);

    // If adding this paragraph stays within range, accumulate
    const combinedTokens = estimateTokens(currentChunk + "\n\n" + paragraph);

    if (currentChunk.length === 0) {
      // Starting a new chunk
      if (paragraphTokens > MAX_CHUNK_TOKENS) {
        // This single paragraph is too large — split by sentences
        const sentenceChunks = chunkBySentences(paragraph, chunkIndex);
        for (const sc of sentenceChunks) {
          chunks.push(sc);
          chunkIndex = sc.chunkIndex + 1;
        }
      } else {
        currentChunk = paragraph;
      }
    } else if (combinedTokens <= MAX_CHUNK_TOKENS) {
      // Still fits — keep accumulating
      currentChunk += "\n\n" + paragraph;
    } else {
      // Adding this paragraph would exceed max
      const currentTokens = estimateTokens(currentChunk);

      if (currentTokens >= MIN_CHUNK_TOKENS) {
        // Current chunk is big enough — flush it
        chunks.push({
          chunkIndex,
          content: currentChunk.trim(),
          tokenCount: currentTokens,
        });
        chunkIndex++;
        currentChunk = "";

        // Now handle the new paragraph
        if (paragraphTokens > MAX_CHUNK_TOKENS) {
          const sentenceChunks = chunkBySentences(paragraph, chunkIndex);
          for (const sc of sentenceChunks) {
            chunks.push(sc);
            chunkIndex = sc.chunkIndex + 1;
          }
        } else {
          currentChunk = paragraph;
        }
      } else {
        // Current chunk is too small — force-add and split by sentences
        const combined = currentChunk + "\n\n" + paragraph;
        const sentenceChunks = chunkBySentences(combined, chunkIndex);
        for (const sc of sentenceChunks) {
          chunks.push(sc);
          chunkIndex = sc.chunkIndex + 1;
        }
        currentChunk = "";
      }
    }
  }

  // Flush remaining content
  if (currentChunk.trim().length > 0) {
    const tokens = estimateTokens(currentChunk);
    // If last chunk is too small, merge with previous if possible
    if (tokens < MIN_CHUNK_TOKENS && chunks.length > 0) {
      const lastChunk = chunks[chunks.length - 1];
      const merged = lastChunk.content + "\n\n" + currentChunk.trim();
      const mergedTokens = estimateTokens(merged);

      if (mergedTokens <= MAX_CHUNK_TOKENS * 1.2) {
        // Allow slight overflow for the last chunk
        lastChunk.content = merged;
        lastChunk.tokenCount = mergedTokens;
      } else {
        chunks.push({
          chunkIndex,
          content: currentChunk.trim(),
          tokenCount: tokens,
        });
      }
    } else {
      chunks.push({
        chunkIndex,
        content: currentChunk.trim(),
        tokenCount: tokens,
      });
    }
  }

  return chunks;
}

/**
 * Split a long text block by sentences into valid chunks.
 */
function chunkBySentences(text: string, startIndex: number): ContentChunk[] {
  const sentences = splitIntoSentences(text);
  const chunks: ContentChunk[] = [];
  let current = "";
  let idx = startIndex;

  for (const sentence of sentences) {
    const combined = current.length > 0 ? current + " " + sentence : sentence;
    const combinedTokens = estimateTokens(combined);

    if (combinedTokens <= MAX_CHUNK_TOKENS) {
      current = combined;
    } else {
      // Flush current if it's big enough
      if (current.trim().length > 0) {
        chunks.push({
          chunkIndex: idx,
          content: current.trim(),
          tokenCount: estimateTokens(current),
        });
        idx++;
      }
      current = sentence;
    }
  }

  // Flush remaining
  if (current.trim().length > 0) {
    chunks.push({
      chunkIndex: idx,
      content: current.trim(),
      tokenCount: estimateTokens(current),
    });
  }

  return chunks;
}

/**
 * Convenience: chunk all chapters, returning a flat list with chapter IDs.
 */
export function chunkChapters(
  chapters: { id: string; content: string | null }[]
): { chapterId: string; chunks: ContentChunk[] }[] {
  return chapters
    .filter((ch) => ch.content && ch.content.trim().length > 0)
    .map((ch) => ({
      chapterId: ch.id,
      chunks: chunkContent(ch.content!),
    }));
}
