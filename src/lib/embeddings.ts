/**
 * Embedding Generation & Vector DB Operations — §4.4.2
 *
 * Uses Gemini text-embedding-004 for embedding generation
 * and pgvector for storage and semantic similarity search.
 */

import { GoogleGenerativeAI } from "@google/generative-ai";
import { db } from "./db";

// ─── Constants ──────────────────────────────────────────

const EMBEDDING_MODEL = "text-embedding-004";
const EMBEDDING_DIMENSIONS = 768;
const BATCH_SIZE = 50; // Gemini supports up to 100, use 50 for safety

// ─── Ollama config ───────────────────────────────────────
const OLLAMA_BASE_URL = process.env.OLLAMA_BASE_URL ?? "http://localhost:11434";
const OLLAMA_EMBEDDING_MODEL = "bge-m3";

// ─── Types ──────────────────────────────────────────────

export interface EmbeddingResult {
  text: string;
  embedding: number[];
}

export interface SemanticSearchResult {
  id: string;
  chapterId: string;
  chunkIndex: number;
  content: string;
  bloomLevel: string | null;
  similarity: number;
}

// ─── Client ─────────────────────────────────────────────

function getClient() {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error("GEMINI_API_KEY is required for embedding generation.");
  }
  return new GoogleGenerativeAI(apiKey);
}

// ─── Fallback: character n-gram fingerprint ─────────────
// Used when the embedding API is unavailable. Produces a deterministic
// dense vector so cosine similarity still detects near-duplicates.

function ngramFingerprint(text: string, dims: number): number[] {
  const vec = new Array(dims).fill(0);
  const t = text.toLowerCase().replace(/\s+/g, " ").trim();
  const n = 3; // trigrams
  for (let i = 0; i <= t.length - n; i++) {
    let h = 0;
    for (let k = 0; k < n; k++) h = (Math.imul(31, h) + t.charCodeAt(i + k)) >>> 0;
    vec[h % dims] += 1;
  }
  // L2-normalise
  const norm = Math.sqrt(vec.reduce((s, v) => s + v * v, 0)) || 1;
  return vec.map((v) => v / norm);
}

// ─── Runtime capability flags ────────────────────────────
// Try each provider once per process and cache the result to avoid
// spamming logs or wasting time on known-unavailable providers.
let geminiEmbeddingsAvailable: boolean | null = null;
let ollamaEmbeddingsAvailable: boolean | null = null;

async function tryGeminiEmbedding(text: string): Promise<number[] | null> {
  if (geminiEmbeddingsAvailable === false) return null;
  if (!process.env.GEMINI_API_KEY) {
    geminiEmbeddingsAvailable = false;
    return null;
  }
  try {
    const client = getClient();
    const model = client.getGenerativeModel({ model: EMBEDDING_MODEL });
    const result = await model.embedContent(text);
    geminiEmbeddingsAvailable = true;
    return result.embedding.values;
  } catch {
    if (geminiEmbeddingsAvailable === null) {
      console.warn(
        `[Embeddings] Gemini embedding model "${EMBEDDING_MODEL}" unavailable — trying Ollama ${OLLAMA_EMBEDDING_MODEL} fallback.`
      );
    }
    geminiEmbeddingsAvailable = false;
    return null;
  }
}

// Ollama /api/embed supports batching — send all texts in one request.
// BGE-M3 outputs 1024 dims; we slice to EMBEDDING_DIMENSIONS (768) and
// re-normalise so vectors are compatible with the existing pgvector schema.
async function tryOllamaEmbeddings(texts: string[]): Promise<number[][] | null> {
  if (ollamaEmbeddingsAvailable === false) return null;
  try {
    const response = await fetch(`${OLLAMA_BASE_URL}/api/embed`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: OLLAMA_EMBEDDING_MODEL, input: texts }),
      signal: AbortSignal.timeout(60_000),
    });

    if (!response.ok) {
      ollamaEmbeddingsAvailable = false;
      return null;
    }

    const data = await response.json() as { embeddings?: number[][] };
    const embeddings = data.embeddings;

    if (!Array.isArray(embeddings) || embeddings.length !== texts.length) {
      ollamaEmbeddingsAvailable = false;
      return null;
    }

    if (ollamaEmbeddingsAvailable === null) {
      console.info(`[Embeddings] Using Ollama ${OLLAMA_EMBEDDING_MODEL} for embeddings.`);
    }
    ollamaEmbeddingsAvailable = true;

    // Slice to EMBEDDING_DIMENSIONS and L2-normalise
    return embeddings.map((emb) => {
      const sliced = emb.slice(0, EMBEDDING_DIMENSIONS);
      const norm = Math.sqrt(sliced.reduce((s, v) => s + v * v, 0)) || 1;
      return sliced.map((v) => v / norm);
    });
  } catch {
    if (ollamaEmbeddingsAvailable === null) {
      console.warn(
        `[Embeddings] Ollama (${OLLAMA_EMBEDDING_MODEL}) unavailable — falling back to local n-gram fingerprint.`
      );
    }
    ollamaEmbeddingsAvailable = false;
    return null;
  }
}

