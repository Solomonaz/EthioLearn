import { SECONDARY_MAX_GRADE, SECONDARY_MIN_GRADE } from "./teacher-band";
import { isValidSection, MAX_SECTION_LENGTH, normalizeSection } from "./section";
import { canonicalSubject } from "./subject";

/**
 * Validation for the classes a secondary teacher holds — the (subject, grade,
 * section) triples on `TeachingAssignment`.
 *
 * Shared by teacher creation and teacher editing. Two copies would drift, and
 * the section-normalisation rule in particular has to be identical everywhere
 * or a cohort silently resolves to nobody.
 */

interface ClassInput {
  subject?: unknown;
  grade?: unknown;
  section?: unknown;
}

export interface ParsedClass {
  subject: string;
  grade: number;
  section: string;
}

/** Most classes one teacher may hold. Generous; a guard, not a policy. */
const MAX_CLASSES = 60;

/**
 * Validate and de-duplicate class triples, so the unique index on the table
 * cannot be tripped by a double-submitted row. Section is required: a grade can
 * run many sections and no one teacher takes them all, so "Physics, grade 11"
 * alone does not identify a class.
 *
 * Returns an error message rather than throwing, so routes can map it to a 400.
 */
export function parseClasses(
  raw: unknown,
): { classes: ParsedClass[] } | { error: string } {
  if (raw === undefined || raw === null) return { classes: [] };
  if (!Array.isArray(raw)) {
    return { error: "Classes must be a list." };
  }
  if (raw.length > MAX_CLASSES) {
    return { error: `A teacher cannot have more than ${MAX_CLASSES} classes.` };
  }

  const seen = new Set<string>();
  const classes: ParsedClass[] = [];

  for (const item of raw as ClassInput[]) {
    const subject = typeof item?.subject === "string" ? item.subject.trim() : "";
    if (subject.length < 1 || subject.length > 40) {
      return { error: "Each subject must be between 1 and 40 characters." };
    }

    const grade = typeof item?.grade === "number" ? item.grade : Number(item?.grade);
    if (
      !Number.isInteger(grade) ||
      grade < SECONDARY_MIN_GRADE ||
      grade > SECONDARY_MAX_GRADE
    ) {
      return {
        error: `Grades must be between ${SECONDARY_MIN_GRADE} and ${SECONDARY_MAX_GRADE}.`,
      };
    }

    const section = normalizeSection(item?.section);
    if (!isValidSection(section)) {
      return {
        error: `Each class needs a section (up to ${MAX_SECTION_LENGTH} characters), for example A.`,
      };
    }

    const key = `${subject.toLowerCase()}::${grade}::${section}`;
    if (seen.has(key)) continue;
    seen.add(key);
    classes.push({ subject, grade, section: section as string });
  }

  return { classes };
}

/** Stable identity for a class, used to diff an edit against what is stored. */
export function classKey(c: { subject: string; grade: number; section: string | null }): string {
  return `${c.subject.toLowerCase()}::${c.grade}::${c.section ?? ""}`;
}

/**
 * Normalize an Ethiopian phone number to +251XXXXXXXXX, or null if invalid.
 * Accepts every form an admin might type or paste: +251912…, 251912…, 0912…,
 * and the bare nine-digit local number the forms ask for.
 */
export function normalizePhone(raw: string): string | null {
  const trimmed = raw.trim().replace(/\s+/g, "");
  let n: string;
  if (trimmed.startsWith("+251")) n = trimmed;
  else if (trimmed.startsWith("251")) n = "+" + trimmed;
  else if (trimmed.startsWith("0")) n = "+251" + trimmed.slice(1);
  else if (/^[0-9]{9}$/.test(trimmed)) n = "+251" + trimmed;
  else return null;
  return /^\+251[0-9]{9}$/.test(n) ? n : null;
}

/**
 * Snap each class's subject to the spelling the managed `Subject` list uses.
 *
 * `parseClasses` is deliberately synchronous and pure, so this is a separate
 * step: it touches the database. Call it before writing rows, so a class
 * typed as "biology" is stored the way the textbooks are filed and the cohort
 * queries line up without relying on the case-insensitive read path.
 */
export async function canonicalizeClasses(
  classes: ParsedClass[],
): Promise<ParsedClass[]> {
  const resolved = new Map<string, string>();
  for (const subject of new Set(classes.map((c) => c.subject))) {
    resolved.set(subject, await canonicalSubject(subject));
  }
  return classes.map((c) => ({ ...c, subject: resolved.get(c.subject) ?? c.subject }));
}
