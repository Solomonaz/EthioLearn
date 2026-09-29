import { PRIMARY_MAX_GRADE, SECONDARY_MAX_GRADE, SECONDARY_MIN_GRADE } from "./teacher-band";
import { isValidSection, MAX_SECTION_LENGTH, normalizeSection } from "./section";
import { canonicalSubject } from "./subject";

/**
 * Validation for the classes a teacher holds — the (subject, grade, section)
 * triples on `TeachingAssignment`.
 *
 * Secondary classes need a subject, a grade and a section. Elementary (grades
 * 1-8) classes never carry a section — null has always meant "the whole grade"
 * for that band, and an elementary school has no student roster for a section
 * to select from — and may leave out the subject or the grade (a homeroom
 * teacher takes all of grade 3; a specialist takes Mathematics across grades),
 * though not both.
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
  /** Always set for secondary classes; may be null for elementary ones. */
  subject: string | null;
  /** Always set for secondary classes; may be null for elementary ones. */
  grade: number | null;
  /** Always set for secondary classes; always null for elementary ones. */
  section: string | null;
}

export type ClassBand = "elementary" | "secondary";

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
  band: ClassBand = "secondary",
): { classes: ParsedClass[] } | { error: string } {
  const elementary = band === "elementary";
  const minGrade = elementary ? 1 : SECONDARY_MIN_GRADE;
  const maxGrade = elementary ? PRIMARY_MAX_GRADE : SECONDARY_MAX_GRADE;

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
    const rawSubject = typeof item?.subject === "string" ? item.subject.trim() : "";
    const subject = rawSubject || null;
    if (subject === null ? !elementary : subject.length > 40) {
      return { error: "Each subject must be between 1 and 40 characters." };
    }

    const blankGrade = item?.grade === undefined || item?.grade === null || item?.grade === "";
    const grade = blankGrade
      ? null
      : typeof item?.grade === "number"
        ? item.grade
        : Number(item?.grade);
    if (grade === null ? !elementary : !Number.isInteger(grade) || grade < minGrade || grade > maxGrade) {
      return { error: `Grades must be between ${minGrade} and ${maxGrade}.` };
    }

    if (subject === null && grade === null) {
      return { error: "Each entry needs a subject, a grade, or both." };
    }

    const section = elementary ? null : normalizeSection(item?.section);
    if (!elementary && !isValidSection(section)) {
      return {
        error: `Each class needs a section (up to ${MAX_SECTION_LENGTH} characters), for example A.`,
      };
    }

    const key = classKey({ subject, grade, section });
    if (seen.has(key)) continue;
    seen.add(key);
    classes.push({ subject, grade, section });
  }

  return { classes };
}

/** Stable identity for a class, used to diff an edit against what is stored. */
export function classKey(c: {
  subject: string | null;
  grade: number | null;
  section: string | null;
}): string {
  return `${(c.subject ?? "").toLowerCase()}::${c.grade ?? ""}::${c.section ?? ""}`;
}

/**
 * Normalise an email to the stored form (trimmed, lower-case), or null when it
 * is not a plausible address. Staff sign in with it — through Google, or a
 * password set via "Forgot password" — so it must match exactly.
 */
export function normalizeEmail(raw: unknown): string | null {
  const email = typeof raw === "string" ? raw.trim().toLowerCase() : "";
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) && email.length <= 254 ? email : null;
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
    if (subject) resolved.set(subject, await canonicalSubject(subject));
  }
  return classes.map((c) => ({
    ...c,
    subject: c.subject ? (resolved.get(c.subject) ?? c.subject) : null,
  }));
}
