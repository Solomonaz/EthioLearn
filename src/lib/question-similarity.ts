/**
 * When is a similar-looking question actually a REPEAT?
 *
 * A single embedding threshold (0.90 on the stem) flagged far too much: two
 * questions from one chapter share vocabulary and phrasing, so "similar
 * wording" is normal and fine. What makes a repeat is asking the SAME problem.
 * This combines the embedding score with two cheap, code-only facts:
 *
 *   - the NUMBERS in the stem — same wording with different numbers is a
 *     practice variant, not a repeat;
 *   - the CORRECT ANSWER — two conceptual questions that ask the same thing
 *     almost always have the same answer; ones that merely sound alike do not.
 *
 * Rules (first match wins):
 *   1. similarity >= NEAR_IDENTICAL                          -> repeat
 *   2. both stems contain numbers:
 *        similarity >= SIMILAR and number overlap >= NUMBER_OVERLAP -> repeat
 *        otherwise                                           -> different
 *   3. wording-only: similarity >= WORDING_ONLY and the same correct answer
 *      (or no answer known for one side)                     -> repeat
 *
 * Reference points from the 2026-09-10 calibration on this corpus
 * (gemini-embedding-001): true duplicates scored 0.957–0.976, genuinely
 * different questions 0.731–0.823.
 */

export const NEAR_IDENTICAL = 0.97;
export const SIMILAR = 0.9;
export const WORDING_ONLY = 0.95;
/** Share of stem numbers two calculation questions must have in common. */
export const NUMBER_OVERLAP = 0.7;

export interface QuestionLike {
  questionText: string;
  correctAnswer?: string | null;
}

export interface QuestionFacts {
  /** Canonical numbers in the stem ("20,000" -> "20000", "0.50" -> "0.5"). */
  numbers: Set<string>;
  /** Normalised correct answer, or null when unknown. */
  answer: string | null;
}

// A number not glued to a preceding letter — so the "2" in "CO2" or "H2O" is
// part of a formula, not a problem value. Digits/"."/"," are also excluded
// before the match so the scan cannot restart mid-number ("12" -> "2").
const NUMBER_RE = /(?<![A-Za-z\d.,])(?:-?\d{1,3}(?:,\d{3})+(?:\.\d+)?|-?\d+(?:\.\d+)?)/g;

function canonicalNumber(raw: string): string | null {
  const n = Number(raw.replace(/,/g, ""));
  return Number.isFinite(n) ? String(n) : null;
}

export function extractNumbers(text: string): Set<string> {
  const out = new Set<string>();
  for (const m of text.match(NUMBER_RE) ?? []) {
    const c = canonicalNumber(m);
    if (c !== null) out.add(c);
  }
  return out;
}

/** Answers longer than this are sentences, where wording varies for the same idea. */
const MAX_COMPARABLE_ANSWER_WORDS = 6;

/**
 * Normalised SHORT answer (a term, value or formula), or null. Sentence-length
 * answers return null: two copies of one question can word the same answer
 * differently ("To shift the combined centre of mass back…" vs "To shift the
 * overall centre of mass so…"), which is not evidence they are different.
 * Calibration 2026-09-23 found exactly that pair, 97% similar, let through.
 */
function normaliseAnswer(a: string | null | undefined): string | null {
  if (!a) return null;
  const t = a.toLowerCase().replace(/\s+/g, " ").replace(/[.。]+$/, "").trim();
  if (!t || t.split(" ").length > MAX_COMPARABLE_ANSWER_WORDS) return null;
  return t;
}

export function questionFacts(q: QuestionLike): QuestionFacts {
  return { numbers: extractNumbers(q.questionText), answer: normaliseAnswer(q.correctAnswer) };
}

function overlap(a: Set<string>, b: Set<string>): number {
  let shared = 0;
  for (const x of a) if (b.has(x)) shared++;
  const union = a.size + b.size - shared;
  return union === 0 ? 0 : shared / union;
}

/** Whether two questions are the same problem, with a human-readable reason. */
export function judgeRepeat(
  similarity: number,
  a: QuestionFacts,
  b: QuestionFacts
): { repeat: boolean; reason: string } {
  const pct = `${Math.round(similarity * 100)}% similar`;
  if (similarity >= NEAR_IDENTICAL) {
    return { repeat: true, reason: `${pct} — near-identical wording` };
  }
  if (a.numbers.size > 0 && b.numbers.size > 0) {
    const ov = overlap(a.numbers, b.numbers);
    if (similarity >= SIMILAR && ov >= NUMBER_OVERLAP) {
      const shared = [...a.numbers].filter((n) => b.numbers.has(n)).slice(0, 4).join(", ");
      return { repeat: true, reason: `${pct}, same numbers (${shared})` };
    }
    return { repeat: false, reason: `${pct}, different numbers` };
  }
  if (similarity >= WORDING_ONLY) {
    if (a.answer && b.answer && a.answer !== b.answer) {
      return { repeat: false, reason: `${pct}, different answer` };
    }
    return {
      repeat: true,
      reason: a.answer && b.answer ? `${pct}, same answer` : `${pct}, same question reworded`,
    };
  }
  return { repeat: false, reason: pct };
}
