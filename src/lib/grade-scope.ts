/**
 * Grade scope — what content a student may open, derived from their enrollment
 * grade (`User.grade`).
 *
 * Ethiopian national exams are cumulative over a cycle, not a single year:
 *   • Grade 8 (middle-school leaving) → drawn from the grade 7–8 cycle
 *   • Grade 12 ESSLCE                 → drawn from all four secondary years, 9–12
 *
 * A single `User.grade` cannot express that, so this module keeps `User.grade`
 * as the *enrollment* grade (identity, leaderboard, class placement, reporting
 * — all unchanged) and derives two distinct things from it:
 *
 *   • STUDY SCOPE — every grade the student may open. Cumulative within the
 *     cycle: their own grade plus every lower grade in the same cycle.
 *   • EXAM MATRIX — the grades their exam actually tests. For an exam year
 *     (8 and 12) that is the whole cycle; otherwise just their own grade.
 *
 * The two differ for non-exam years: a grade 10 student may *open* grade 9 for
 * review and prerequisites, but grade 9 is not on any exam they sit this year.
 * The points economy uses exactly that difference so widening access can't be
 * turned into a way to farm easy points — see `lib/points`.
 */

/** Curriculum cycles. A student's study scope never crosses a cycle boundary. */
const CYCLES: readonly (readonly number[])[] = [
  [1, 2, 3, 4, 5, 6], // primary
  [7, 8], // middle
  [9, 10, 11, 12], // secondary
];

/** Grades that sit a cumulative national exam over their whole cycle. */
const EXAM_GRADES: readonly number[] = [8, 12];

export const MIN_GRADE = 1;
export const MAX_GRADE = 12;

/** The cycle containing `grade`, or null if the grade is out of range. */
function getCycle(grade: number): readonly number[] | null {
  return CYCLES.find((c) => c.includes(grade)) ?? null;
}

function isValidGrade(grade: number | null | undefined): grade is number {
  return (
    typeof grade === "number" &&
    Number.isInteger(grade) &&
    grade >= MIN_GRADE &&
    grade <= MAX_GRADE
  );
}

/**
 * Every grade a student enrolled in `grade` may open, ascending.
 * Their own grade plus every lower grade in the same cycle.
 *
 *   8  → [7, 8]
 *   12 → [9, 10, 11, 12]
 *   10 → [9, 10]
 *   9  → [9]
 *
 * Returns [] for a null/invalid grade — callers treat that as "no scope yet"
 * (a mid-onboarding profile) and fall back to their own no-grade behaviour.
 */
export function getStudyScope(grade: number | null | undefined): number[] {
  if (!isValidGrade(grade)) return [];
  const cycle = getCycle(grade);
  if (!cycle) return [grade];
  return cycle.filter((g) => g <= grade);
}

/**
 * The grades the student's own exam draws from, ascending.
 *
 *   8  → [7, 8]        (grade 8 exam is cumulative over the middle cycle)
 *   12 → [9, 10, 11, 12] (ESSLCE draws from all four secondary years)
 *   10 → [10]          (no cumulative exam this year)
 *
 * Always a subset of `getStudyScope(grade)`.
 */
export function getExamMatrix(grade: number | null | undefined): number[] {
  if (!isValidGrade(grade)) return [];
  if (!EXAM_GRADES.includes(grade)) return [grade];
  return getCycle(grade)?.filter((g) => g <= grade) ?? [grade];
}

/** Is `grade` an exam year with a cumulative, multi-year matrix? */
export function isExamGrade(grade: number | null | undefined): boolean {
  return isValidGrade(grade) && EXAM_GRADES.includes(grade);
}

/** May a student enrolled in `userGrade` open content tagged `contentGrade`? */
export function isInStudyScope(
  userGrade: number | null | undefined,
  contentGrade: number | null | undefined
): boolean {
  if (!isValidGrade(contentGrade)) return false;
  return getStudyScope(userGrade).includes(contentGrade);
}

/** Does `contentGrade` sit on the exam the student is actually preparing for? */
export function isInExamMatrix(
  userGrade: number | null | undefined,
  contentGrade: number | null | undefined
): boolean {
  if (!isValidGrade(contentGrade)) return false;
  return getExamMatrix(userGrade).includes(contentGrade);
}

/**
 * Grades inside the study scope but *below* the enrollment grade. These are
 * subject to the daily below-grade point ceiling in the submit route: they are
 * legitimate study (and for grade 8 / 12 they are exam content), but they are
 * also the easiest questions available to that student, so unlimited scoring
 * on them would be a point farm.
 */
export function getBelowGradeScope(grade: number | null | undefined): number[] {
  if (!isValidGrade(grade)) return [];
  return getStudyScope(grade).filter((g) => g < grade);
}

/**
 * Resolve a client-supplied `grade` query param against a user's study scope.
 *
 * Returns the grades a query should actually be filtered to:
 *   • non-students (admins, teachers) → null, meaning "no grade restriction"
 *   • student with no usable grade   → [] , so the query returns nothing
 *   • no requested grade             → the student's whole scope
 *   • a requested grade in scope     → just that grade
 *   • a requested grade out of scope → [] , so the query returns nothing
 *
 * Callers that want to reject rather than return an empty list should test
 * with `isInStudyScope` first and respond 403.
 */
export function resolveGradeScope(
  user: { role: string; grade: number | null },
  requestedGrade?: number | null
): number[] | null {
  if (user.role !== "STUDENT") return null;

  const scope = getStudyScope(user.grade);
  // A student with no grade (or an out-of-range one) has no study scope, so
  // they see nothing — NOT everything. Failing open here would hand the whole
  // catalogue to any account mid-onboarding, and would disagree with
  // `isInStudyScope`, which already refuses these accounts at the quiz routes.
  // This state is transient by design: the dashboard layout redirects a
  // grade-less student to /complete-profile before they can reach any content.
  if (scope.length === 0) return [];

  if (requestedGrade === undefined || requestedGrade === null) return scope;
  return scope.includes(requestedGrade) ? [requestedGrade] : [];
}
