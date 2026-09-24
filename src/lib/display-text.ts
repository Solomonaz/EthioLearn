/**
 * Display formatting for free-text names that reach teachers as typed or as
 * scanned: subjects typed in lower case ("biology" beside "Chemistry") and
 * chapter titles OCR'd in capitals ("ATOMIC STRUCTURE AND PERIODIC ...").
 *
 * Display only — stored values and every comparison stay untouched (subjects
 * are compared case-insensitively by lib/subject).
 */

const SMALL_WORDS = new Set([
  "a", "an", "and", "as", "at", "by", "for", "in", "into", "of", "on", "or", "the", "to", "with",
]);

/** Kept as written: recasing these changes their meaning. */
const ACRONYMS = new Map(
  ["DNA", "RNA", "ATP", "ADP", "UV", "AC", "DC", "HIV", "AIDS", "ICT", "SI", "II", "III", "IV", "VI", "VII", "VIII", "IX", "XI", "XII"].map(
    (a) => [a.toLowerCase(), a]
  )
);

/** "biology" → "Biology"; anything already mixed-case is left alone. */
export function displaySubject(subject: string | null | undefined): string {
  const s = (subject ?? "").trim();
  if (!s || s !== s.toLowerCase()) return s;
  return s.replace(/\b\p{L}/gu, (c) => c.toUpperCase());
}

/**
 * "ATOMIC STRUCTURE AND PERIODIC PROPERTIES OF THE ELEMENTS" →
 * "Atomic Structure and Periodic Properties of the Elements". Only a title
 * with no lower-case letters at all is recased; a title someone typed with
 * deliberate casing is shown as typed.
 */
export function displayChapterTitle(title: string | null | undefined): string {
  const t = (title ?? "").trim();
  if (!t || /\p{Ll}/u.test(t)) return t;
  return t
    .toLowerCase()
    .split(/(\s+)/)
    .map((word, i) => {
      if (/^\s+$/.test(word)) return word;
      const bare = word.replace(/[^\p{L}]/gu, "");
      const acronym = ACRONYMS.get(bare);
      if (acronym) return word.replace(bare, acronym);
      if (i > 0 && SMALL_WORDS.has(bare)) return word;
      return word.replace(/\p{L}/u, (c) => c.toUpperCase());
    })
    .join("");
}
