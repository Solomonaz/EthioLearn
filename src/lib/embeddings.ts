/**
 * Embedding Generation & Vector DB Operations — §4.4.2
 *
 * Uses Gemini gemini-embedding-001 for embedding generation
 * and pgvector for storage and semantic similarity search.
 */

import { GoogleGenerativeAI } from "@google/generative-ai";
import { db } from "./db";
import { isOllamaEnabled } from "./ollama";
import { estimateTokens } from "./content-chunker";
import { logUsage, type UsageActor, type UsageFeature } from "./usage-logger";

// ─── Constants ──────────────────────────────────────────

const EMBEDDING_MODEL = "gemini-embedding-001";
const EMBEDDING_DIMENSIONS = 768;
const BATCH_SIZE = 50; // Gemini supports up to 100, use 50 for safety

// Gemini's REST batch endpoint. The typed SDK exposes `batchEmbedContents` but
// its EmbedContentRequest has no `outputDimensionality`, so we call REST
// directly: one HTTP request per BATCH_SIZE chunks, asking for exactly the
// dimensions we store instead of fetching 3072 and throwing 75% away.
const GEMINI_API_BASE = "https://generativelanguage.googleapis.com/v1beta";

// Transient-failure retry. A single 429 mid-upload must NOT permanently demote
// the provider for the rest of the process — that used to silently switch a
// whole textbook over to the non-semantic fingerprint fallback.
const MAX_EMBED_ATTEMPTS = 4;
const RETRY_BASE_DELAY_MS = 500;

/**
 * Fingerprint vectors are a last-resort offline stand-in, not embeddings. In
 * production, storing them corrupts retrieval silently, so they are refused
 * unless explicitly allowed. Set ALLOW_FINGERPRINT_EMBEDDINGS=true to permit.
 */
const ALLOW_FINGERPRINT =
  process.env.ALLOW_FINGERPRINT_EMBEDDINGS === "true" ||
  process.env.NODE_ENV !== "production";

/** Which system produced a vector. Vectors from different sources are NOT comparable. */
export type EmbeddingProvider = "gemini" | "ollama" | "fingerprint";

export class EmbeddingUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EmbeddingUnavailableError";
  }
}

// ─── Ollama config ───────────────────────────────────────
const OLLAMA_BASE_URL = process.env.OLLAMA_BASE_URL ?? "http://localhost:11434";
const OLLAMA_EMBEDDING_MODEL = "bge-m3";

/** Identifier stored in ContentChunk.embeddingModel, for provenance. */
const PROVIDER_MODEL_ID: Record<EmbeddingProvider, string> = {
  gemini: EMBEDDING_MODEL,
  ollama: OLLAMA_EMBEDDING_MODEL,
  fingerprint: "ngram-fingerprint-v1",
};

// ─── Types ──────────────────────────────────────────────

