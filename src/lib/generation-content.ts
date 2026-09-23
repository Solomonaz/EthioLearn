/**
 * Content selection for AI question generation.
 *
 * The prompt builders cap chapter content at QUESTION_CONTENT_CHARS (30,000).
 * Previously callers passed the raw chapter text, so `slice(0, 30000)` always
 * handed the model the SAME opening section — for a chapter longer than about
 * fifteen pages, its back half never produced a single question, and repeated
 * generations kept re-mining the introduction.
 *
 * The chapter is already split into sentence-aligned chunks for retrieval, and
 * those chunks cover all of it. So instead of taking the first N characters,
 * spend the same budget on chunks spread evenly across the whole chapter. Cost
 * is unchanged — one call, same token budget — but the model now sees the
 * entire chapter's range rather than its first fifth.
 *
 * A rotation shifts which chunks are picked on each run, so generating
 * repeatedly sweeps different material instead of returning to the same place.
 */

import { db } from "./db";

/** Marks a gap between non-adjacent excerpts so the model doesn't read them as continuous. */
const ELISION = "\n\n[...]\n\n";

export interface SelectedContent {
  content: string;
  /** How the content was chosen — for logging and admin diagnostics. */
  strategy: "whole-chapter" | "stratified-chunks" | "raw-slice";
  /** Number of chunks sampled (stratified only). */
  chunksUsed: number;
  /** Total chunks available for the chapter. */
  chunksAvailable: number;
}

interface SelectOptions {
  chapterId: string | null;
  /** Raw chapter text, used when no chunks exist yet. */
  fallbackContent: string;
  /** Character budget — should match the prompt builder's limit. */
  budgetChars: number;
  /**
   * Which generation RUN this is for the chapter (0, 1, 2 …) — use
   * `generationRunIndex` from lib/question-dedupe. Successive runs read
   * different chunks until the whole chapter has been covered, then cycle.
   *
   * Must advance by 1 per run. It used to be the chapter's question count,
   * which advances by the batch size: with a stride of 2 (every 2nd chunk) any
   * even count picked the same half of the chapter, so runs at 0, 10, 20 …
   * questions all read identical text and every model repeated itself.
   */
  rotation?: number;
}

/**
 * Choose the content to generate questions from.
 *
 * Falls back to the plain leading slice whenever chunks aren't available, so a
 * chapter that has not been through the processing pipeline still works.
 */
export async function selectGenerationContent(
  opts: SelectOptions
): Promise<SelectedContent> {
  const { chapterId, fallbackContent, budgetChars, rotation = 0 } = opts;

  if (!chapterId) {
    return {
      content: fallbackContent.slice(0, budgetChars),
      strategy: "raw-slice",
      chunksUsed: 0,
      chunksAvailable: 0,
    };
  }

  let chunks: { content: string }[] = [];
  try {
    chunks = await db.$queryRawUnsafe<{ content: string }[]>(
      `SELECT content FROM content_chunks
       WHERE "chapterId" = $1
       ORDER BY "chunkIndex" ASC`,
      chapterId
    );
  } catch {
    // content_chunks may not exist yet — fall through to the raw slice.
  }

  if (chunks.length === 0) {
    return {
      content: fallbackContent.slice(0, budgetChars),
      strategy: "raw-slice",
      chunksUsed: 0,
      chunksAvailable: 0,
    };
  }

  // Whole chapter fits in the budget — no need to sample anything.
  const joined = chunks.map((c) => c.content).join("\n\n");
  if (joined.length <= budgetChars) {
    return {
      content: joined,
      strategy: "whole-chapter",
      chunksUsed: chunks.length,
      chunksAvailable: chunks.length,
    };
  }

  // ── Stratified sampling ──────────────────────────────────────────────────
  // Work out how many chunks fit, then step through the chapter at an even
  // stride so the excerpts span it end to end.
  //
  // Each run starts the same evenly-spaced walk one chunk further along. A
  // stride of s leaves ceil(s) distinct starting phases, and together those
  // phases visit every chunk — so ceil(s) consecutive runs cover the chapter.
  //
  // That only holds if every phase's picks actually FIT the budget. Sizing
  // `take` from the average chunk length did not guarantee it: in a chapter
  // with some large chunks the last pick of each phase overflowed and was cut,
  // and because it was always the same tail position, those chunks were never
  // read by any run. So `take` is the largest count for which every phase fits.
  const n = chunks.length;
  const sizes = chunks.map((c) => c.content.length);
  const picksFor = (take: number, offset: number): number[] => {
    const stride = n / take;
    const out = new Set<number>();
    for (let i = 0; i < take; i++) out.add((Math.floor(i * stride) + offset) % n);
    return [...out];
  };
  const costOf = (idx: number[]) =>
    idx.reduce((sum, i) => sum + sizes[i], 0) + ELISION.length * Math.max(0, idx.length - 1);

  const avgChunkChars = joined.length / n;
  let take = Math.min(
    Math.max(1, Math.floor(budgetChars / (avgChunkChars + ELISION.length))),
    n - 1
  );
  for (; take > 1; take--) {
    const phaseCount = Math.ceil(n / take);
    let fits = true;
    for (let p = 0; p < phaseCount && fits; p++) fits = costOf(picksFor(take, p)) <= budgetChars;
    if (fits) break;
  }
  const phases = Math.max(1, Math.ceil(n / take));
  const offset = Math.abs(Math.trunc(rotation)) % phases;

  const picked = new Set<number>(picksFor(take, offset));

  // Rounding collisions can leave us short — backfill with unused chunks so the
  // budget isn't wasted.
  for (let i = 0; picked.size < take && i < chunks.length; i++) {
    picked.add(i);
  }

  // Keep document order: questions read better when excerpts run front to back.
  const ordered = [...picked].sort((a, b) => a - b);

  const parts: string[] = [];
  let used = 0;
  for (const index of ordered) {
    const piece = chunks[index].content;
    const cost = piece.length + (parts.length > 0 ? ELISION.length : 0);
    if (used + cost > budgetChars) break;
    parts.push(piece);
    used += cost;
  }
  // A single chunk larger than the whole budget would otherwise yield no text.
  if (parts.length === 0 && ordered.length > 0) {
    parts.push(chunks[ordered[0]].content.slice(0, budgetChars));
  }

  return {
    content: parts.join(ELISION),
    strategy: "stratified-chunks",
    chunksUsed: parts.length,
    chunksAvailable: chunks.length,
  };
}