// ─── Single Embedding ───────────────────────────────────

export async function generateEmbedding(text: string): Promise<number[]> {
  const ollama = await tryOllamaEmbeddings([text]);
  if (ollama) return ollama[0];

  const gemini = await tryGeminiEmbedding(text);
  if (gemini) return gemini;

  return ngramFingerprint(text, EMBEDDING_DIMENSIONS);
}

// ─── Batch Embeddings ───────────────────────────────────
// Priority: Ollama BGE-M3 (one batch request) → Gemini (parallel per-text)
// → n-gram fingerprint.

export async function generateEmbeddings(
  texts: string[]
): Promise<EmbeddingResult[]> {
  if (texts.length === 0) return [];

  const results: EmbeddingResult[] = [];

  for (let i = 0; i < texts.length; i += BATCH_SIZE) {
    const batch = texts.slice(i, i + BATCH_SIZE);

    // 1. Ollama BGE-M3 (single batched request — no per-item quota)
    const ollamaResults = await tryOllamaEmbeddings(batch);
    if (ollamaResults) {
      results.push(...batch.map((text, j) => ({ text, embedding: ollamaResults[j] })));
      continue;
    }

    // 2. Gemini (parallel per-text)
    if (geminiEmbeddingsAvailable !== false) {
      const geminiResults = await Promise.all(
        batch.map(async (text) => ({ text, embedding: await tryGeminiEmbedding(text) }))
      );

      if (geminiResults.every((r) => r.embedding !== null)) {
        results.push(...geminiResults.map((r) => ({ text: r.text, embedding: r.embedding! })));
        if (i + BATCH_SIZE < texts.length) {
          await new Promise((r) => setTimeout(r, 200));
        }
        continue;
      }
    }

    // 3. n-gram fingerprint (always works, fully offline)
    results.push(...batch.map((text) => ({ text, embedding: ngramFingerprint(text, EMBEDDING_DIMENSIONS) })));
  }

  return results;
}

// ─── Store Chunks with Embeddings ───────────────────────

export async function storeChunkEmbeddings(
  chapterId: string,
  chunks: { chunkIndex: number; content: string; tokenCount: number; bloomLevel?: string }[],
  embeddings: number[][]
): Promise<number> {
  if (chunks.length !== embeddings.length) {
    throw new Error("Chunks and embeddings arrays must have the same length");
  }

  // Delete existing chunks for this chapter (use raw SQL since model has Unsupported vector type)
  await db.$executeRawUnsafe(
    `DELETE FROM content_chunks WHERE "chapterId" = $1`,
    chapterId
  );

  let stored = 0;

  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i];
    const embedding = embeddings[i];
    const vectorStr = `[${embedding.join(",")}]`;

    try {
      // Use raw SQL to insert with vector type
      await db.$executeRawUnsafe(
        `INSERT INTO content_chunks (id, "chapterId", "chunkIndex", content, "tokenCount", "bloomLevel", embedding, "createdAt")
         VALUES ($1, $2, $3, $4, $5, $6, $7::vector, NOW())`,
        `chunk_${chapterId}_${chunk.chunkIndex}`,
        chapterId,
        chunk.chunkIndex,
        chunk.content,
        chunk.tokenCount,
        chunk.bloomLevel || null,
        vectorStr
      );
      stored++;
    } catch (error) {
      console.error(
        `[Embeddings] Failed to store chunk ${chunk.chunkIndex}:`,
        error
      );
      // Fallback: store without embedding (pgvector might not be enabled)
      try {
        await db.$executeRawUnsafe(
          `INSERT INTO content_chunks (id, "chapterId", "chunkIndex", content, "tokenCount", "bloomLevel", "createdAt")
           VALUES ($1, $2, $3, $4, $5, $6, NOW())`,
          `chunk_${chapterId}_${chunk.chunkIndex}`,
          chapterId,
          chunk.chunkIndex,
          chunk.content,
          chunk.tokenCount,
          chunk.bloomLevel || null
        );
        stored++;
      } catch (err2) {
        console.error(
          `[Embeddings] Fallback insert also failed for chunk ${chunk.chunkIndex}:`,
          err2
        );
      }
    }
  }

  return stored;
}

