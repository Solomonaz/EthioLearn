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
  return cleanChapterTitle(title);
}

const NUMBER_WORDS =
  "one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen";

/**
 * One consistent form for a chapter title, however it was detected:
 *
 *   "Unit One: Biology and Technology"  -> "Biology and Technology"
 *   "Unit Three:Enzymes"                -> "Enzymes"
 *   "Unit 5: The human body systems"    -> "The Human Body Systems"
 *   "ATOMIC STRUCTURE AND PERIODIC ..." -> "Atomic Structure and Periodic ..."
 *
 * The "Unit N" prefix goes because the chapter number is already shown beside
 * the title ("1. Unit One: …" said it twice), and AI detection and the
 * rule-based scan wrote it differently ("Unit One" vs "Unit 5") in the same
 * book. Title case throughout, small words lower, acronyms kept. Used both
 * when chapters are saved and when they are shown.
 */
export function cleanChapterTitle(title: string | null | undefined): string {
  let t = (title ?? "").trim().replace(/\s+/g, " ");
  if (!t) return t;

  const prefix = new RegExp(`^(unit|chapter|module)\\s+(\\d+|${NUMBER_WORDS})\\s*[:.\\-–—]\\s*`, "i");
  const stripped = t.replace(prefix, "").trim();
  if (stripped) t = stripped;

  // "Three:Enzymes" -> "Three: Enzymes" (a colon inside the title keeps a space).
  t = t.replace(/:(?=\p{L})/gu, ": ");

  // All capitals: recase every word. Otherwise only lift lower-case initials,
  // so deliberate casing (pH, mRNA) is left alone.
  const allCaps = !/\p{Ll}/u.test(t);
  return t
    .split(/(\s+)/)
    .map((word, i) => {
      if (/^\s+$/.test(word)) return word;
      const bare = word.replace(/[^\p{L}]/gu, "");
      const acronym = ACRONYMS.get(bare.toLowerCase());
      if (acronym && (allCaps || bare === bare.toLowerCase())) return word.replace(bare, acronym);
      const w = allCaps ? word.toLowerCase() : word;
      if (i > 0 && SMALL_WORDS.has(bare.toLowerCase())) return w;
      return w.replace(/\p{L}/u, (c) => c.toUpperCase());
    })
    .join("");
}
