/**
 * Embedding Generation & Vector DB Operations — §4.4.2
 *
 * Uses Gemini gemini-embedding-001 for embedding generation
 * and pgvector for storage and semantic similarity search.
 */

import { GoogleGenerativeAI } from "@google/generative-ai";
import { db } from "./db";

// ─── Constants ──────────────────────────────────────────

const EMBEDDING_MODEL = "gemini-embedding-001";
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

// ─── Self-healing: Auto-fix vector column dimension ─────
// The production DB may have been provisioned with vector(1024) (from the
// original Ollama BGE-M3 setup) while Gemini embedding-001 outputs 768 dims.
// Rather than requiring a manual ALTER TABLE, we detect the mismatch once per
// process and rebuild the column automatically on the next embedding store.

let vectorColumnVerified = false;

async function ensureCorrectVectorDimension(): Promise<void> {
  if (vectorColumnVerified) return;
  try {
    // pg_catalog.format_type returns e.g. "vector(1024)" for pgvector columns
    const rows: { type_name: string }[] = await db.$queryRaw`
      SELECT pg_catalog.format_type(a.atttypid, a.atttypmod) AS type_name
      FROM   pg_attribute a
      JOIN   pg_class     c ON c.oid = a.attrelid
      WHERE  c.relname = 'content_chunks'
        AND  a.attname = 'embedding'
        AND  a.attnum  > 0
      LIMIT 1
    `;

    const actualType   = rows[0]?.type_name ?? "";
    const expectedType = `vector(${EMBEDDING_DIMENSIONS})`;

    if (actualType && actualType !== expectedType) {
      console.warn(
        `[Embeddings] Vector column dimension mismatch: DB has ${actualType}, ` +
        `code expects ${expectedType}. Rebuilding column (existing embeddings cleared)…`
      );
      // Drop index first — required before altering the column
      await db.$executeRawUnsafe(
        `DROP INDEX IF EXISTS content_chunks_embedding_idx`
      );
      await db.$executeRawUnsafe(
        `ALTER TABLE content_chunks DROP COLUMN IF EXISTS embedding`
      );
      await db.$executeRawUnsafe(
        `ALTER TABLE content_chunks ADD COLUMN embedding vector(${EMBEDDING_DIMENSIONS})`
      );
      // Recreate HNSW index for cosine similarity search
      await db.$executeRawUnsafe(
        `CREATE INDEX IF NOT EXISTS content_chunks_embedding_idx
         ON content_chunks USING hnsw (embedding vector_cosine_ops)`
      );
      console.info(
        `[Embeddings] Vector column rebuilt as ${expectedType}. ` +
        `Re-upload textbooks to regenerate embeddings.`
      );
    }

    vectorColumnVerified = true;
  } catch (err) {
    // Non-fatal: log and continue — the insert will surface the real error if needed
    console.warn("[Embeddings] Could not verify vector column dimension:", err);
  }
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

// ─── Provider priority ───────────────────────────────────
// Production: no Ollama → Gemini is primary.
// Local dev:  set OLLAMA_BASE_URL to restore Ollama as primary.
// Override:   set EMBEDDING_PROVIDER=gemini|ollama|auto (default: auto)
const EMBEDDING_PROVIDER = process.env.EMBEDDING_PROVIDER ?? "auto";
const ollamaEnabled =
  EMBEDDING_PROVIDER === "ollama" ||
  (EMBEDDING_PROVIDER === "auto" &&
    !!process.env.OLLAMA_BASE_URL &&
    process.env.OLLAMA_BASE_URL !== "http://localhost:11434");

// ─── Runtime capability flags ────────────────────────────
// Try each provider once per process and cache the result to avoid
// spamming logs or wasting time on known-unavailable providers.
let geminiEmbeddingsAvailable: boolean | null = null;
let ollamaEmbeddingsAvailable: boolean | null = ollamaEnabled ? null : false;

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

    const values = result.embedding.values;

    // gemini-embedding-001 defaults to 3072 dimensions. Slice to
    // EMBEDDING_DIMENSIONS (768) and re-normalise. This is safe because Gemini
    // uses Matryoshka Representation Learning — the first N dimensions are
    // always a complete, meaningful embedding at that smaller size.
    if (values.length > EMBEDDING_DIMENSIONS) {
      const sliced = values.slice(0, EMBEDDING_DIMENSIONS);
      const norm = Math.sqrt(sliced.reduce((s, v) => s + v * v, 0)) || 1;
      return sliced.map((v) => v / norm);
    }

    return values;
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
// re-normalise. Same Matryoshka truncation strategy used for Gemini above.
async function tryOllamaEmbeddings(texts: string[]): Promise<number[][] | null> {
  if (ollamaEmbeddingsAvailable === false) return null;
  try {
    const response = await fetch(`${OLLAMA_BASE_URL}/api/embed`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: OLLAMA_EMBEDDING_MODEL, input: texts }),
      signal: AbortSignal.timeout(5_000), // fail fast if Ollama is unreachable
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
  // Gemini first (available in all environments with GEMINI_API_KEY)
  const gemini = await tryGeminiEmbedding(text);
  if (gemini) return gemini;

  // Ollama second (local dev only, skipped in production unless OLLAMA_BASE_URL set)
  const ollama = await tryOllamaEmbeddings([text]);
  if (ollama) return ollama[0];

  return ngramFingerprint(text, EMBEDDING_DIMENSIONS);
}

// ─── Batch Embeddings ───────────────────────────────────
// Priority: Gemini (primary, all environments) → Ollama BGE-M3 (local dev only)
// → n-gram fingerprint (fully offline fallback).

export async function generateEmbeddings(
  texts: string[]
): Promise<EmbeddingResult[]> {
  if (texts.length === 0) return [];

  const results: EmbeddingResult[] = [];

  for (let i = 0; i < texts.length; i += BATCH_SIZE) {
    const batch = texts.slice(i, i + BATCH_SIZE);

    // 1. Gemini — primary in all environments (uses GEMINI_API_KEY)
    if (geminiEmbeddingsAvailable !== false) {
      const geminiResults = await Promise.all(
        batch.map(async (text) => ({ text, embedding: await tryGeminiEmbedding(text) }))
      );

      if (geminiResults.every((r) => r.embedding !== null)) {
        results.push(...geminiResults.map((r) => ({ text: r.text, embedding: r.embedding! })));
        if (i + BATCH_SIZE < texts.length) {
          await new Promise((r) => setTimeout(r, 200)); // respect rate limits between batches
        }
        continue;
      }
    }

    // 2. Ollama BGE-M3 — local dev fallback (skipped in production unless OLLAMA_BASE_URL set)
    const ollamaResults = await tryOllamaEmbeddings(batch);
    if (ollamaResults) {
      results.push(...batch.map((text, j) => ({ text, embedding: ollamaResults[j] })));
      continue;
    }

    // 3. n-gram fingerprint — always works, fully offline, zero cost
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

  // Ensure the vector column has the correct dimension before inserting.
  // Fixes the case where the DB was provisioned with vector(1024) (Ollama/BGE-M3)
  // but Gemini embedding-001 produces 768-dim vectors.
  await ensureCorrectVectorDimension();

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
    await db.$executeRawUnsafe(`CREATE EXTENSION IF NOT EXISTS vector`);

    // Fix dimension mismatch if the column was created with a different size
    // (e.g. originally set up with Ollama BGE-M3 → vector(1024))
    await ensureCorrectVectorDimension();

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
