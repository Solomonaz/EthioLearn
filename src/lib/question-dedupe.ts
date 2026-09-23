/**
 * Keeping repeated generation from producing repeated questions.
 *
 * Benchmarked 2026-09-23 (3 rounds x 5 questions on the same chapter, three
 * models): a reworded repeat of an earlier question is by far the common case —
 * 18 of 19 repeats were NOT word-for-word copies, so the old exact-text check
 * caught 1. Three layers now work together:
 *
 *   1. Content rotation (lib/generation-content) — each run reads a different
 *      part of the chapter; `generationRunIndex` below supplies the run number.
 *   2. An avoid list in the prompt (`avoidList`) — the model is told what the
 *      chapter already has, so it does not spend a call re-asking it.
 *   3. A semantic check after generation (`findNearDuplicates`) — anything that
 *      still slips through is caught at the calibrated 0.90 similarity.
 */

import { db } from "./db";
import { generateEmbeddings, cosineSimilarity } from "./embeddings";
import { SIMILAR, judgeRepeat, questionFacts, type QuestionLike } from "./question-similarity";

/** How many existing questions are listed in the prompt. ~40 tokens each. */
export const AVOID_LIST_SIZE = 30;
/** Stems are trimmed to this length in the avoid list — enough to identify the question. */
const AVOID_STEM_CHARS = 160;
/** How many saved questions a new batch is compared against (newest first). */
export const DEDUPE_COMPARE_LIMIT = 300;

/**
 * The chapter's saved questions, newest first — the comparison set for the
 * semantic check and the source of the avoid list.
 */
export async function recentChapterQuestions(
  chapterId: string,
  take = DEDUPE_COMPARE_LIMIT
): Promise<{ id: string; questionText: string; correctAnswer: string; status: string; type: string; difficulty: string }[]> {
  return db.question.findMany({
    where: { chapterId },
    select: { id: true, questionText: true, correctAnswer: true, status: true, type: true, difficulty: true },
    orderBy: { createdAt: "desc" },
    take,
  });
}

/** The newest question stems, trimmed, for the prompt's "already asked" list. */
export function avoidList(existingTexts: string[], size = AVOID_LIST_SIZE): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of existingTexts) {
    const t = raw.replace(/\s+/g, " ").trim();
    if (!t || seen.has(t)) continue;
    seen.add(t);
    out.push(t.length > AVOID_STEM_CHARS ? `${t.slice(0, AVOID_STEM_CHARS)}…` : t);
    if (out.length >= size) break;
  }
  return out;
}

/**
 * How many times this chapter has been generated for — the number of distinct
 * minutes in which its questions were created. A run saves its questions in one
 * go, so each run is one bucket.
 *
 * The chapter's question COUNT used to drive content rotation, but the count
 * advances by the batch size: with 26 chunks sampled every 2nd one, a count of
 * 0, 10, 20 … is always even and picked the same half of the chapter on every
 * run, and every model then repeated itself. A run number advances by exactly 1.
 */
export async function generationRunIndex(chapterId: string): Promise<number> {
  try {
    const rows = await db.$queryRaw<{ runs: bigint }[]>`
      SELECT COUNT(DISTINCT date_trunc('minute', "createdAt")) AS runs
      FROM questions
      WHERE "chapterId" = ${chapterId}
    `;
    return Number(rows[0]?.runs ?? 0);
  } catch {
    return 0;
  }
}

export interface DuplicateHit {
  /** Index into `existing` of the matched saved question, or null for an in-batch repeat. */
  existingIndex: number | null;
  /** Index into `candidates` of the earlier candidate it repeats, for in-batch repeats. */
  candidateIndex: number | null;
  similarity: number;
}

function normalise(t: string): string {
  return t.replace(/\s+/g, " ").trim().toLowerCase();
}

/**
 * Which candidates repeat a saved question or an earlier candidate.
 *
 * Exact (whitespace/case-insensitive) matches are always caught. Semantic
 * matches use gemini-embedding-001 similarity combined with the numbers and the
 * correct answer (see lib/question-similarity) — similar WORDING alone is not a
 * repeat. If the vectors did not all come from Gemini — a fallback provider has
 * a different similarity scale — only exact matches are reported rather than
 * guessing. Never throws: a failure degrades to the exact check.
 */
export async function findNearDuplicates(
  candidateInput: (string | QuestionLike)[],
  existingInput: (string | QuestionLike)[],
  /** Embedding source; injectable for tests. */
  embed: typeof generateEmbeddings = generateEmbeddings
): Promise<Map<number, DuplicateHit>> {
  const hits = new Map<number, DuplicateHit>();
  const asQ = (x: string | QuestionLike): QuestionLike => (typeof x === "string" ? { questionText: x } : x);
  const candidateQs = candidateInput.map(asQ);
  const existingQs = existingInput.map(asQ);
  const candidates = candidateQs.map((q) => q.questionText);
  const existing = existingQs.map((q) => q.questionText);
  const candFacts = candidateQs.map((q) => questionFacts(q));
  const existFacts = existingQs.map((q) => questionFacts(q));

  // 1. Exact matches — cheap and certain.
  const existingByText = new Map<string, number>();
  existing.forEach((t, i) => {
    const k = normalise(t);
    if (!existingByText.has(k)) existingByText.set(k, i);
  });
  const seenCandidate = new Map<string, number>();
  candidates.forEach((t, i) => {
    const k = normalise(t);
    const e = existingByText.get(k);
    if (e !== undefined) hits.set(i, { existingIndex: e, candidateIndex: null, similarity: 1 });
    else if (seenCandidate.has(k)) hits.set(i, { existingIndex: null, candidateIndex: seenCandidate.get(k)!, similarity: 1 });
    else seenCandidate.set(k, i);
  });

  // 2. Semantic matches.
  if (candidates.length === 0) return hits;
  try {
    const results = await embed([...candidates, ...existing], "RETRIEVAL_DOCUMENT", {
      feature: "embedding-dedup",
    });
    if (results.length !== candidates.length + existing.length) return hits;
    if (!results.every((r) => r.provider === "gemini")) {
      console.warn("[Dedupe] Embeddings did not come from Gemini — using exact-text matching only.");
      return hits;
    }
    const cand = results.slice(0, candidates.length).map((r) => r.embedding);
    const exist = results.slice(candidates.length).map((r) => r.embedding);

    for (let i = 0; i < cand.length; i++) {
      if (hits.has(i)) continue;
      // Against saved questions: most similar first, first judged a repeat wins.
      const close = exist
        .map((e, j) => ({ j, sim: cosineSimilarity(cand[i], e) }))
        .filter((x) => x.sim >= SIMILAR)
        .sort((a, b) => b.sim - a.sim);
      const savedHit = close.find((x) => judgeRepeat(x.sim, candFacts[i], existFacts[x.j]).repeat);
      if (savedHit) {
        hits.set(i, { existingIndex: savedHit.j, candidateIndex: null, similarity: savedHit.sim });
        continue;
      }
      // Against earlier candidates that are themselves being kept.
      for (let k = 0; k < i; k++) {
        if (hits.has(k)) continue;
        const sim = cosineSimilarity(cand[i], cand[k]);
        if (sim >= SIMILAR && judgeRepeat(sim, candFacts[i], candFacts[k]).repeat) {
          hits.set(i, { existingIndex: null, candidateIndex: k, similarity: sim });
          break;
        }
      }
    }
  } catch (err) {
    console.warn(
      `[Dedupe] Semantic check unavailable, using exact-text matching only: ${err instanceof Error ? err.message : String(err)}`
    );
  }
  return hits;
}
