/**
 * Presentation helpers for the secondary-teacher cohort views.
 *
 * Accuracy is carried as 0-1 (or null when there is nothing to measure) all
 * the way from the API, so every view formats and colours it the same way —
 * "no data" must never render as 0%, which reads as a failing class.
 */

/** Below this a cohort or chapter is flagged as needing attention. */
export const WEAK_THRESHOLD = 0.5;

/** Above this a cohort or chapter is doing well. */
export const STRONG_THRESHOLD = 0.75;

/**
 * How far back every teacher insight looks. One window for the class list AND
 * the student page — they used to differ (90 vs 180 days), so the same child
 * showed two different percentages depending on where the teacher looked.
 */
export const INSIGHT_WINDOW_DAYS = 90;

/**
 * Fewest quiz answers before a student's quiz accuracy is trusted on its own.
 * A student was flagged "needs help" — and offered remedial work — on 5
 * answers, where one lucky or unlucky guess moves the figure by 20 points.
 */
export const MIN_ANSWERS_TO_JUDGE = 10;

/**
 * One piece of marked written work counts as this many quiz answers when the
 * two are combined. A marked worksheet is a considered, multi-step piece of
 * work; weighting it like a single quiz answer would let one quick quiz outvote
 * it, which is exactly how a student scoring 23/25 and 18/20 on marked work was
 * shown as 40% and flagged.
 */
export const MARKED_WORK_WEIGHT = 10;

export interface StandingInput {
  /** Quiz answers in the window, and the share correct (null when none). */
  answered: number;
  accuracy: number | null;
  /** Marked written work with a score: how many, and the average (0-1). */
  markedCount: number;
  markedAverage: number | null;
}

/**
 * A student's overall standing: quiz accuracy and marked written work,
 * weighted together. `judged` is false until there is enough evidence to say
 * anything — and an unjudged student is never flagged as needing help.
 */
export function studentStanding(s: StandingInput): { score: number | null; judged: boolean } {
  const quizWeight = s.accuracy === null ? 0 : s.answered;
  const markedWeight = s.markedAverage === null ? 0 : s.markedCount * MARKED_WORK_WEIGHT;
  const total = quizWeight + markedWeight;
  if (total === 0) return { score: null, judged: false };
  const score =
    ((s.accuracy ?? 0) * quizWeight + (s.markedAverage ?? 0) * markedWeight) / total;
  return { score, judged: s.answered >= MIN_ANSWERS_TO_JUDGE || s.markedCount > 0 };
}

/** Whether a student should be flagged — and offered extra work. */
export function needsHelp(s: StandingInput): boolean {
  const { score, judged } = studentStanding(s);
  return judged && score !== null && score < WEAK_THRESHOLD;
}

/** Render 0-1 as a whole percentage, or an em dash when there is no data. */
export function formatAccuracy(accuracy: number | null | undefined): string {
  if (accuracy === null || accuracy === undefined) return "—";
  return `${Math.round(accuracy * 100)}%`;
}

/** Tailwind classes for an accuracy badge. Null data stays neutral. */
export function accuracyTone(accuracy: number | null | undefined): string {
  if (accuracy === null || accuracy === undefined) {
    return "bg-border/50 text-text-secondary";
  }
  if (accuracy < WEAK_THRESHOLD) return "bg-red-100 text-red-700";
  if (accuracy < STRONG_THRESHOLD) return "bg-amber-100 text-amber-700";
  return "bg-green-100 text-green-700";
}

/** Chapter mastery buckets, as the student progress page has always defined them. */
export type MasteryLevel = "NOT_STARTED" | "IN_PROGRESS" | "PROFICIENT" | "MASTERED";

/**
 * Bucket an average score (0-100) into a mastery level.
 *
 * Shared by the student's own progress page and the teacher's view of that
 * student: if the two used different thresholds, a teacher and a student would
 * read the same chapter differently, which is worse than either being wrong.
 */
export function getMasteryLevel(avgScore: number, attemptCount: number): MasteryLevel {
  if (attemptCount === 0) return "NOT_STARTED";
  if (avgScore >= 80) return "MASTERED";
  if (avgScore >= 60) return "PROFICIENT";
  return "IN_PROGRESS";
}
