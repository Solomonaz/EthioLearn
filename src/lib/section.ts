/**
 * Class sections.
 *
 * A grade can run twenty sections and no single teacher takes them all, so a
 * secondary teacher is assigned to specific sections, and a cohort view is
 * scoped to those sections rather than to the whole grade.
 *
 * That only works if the section string a school admin types on a STUDENT and
 * the one they type on a TEACHING ASSIGNMENT end up identical — "a", "A " and
 * "A" have to be the same section. Both writers normalise through here, which
 * is the single reason this lives in its own module rather than inline.
 */

/** Longest section label accepted, e.g. "A", "B2", "BLUE". */
export const MAX_SECTION_LENGTH = 8;

/**
 * Canonical form of a section label: trimmed, inner whitespace collapsed,
 * upper-cased. Returns null for anything blank, so "no section" is one value
 * rather than a mix of null, "" and " ".
 */
export function normalizeSection(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const cleaned = raw.trim().replace(/\s+/g, " ").toUpperCase();
  return cleaned.length > 0 ? cleaned : null;
}

/** Whether a normalised section label is within the accepted length. */
export function isValidSection(section: string | null): boolean {
  return section !== null && section.length <= MAX_SECTION_LENGTH;
}
