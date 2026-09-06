import { Difficulty } from "@prisma/client";
import { isInExamMatrix } from "./grade-scope";

export function getPointsForDifficulty(difficulty: Difficulty): number {
  const map: Record<Difficulty, number> = { EASY: 10, MEDIUM: 20, HARD: 30 };
  return map[difficulty];
}

// ── Content-grade weighting (see lib/grade-scope) ────────────────────────────
// Students can open more than their own grade — a grade 8 needs grade 7, a
// grade 12 needs grades 9–11 — but the difficulty→points map is grade-blind, so
// an unweighted EASY question is worth 10 points whether it came from grade 9
// or grade 12. Without this, widening access would let a senior student climb
// their own grade's leaderboard on junior content.
//
// Two separate guards, because "below my grade" and "not on my exam" are
// different things:
//
//   1. OUT OF EXAM MATRIX → this content isn't on any exam the student sits
//      this year (a grade 10 revising grade 9). Real study, so it still scores,
//      but at a fraction, and never toward the prize balance.
//   2. BELOW ENROLLMENT GRADE → capped per day in the submit route, even when
//      it IS exam content. A grade 12 revising grade 9 chemistry is doing
//      exactly what ESSLCE asks; a grade 12 grinding grade 9 EASY questions all
//      afternoon is farming. The ceiling separates the two by volume.
//
// Content with no resolvable grade fails open at 1.0 — legacy or teacher-
// authored material shouldn't silently stop paying out.

/** Points multiplier for correct answers on content outside the exam matrix. */
export const OUT_OF_MATRIX_POINTS_FACTOR = 0.25;

/**
 * Per-question multiplier for where the content sits relative to the student.
 * 1.0 when the content is on their exam matrix (or its grade is unknown),
 * `OUT_OF_MATRIX_POINTS_FACTOR` when it is scope-legal review but off-matrix.
 */
export function getContentGradeFactor(
  userGrade: number | null | undefined,
  contentGrade: number | null | undefined
): number {
  if (contentGrade == null) return 1;
  if (userGrade == null) return 1;
  return isInExamMatrix(userGrade, contentGrade) ? 1 : OUT_OF_MATRIX_POINTS_FACTOR;
}

export function getStreakMultiplier(consecutiveCorrect: number): number {
  if (consecutiveCorrect >= 5) return 2;
  if (consecutiveCorrect >= 3) return 1.5;
  return 1;
}

export interface QuizPointsInput {
  answers: { isCorrect: boolean; difficulty: Difficulty }[];
  /** Total time taken in ms — used for speed bonus (top 25% time = +50%) */
  totalTimeTakenMs?: number;
  /** Number of questions — used alongside totalTimeTakenMs */
  questionCount?: number;
  /** User's current login streak — 7-day streak earns +100 bonus */
  streakDays?: number;
}

export function calculateQuizPoints(
  answers: { isCorrect: boolean; difficulty: Difficulty }[],
  opts?: Omit<QuizPointsInput, "answers">
): { total: number; breakdown: number[]; speedBonus: number; streakBonus: number } {
  let streak = 0;
  const breakdown: number[] = [];
  let total = 0;

  for (const answer of answers) {
    if (answer.isCorrect) {
      streak++;
      const base = getPointsForDifficulty(answer.difficulty);
      const multiplier = getStreakMultiplier(streak);
      const points = Math.round(base * multiplier);
      breakdown.push(points);
      total += points;
    } else {
      streak = 0;
      breakdown.push(0);
    }
  }

  // Perfect score bonus (+200 per SRS §4.7.1)
  if (answers.length > 0 && answers.every((a) => a.isCorrect)) {
    total += 200;
  }

  // Speed bonus: +50% for answering *fast AND accurately*. Crucially, this is
  // gated so it can't reward rapid random clicking:
  //   • accuracy must be high (≥80%) — guessers rarely clear this, and
  //   • the average time must sit in a *plausible* window (≥2.5s per question);
  //     anything faster than ~2.5s means the question wasn't actually read.
  const SPEED_MIN_MS = 2500; // faster than this ⇒ not reading, no bonus
  const SPEED_MAX_MS = 8000; // must beat this to count as "fast"
  const SPEED_MIN_ACCURACY = 0.8;
  let speedBonus = 0;
  if (
    opts?.totalTimeTakenMs !== undefined &&
    opts.questionCount &&
    opts.questionCount > 0 &&
    total > 0
  ) {
    const avgTimePerQuestion = opts.totalTimeTakenMs / opts.questionCount;
    const correctRatio =
      answers.filter((a) => a.isCorrect).length / answers.length;
    if (
      correctRatio >= SPEED_MIN_ACCURACY &&
      avgTimePerQuestion >= SPEED_MIN_MS &&
      avgTimePerQuestion <= SPEED_MAX_MS
    ) {
      speedBonus = Math.round(total * 0.5);
      total += speedBonus;
    }
  }

  // 7-day login streak bonus: +100 pts (SRS §4.7.1)
  let streakBonus = 0;
  if (opts?.streakDays !== undefined && opts.streakDays >= 7) {
    streakBonus = 100;
    total += streakBonus;
  }

  return { total, breakdown, speedBonus, streakBonus };
}

export function calculateXPLevel(totalPoints: number): number {
  return Math.floor(totalPoints / 100) + 1;
}

/**
 * Scales earned points by quiz accuracy so a marginal pass earns proportionally
 * less than a strong one. Returns 0 below `floorScore` (blocks lucky guessing),
 * then ramps linearly with the score (e.g. 60% → 0.6×, 100% → 1.0×).
 */
export function getAccuracyFactor(score: number, floorScore: number): number {
  if (score < floorScore) return 0;
  return Math.min(1, Math.max(0, score / 100));
}
