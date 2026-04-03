import { Difficulty } from "@prisma/client";

export function getPointsForDifficulty(difficulty: Difficulty): number {
  const map: Record<Difficulty, number> = { EASY: 10, MEDIUM: 20, HARD: 30 };
  return map[difficulty];
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

  // Speed bonus: +50% if avg time per question ≤ 8 seconds
  let speedBonus = 0;
  if (
    opts?.totalTimeTakenMs !== undefined &&
    opts.questionCount &&
    opts.questionCount > 0 &&
    total > 0
  ) {
    const avgTimePerQuestion = opts.totalTimeTakenMs / opts.questionCount;
    if (avgTimePerQuestion <= 8000) {
      speedBonus = Math.round(total * 0.5);
      total += speedBonus;
    }
  }

  return { total, breakdown, speedBonus, streakBonus: 0 };
}

export function calculateXPLevel(totalPoints: number): number {
  return Math.floor(totalPoints / 100) + 1;
}
