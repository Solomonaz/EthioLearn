import { db } from "./db";

/**
 * Subject-name matching.
 *
 * `subject` is a free-text string on `Textbook`, `TeachingAssignment` and
 * `GameContent`, with no foreign key to the `Subject` table. Nothing stops a
 * textbook being uploaded as "Biology" while a teacher's class says "biology",
 * and because every cohort query compares the two with exact equality, that
 * mismatch silently produces an empty dashboard — no error, no clue.
 *
 * This module is the one place that knows how two subject names are compared:
 *
 *   • On WRITE, `canonicalSubject` snaps an input to the spelling the managed
 *     `Subject` list already uses, so new rows cannot drift apart.
 *   • On READ, the filter helpers match case-insensitively, so rows that
 *     already drifted still resolve without a migration.
 *
 * Case-insensitivity does not fix "Maths" versus "Mathematics" — nothing here
 * can. Constraining the pickers to the managed list is what prevents that, and
 * `canonicalSubject` is the server-side half of it.
 */

/** Comparison key: trimmed, inner whitespace collapsed, lower-cased. */
export function subjectKey(subject: string | null | undefined): string {
  return (subject ?? "").trim().replace(/\s+/g, " ").toLowerCase();
}

/** Whether two subject names refer to the same subject. */
export function subjectEquals(
  a: string | null | undefined,
  b: string | null | undefined,
): boolean {
  const ka = subjectKey(a);
  return ka.length > 0 && ka === subjectKey(b);
}

/** Prisma filter matching one subject regardless of case. */
export function subjectFilter(subject: string) {
  return { equals: subject, mode: "insensitive" as const };
}

/**
 * Prisma `OR` clauses matching any of several subjects regardless of case.
 *
 * Written as an OR of case-insensitive equals rather than `{ in: [...] }`,
 * because `mode` is documented for `equals` and the string operators; relying
 * on it applying to `in` would be guessing at behaviour we depend on.
 */
export function subjectInFilter(subjects: string[]) {
  return subjects.map((s) => ({ subject: subjectFilter(s) }));
}

/**
 * Snap a subject name to the spelling the managed `Subject` list uses.
 *
 * Returns the trimmed input unchanged when the list has no match, so an
 * administrator introducing a genuinely new subject is never blocked — this
 * aligns spellings, it does not police vocabulary.
 */
export async function canonicalSubject(input: string): Promise<string> {
  const trimmed = tidySubjectName(input);
  if (!trimmed) return trimmed;

  const match = await db.subject.findFirst({
    where: { name: subjectFilter(trimmed) },
    select: { name: true },
  });

  return match?.name ?? trimmed;
}

/**
 * A subject name as it should be stored: trimmed, single-spaced, and — when
 * typed all in lower case — capitalised ("biology" -> "Biology", "social
 * studies" -> "Social Studies"). Anything with capitals already ("ICT",
 * "Civics and Ethical Education") is kept as typed.
 */
export function tidySubjectName(input: string): string {
  const s = input.trim().replace(/\s+/g, " ");
  if (!s || s !== s.toLowerCase()) return s;
  return s.replace(/(^|\s)(\p{L})/gu, (_, sp: string, c: string) => sp + c.toUpperCase());
}