// ─── Semantic Search (cosine similarity via pgvector) ──

export async function semanticSearch(
  query: string,
  options: {
    chapterId?: string;
    textbookId?: string;
    limit?: number;
  } = {}
): Promise<SemanticSearchResult[]> {
  const { chapterId, textbookId, limit = 5 } = options;

  // Generate embedding for the query
  const queryEmbedding = await generateEmbedding(query);
  const vectorStr = `[${queryEmbedding.join(",")}]`;

  try {
    let results: SemanticSearchResult[];

    if (chapterId) {
      results = await db.$queryRawUnsafe(
        `SELECT cc.id, cc."chapterId", cc."chunkIndex", cc.content, cc."bloomLevel",
                1 - (cc.embedding <=> $1::vector) AS similarity
         FROM content_chunks cc
         WHERE cc."chapterId" = $2
           AND cc.embedding IS NOT NULL
         ORDER BY cc.embedding <=> $1::vector
         LIMIT $3`,
        vectorStr,
        chapterId,
        limit
      );
    } else if (textbookId) {
      results = await db.$queryRawUnsafe(
        `SELECT cc.id, cc."chapterId", cc."chunkIndex", cc.content, cc."bloomLevel",
                1 - (cc.embedding <=> $1::vector) AS similarity
         FROM content_chunks cc
         JOIN chapters ch ON ch.id = cc."chapterId"
         WHERE ch."textbookId" = $2
           AND cc.embedding IS NOT NULL
         ORDER BY cc.embedding <=> $1::vector
         LIMIT $3`,
        vectorStr,
        textbookId,
        limit
      );
    } else {
      results = await db.$queryRawUnsafe(
        `SELECT cc.id, cc."chapterId", cc."chunkIndex", cc.content, cc."bloomLevel",
                1 - (cc.embedding <=> $1::vector) AS similarity
         FROM content_chunks cc
         WHERE cc.embedding IS NOT NULL
         ORDER BY cc.embedding <=> $1::vector
         LIMIT $2`,
        vectorStr,
        limit
      );
    }

    return results;
  } catch (error) {
    console.error("[Embeddings] Semantic search failed:", error);
    // pgvector might not be enabled — return empty results
    return [];
  }
}

// ─── Cosine Similarity (in-memory, for quality checks) ─

export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) return 0;

  let dotProduct = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }

  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom === 0 ? 0 : dotProduct / denom;
}

// ─── Check if pgvector is available ────────────────────

export async function isPgvectorAvailable(): Promise<boolean> {
  try {
    const result: { exists: boolean }[] = await db.$queryRaw`
      SELECT EXISTS (
        SELECT 1 FROM pg_extension WHERE extname = 'vector'
      ) AS exists
    `;
    return result[0]?.exists ?? false;
  } catch {
    return false;
  }
}

// ─── Enable pgvector extension ─────────────────────────

export async function enablePgvector(): Promise<boolean> {
  try {
    await db.$executeRawUnsafe(
      `CREATE EXTENSION IF NOT EXISTS vector`
    );
    // Create HNSW index if not exists
    await db.$executeRawUnsafe(
      `CREATE INDEX IF NOT EXISTS content_chunks_embedding_idx
       ON content_chunks USING hnsw (embedding vector_cosine_ops)`
    );
    return true;
  } catch (error) {
    console.error("[Embeddings] Failed to enable pgvector:", error);
    return false;
  }
}