export interface EmbeddingResult {
  text: string;
  embedding: number[];
  /** Which system produced this vector — persisted for provenance. */
  provider: EmbeddingProvider;
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

// Arbitrary but fixed key for the advisory lock guarding the column rebuild.
// Any process attempting the rebuild takes this lock first, so the destructive
// DDL can never run concurrently across requests or instances.
const VECTOR_REBUILD_LOCK_KEY = 992_017;

async function ensureCorrectVectorDimension(): Promise<void> {
  if (vectorColumnVerified) return;
  try {
    const expectedType = `vector(${EMBEDDING_DIMENSIONS})`;

    // Run the whole check-and-rebuild inside ONE transaction holding a
    // transaction-scoped advisory lock. Concurrent callers block on the lock,
    // then re-read the type after acquiring it and find it already correct —
    // so the destructive DROP COLUMN runs at most once, never as a race.
    await db.$transaction(async (tx) => {
      // pg_advisory_xact_lock auto-releases when the transaction ends.
      await tx.$executeRawUnsafe(`SELECT pg_advisory_xact_lock(${VECTOR_REBUILD_LOCK_KEY})`);

      // pg_catalog.format_type returns e.g. "vector(1024)" for pgvector columns
      const rows: { type_name: string }[] = await tx.$queryRawUnsafe(
        `SELECT pg_catalog.format_type(a.atttypid, a.atttypmod) AS type_name
         FROM   pg_attribute a
         JOIN   pg_class     c ON c.oid = a.attrelid
         WHERE  c.relname = 'content_chunks'
           AND  a.attname = 'embedding'
           AND  a.attnum  > 0
         LIMIT 1`
      );

      const actualType = rows[0]?.type_name ?? "";

      // Only rebuild on a genuine, non-empty mismatch (double-checked under lock).
      if (actualType && actualType !== expectedType) {
        // This rebuild DROPS the column — every embedding in the database is
        // destroyed and the whole corpus must be re-embedded (which costs real
        // API spend). Automatic in dev; in production it requires an explicit
        // opt-in so a stray EMBEDDING_DIMENSIONS edit can't wipe the corpus on
        // the next deploy.
        const rebuildAllowed =
          process.env.NODE_ENV !== "production" ||
          process.env.ALLOW_VECTOR_COLUMN_REBUILD === "true";

        if (!rebuildAllowed) {
          console.error(
            `[Embeddings] REFUSING automatic vector column rebuild: DB has ${actualType}, ` +
            `code expects ${expectedType}. Dropping the column would destroy every stored ` +
            `embedding. Set ALLOW_VECTOR_COLUMN_REBUILD=true to permit it, then re-process ` +
            `all textbooks.`
          );
          return;
        }

        console.warn(
          `[Embeddings] Vector column dimension mismatch: DB has ${actualType}, ` +
          `code expects ${expectedType}. Rebuilding column (existing embeddings cleared)…`
        );
        // Drop index first — required before altering the column
        await tx.$executeRawUnsafe(`DROP INDEX IF EXISTS content_chunks_embedding_idx`);
        await tx.$executeRawUnsafe(`ALTER TABLE content_chunks DROP COLUMN IF EXISTS embedding`);
        await tx.$executeRawUnsafe(
          `ALTER TABLE content_chunks ADD COLUMN embedding vector(${EMBEDDING_DIMENSIONS})`
        );
        // Recreate HNSW index for cosine similarity search
        await tx.$executeRawUnsafe(
          `CREATE INDEX IF NOT EXISTS content_chunks_embedding_idx
           ON content_chunks USING hnsw (embedding vector_cosine_ops)`
        );
        console.info(
          `[Embeddings] Vector column rebuilt as ${expectedType}. ` +
          `Re-upload textbooks to regenerate embeddings.`
        );
      }
    });

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
// Local dev:  set OLLAMA_ENABLED=true to use local bge-m3 embeddings.
// Override:   set EMBEDDING_PROVIDER=gemini|ollama|auto (default: auto)
// "ollama" forces it on; "auto" defers to the shared guard in lib/ollama.
const EMBEDDING_PROVIDER = process.env.EMBEDDING_PROVIDER ?? "auto";
const ollamaEnabled =
  EMBEDDING_PROVIDER === "ollama" ||
  (EMBEDDING_PROVIDER === "auto" && isOllamaEnabled());

// ─── Runtime capability flags ────────────────────────────
// Try each provider once per process and cache the result to avoid
// spamming logs or wasting time on known-unavailable providers.
let geminiEmbeddingsAvailable: boolean | null = null;
let ollamaEmbeddingsAvailable: boolean | null = ollamaEnabled ? null : false;

function l2normalise(values: number[]): number[] {
  const norm = Math.sqrt(values.reduce((s, v) => s + v * v, 0)) || 1;
  return values.map((v) => v / norm);
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Embed a whole batch of texts in ONE Gemini request.
 *
 * This used to issue one HTTP call per text (50 parallel calls per "batch"),
 * which multiplied request count by ~50 and was the main driver of rate-limit
 * 429s on large textbooks. `:batchEmbedContents` takes the whole batch at once.
 *
 * `taskType` matters for quality: retrieval is asymmetric, so stored passages
 * must be embedded as RETRIEVAL_DOCUMENT and the search string as
 * RETRIEVAL_QUERY. Neither was previously set, which measurably weakens recall.
 *
 * Returns null only after exhausting retries — transient failures are retried
 * with exponential backoff rather than permanently demoting the provider.
 */
async function tryGeminiEmbeddings(
  texts: string[],
  taskType: "RETRIEVAL_DOCUMENT" | "RETRIEVAL_QUERY" = "RETRIEVAL_DOCUMENT"
): Promise<number[][] | null> {
  if (geminiEmbeddingsAvailable === false) return null;

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    geminiEmbeddingsAvailable = false;
    return null;
  }

  const body = JSON.stringify({
    requests: texts.map((text) => ({
      model: `models/${EMBEDDING_MODEL}`,
      content: { parts: [{ text }] },
      taskType,
      outputDimensionality: EMBEDDING_DIMENSIONS,
    })),
  });

  let lastError = "";

  for (let attempt = 1; attempt <= MAX_EMBED_ATTEMPTS; attempt++) {
    try {
      const response = await fetch(
        `${GEMINI_API_BASE}/models/${EMBEDDING_MODEL}:batchEmbedContents?key=${apiKey}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body,
          signal: AbortSignal.timeout(60_000),
        }
      );

      if (response.ok) {
        const data = (await response.json()) as { embeddings?: { values: number[] }[] };
        const embeddings = data.embeddings;

        if (Array.isArray(embeddings) && embeddings.length === texts.length) {
          geminiEmbeddingsAvailable = true;
          // outputDimensionality is honoured server-side; slice defensively in
          // case the API returns the full 3072. Truncation is valid here —
          // gemini-embedding-001 uses Matryoshka Representation Learning, so
          // the leading N dimensions are a complete embedding on their own —
          // but it must be re-normalised afterwards.
          return embeddings.map((e) =>
            l2normalise(
              e.values.length > EMBEDDING_DIMENSIONS
                ? e.values.slice(0, EMBEDDING_DIMENSIONS)
                : e.values
            )
          );
        }

        lastError = `malformed response (expected ${texts.length} embeddings, got ${embeddings?.length ?? 0})`;
      } else {
        lastError = `HTTP ${response.status}`;
        // 4xx other than 429 is a request problem — retrying won't help.
        if (response.status !== 429 && response.status < 500) break;
      }
    } catch (err) {
      lastError = err instanceof Error ? err.message : "unknown error";
    }

    if (attempt < MAX_EMBED_ATTEMPTS) {
      const delay = RETRY_BASE_DELAY_MS * 2 ** (attempt - 1);
      console.warn(
        `[Embeddings] Gemini batch failed (${lastError}) — retry ${attempt}/${MAX_EMBED_ATTEMPTS - 1} in ${delay}ms`
      );
      await sleep(delay);
    }
  }

  console.warn(
    `[Embeddings] Gemini embedding unavailable after ${MAX_EMBED_ATTEMPTS} attempts (${lastError}).`
  );
  // NOTE: deliberately does NOT latch geminiEmbeddingsAvailable=false here.
  // A rate-limit burst on one batch must not silently downgrade every later
  // chunk in the book to a non-semantic fallback.
  return null;
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

// ─── Usage Accounting ───────────────────────────────────

/** The subset of usage features that embedding call sites may report as. */
export type EmbeddingFeature = Extract<UsageFeature, `embedding-${string}`>;

/**
 * Where an embedding call came from, so its spend lands on a feature (and, for
 * student-triggered work, on a student and a school) instead of vanishing.
 *
 * Optional throughout: a call site that passes nothing is simply not metered,
 * which keeps this from becoming a required argument on every internal helper.
 */
export interface EmbeddingUsageContext {
  feature: EmbeddingFeature;
  actor?: UsageActor;
}

/** The model id each provider should be billed under. */
const PROVIDER_MODEL: Record<EmbeddingProvider, string> = {
  gemini: EMBEDDING_MODEL,
  ollama: OLLAMA_EMBEDDING_MODEL,
  fingerprint: "fingerprint",
};

/**
 * Record one embedding call.
 *
 * IMPORTANT — these token counts are ESTIMATED, not provider-reported.
 * `:batchEmbedContents` returns only `{ embeddings: [...] }`; there is no
 * `usageMetadata` on an embedding response, and asking `:countTokens` for a
 * true count would double the request volume for a number worth fractions of a
 * cent. `estimateTokens` is the same estimator the chunker sizes chunks with,
 * so the figure is consistent with `content_chunks.tokenCount`.
 *
 * An embedding response is a vector, not text, so there are no output or
 * thinking tokens: total equals prompt, and `costUsd` bills the input side
 * only.
 */
function logEmbeddingUsage(
  texts: string[],
  provider: EmbeddingProvider,
  ctx: EmbeddingUsageContext | undefined
): void {
  if (!ctx || texts.length === 0) return;
  const promptTokens = texts.reduce((n, t) => n + estimateTokens(t), 0);
  logUsage({
    feature: ctx.feature,
    provider,
    model: PROVIDER_MODEL[provider],
    usage: {
      promptTokens,
      outputTokens: 0,
      thinkingTokens: 0,
      totalTokens: promptTokens,
    },
    actor: ctx.actor,
  });
}

// ─── Single Embedding ───────────────────────────────────

export async function generateEmbedding(
  text: string,
  taskType: "RETRIEVAL_DOCUMENT" | "RETRIEVAL_QUERY" = "RETRIEVAL_QUERY",
  usage?: EmbeddingUsageContext
): Promise<number[]> {
  // Gemini first (available in all environments with GEMINI_API_KEY)
  const gemini = await tryGeminiEmbeddings([text], taskType);
  if (gemini) {
    logEmbeddingUsage([text], "gemini", usage);
    return gemini[0];
  }

  // Ollama second (local dev only, skipped in production unless OLLAMA_BASE_URL set)
  const ollama = await tryOllamaEmbeddings([text]);
  if (ollama) {
    logEmbeddingUsage([text], "ollama", usage);
    return ollama[0];
  }

  // Logged too, at zero cost: a run that silently degraded to fingerprints is
  // exactly the thing you want visible in the usage breakdown.
  logEmbeddingUsage([text], "fingerprint", usage);
  return ngramFingerprint(text, EMBEDDING_DIMENSIONS);
}

// ─── Batch Embeddings ───────────────────────────────────
// Priority: Gemini (primary, all environments) → Ollama BGE-M3 (local dev only)
// → n-gram fingerprint (fully offline fallback).

export async function generateEmbeddings(
  texts: string[],
  taskType: "RETRIEVAL_DOCUMENT" | "RETRIEVAL_QUERY" = "RETRIEVAL_DOCUMENT",
  usage?: EmbeddingUsageContext
): Promise<EmbeddingResult[]> {
  if (texts.length === 0) return [];

  const results: EmbeddingResult[] = [];

  for (let i = 0; i < texts.length; i += BATCH_SIZE) {
    const batch = texts.slice(i, i + BATCH_SIZE);

    // 1. Gemini — ONE request for the whole batch (not one per text).
    const geminiResults = await tryGeminiEmbeddings(batch, taskType);
    if (geminiResults) {
      logEmbeddingUsage(batch, "gemini", usage);
      results.push(
        ...batch.map((text, j) => ({
          text,
          embedding: geminiResults[j],
          provider: "gemini" as const,
        }))
      );
      if (i + BATCH_SIZE < texts.length) await sleep(200); // be polite between batches
      continue;
    }

    // 2. Ollama BGE-M3 — local dev fallback (skipped in production unless OLLAMA_BASE_URL set)
    const ollamaResults = await tryOllamaEmbeddings(batch);
    if (ollamaResults) {
      logEmbeddingUsage(batch, "ollama", usage);
      results.push(
        ...batch.map((text, j) => ({
          text,
          embedding: ollamaResults[j],
          provider: "ollama" as const,
        }))
      );
      continue;
    }

    // 3. n-gram fingerprint — offline stand-in, NOT a semantic embedding.
    // Refused in production: silently persisting these makes the AI tutor's
    // retrieval near-random with nothing anywhere reporting a problem.
    if (!ALLOW_FINGERPRINT) {
      throw new EmbeddingUnavailableError(
        "No embedding provider is available (Gemini failed after retries, Ollama not configured). " +
          "Refusing to store non-semantic fingerprint vectors. Check GEMINI_API_KEY and quota, " +
          "then re-run processing. Set ALLOW_FINGERPRINT_EMBEDDINGS=true only for offline testing."
      );
    }

    console.warn(
      `[Embeddings] Falling back to n-gram fingerprints for ${batch.length} chunk(s) — ` +
        `these are NOT semantic and will be marked as such.`
    );
    logEmbeddingUsage(batch, "fingerprint", usage);
    results.push(
      ...batch.map((text) => ({
        text,
        embedding: ngramFingerprint(text, EMBEDDING_DIMENSIONS),
        provider: "fingerprint" as const,
      }))
    );
  }

  return results;
}

// ─── Store Chunks with Embeddings ───────────────────────

export async function storeChunkEmbeddings(
  chapterId: string,
  chunks: {
    chunkIndex: number;
    content: string;
    tokenCount: number;
    bloomLevel?: string;
    contentHash?: string;
  }[],
  embeddings: number[][],
  providers?: EmbeddingProvider[]
): Promise<number> {
  if (chunks.length !== embeddings.length) {
    throw new Error("Chunks and embeddings arrays must have the same length");
  }
  if (chunks.length === 0) return 0;

  // Ensure the vector column has the correct dimension before inserting.
  // Fixes the case where the DB was provisioned with vector(1024) (Ollama/BGE-M3)
  // but Gemini embedding-001 produces 768-dim vectors.
  await ensureCorrectVectorDimension();

  // Delete existing chunks for this chapter (use raw SQL since model has Unsupported vector type)
  await db.$executeRawUnsafe(
    `DELETE FROM content_chunks WHERE "chapterId" = $1`,
    chapterId
  );

  // ── Single multi-row INSERT ───────────────────────────────────────────────
  // Previously one round trip per chunk — 600 sequential inserts for a large
  // textbook. Building one statement keeps it to a single round trip.
  //
  // There is deliberately NO "insert without the embedding" fallback any more.
  // That path wrote rows whose embedding was NULL, which semanticSearch filters
  // out — so the content became permanently invisible to the AI tutor while the
  // pipeline still reported success. A failure here now propagates, the
  // textbook is marked FAILED, and the admin can retry.
  const columns = 8;
  const values: unknown[] = [];
  const rows: string[] = [];

  chunks.forEach((chunk, i) => {
    const base = i * columns;
    rows.push(
      `($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5}, $${base + 6}, $${base + 7}::vector, $${base + 8}, NOW())`
    );
    values.push(
      `chunk_${chapterId}_${chunk.chunkIndex}`,
      chapterId,
      chunk.chunkIndex,
      chunk.content,
      chunk.tokenCount,
      chunk.bloomLevel || null,
      `[${embeddings[i].join(",")}]`,
      PROVIDER_MODEL_ID[providers?.[i] ?? "gemini"]
    );
  });

  await db.$executeRawUnsafe(
    `INSERT INTO content_chunks
       (id, "chapterId", "chunkIndex", content, "tokenCount", "bloomLevel", embedding, "embeddingModel", "createdAt")
     VALUES ${rows.join(", ")}`,
    ...values
  );

  return chunks.length;
}

/**
 * Chunks in a chapter whose embeddings came from the non-semantic fingerprint
 * fallback, or from a model other than the current one. Lets the admin UI show
 * "this book needs re-embedding" instead of silently serving bad retrieval.
 */
export async function countStaleEmbeddings(textbookId: string): Promise<number> {
  try {
    const rows: { count: bigint }[] = await db.$queryRawUnsafe(
      `SELECT COUNT(*)::bigint AS count
       FROM content_chunks cc
       JOIN chapters ch ON ch.id = cc."chapterId"
       WHERE ch."textbookId" = $1
         AND (cc."embeddingModel" IS DISTINCT FROM $2 OR cc.embedding IS NULL)`,
      textbookId,
      EMBEDDING_MODEL
    );
    return Number(rows[0]?.count ?? 0);
  } catch {
    return 0;
  }
}

// ─── Semantic Search (cosine similarity via pgvector) ──

export async function semanticSearch(
  query: string,
  options: {
    chapterId?: string;
    textbookId?: string;
    limit?: number;
    /** Who this search is for, so the query embedding is attributable. */
    usage?: EmbeddingUsageContext;
  } = {}
): Promise<SemanticSearchResult[]> {
  const { chapterId, textbookId, limit = 5, usage } = options;

  // Generate embedding for the query
  const queryEmbedding = await generateEmbedding(query, "RETRIEVAL_QUERY", usage);
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
