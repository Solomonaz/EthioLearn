/**
 * Full-text chapter detection.
 *
 * `detectChaptersFromContent` sends only `content.slice(0, 50000)` to the model
 * — about 25 pages. On a 300-page textbook the AI was shown roughly the first
 * 8% and inferred the whole chapter list from it, so every chapter past that
 * window went undetected. A missed chapter is the worst failure in the
 * pipeline: its text never becomes a chapter row, never gets chunked, never
 * produces questions, and is invisible to students — silently.
 *
 * Detection therefore reads the document in the order a person would:
 *
 *   1. FRONT MATTER (the normal path, ONE call) — a textbook's opening pages
 *      carry an author-written table of contents listing every chapter. Reading
 *      that beats hunting for headings across hundreds of pages.
 *   2. WINDOWED AI (fallback only) — overlapping windows across the whole text,
 *      one AI call each. Reserved for documents whose contents page is missing
 *      or unreadable, because it is expensive.
 *   3. DETERMINISTIC SCAN (always, free) — a regex sweep for heading patterns
 *      ("CHAPTER 4", "UNIT 7", "ምዕራፍ ፫"). Unioned with whichever AI pass ran,
 *      so it can recover a chapter the model missed.
 *
 * Measured on a real 404-page Grade 12 Mathematics textbook:
 *
 *   front matter, 1 call, 30s   → 9 of 9 units  ✓
 *   deterministic scan, free    → 7 of 9 (units 7 and 8 have no running headers)
 *   windowed, 16 calls          → did not finish in 30 minutes
 *
 * Hence front matter first. The union is still taken because neither pass alone
 * is reliable across every book, and a coverage check flags chapters large
 * enough to imply headings were still missed — so a bad split is visible rather
 * than silent.
 */

import { detectChapters } from "./ai-provider";
import { createTitleLocator, detectFrontMatterEnd } from "./gemini";
import type { DetectedChapter } from "./gemini";

// ── Front matter ────────────────────────────────────────
// A textbook's opening pages carry an author-written table of contents: an
// authoritative list of exactly what we are trying to find. Measured on a real
// 404-page Grade 12 Mathematics textbook, ONE call over this slice returned all
// 9 units correctly — including two that have no running page headers anywhere
// in the body, so the deterministic sweep could never have found them.
// Sweeping all 404 pages instead took 16 calls and had not finished after 30
// minutes. The cheap path is also the more accurate one.
//
// Sized to fit the SMALLEST provider budget in the chain, not the largest —
// Groq's free tier caps a request at 8,000 tokens, and Gemini's allows only 20
// requests per DAY, so the cheap pass has to survive on Groq.
//
// Contents pages tokenize far worse than prose: this book's front matter ran
// ~2.33 characters per token (not the usual ~4) because of dot leaders
// ("Sequences and Series .......... 1"), so 24k characters became 10,298 tokens
// and Groq rejected it with a 413. In that textbook the entire contents page
// occupied characters 3,158–7,985, so 16k covers it twice over and lands near
// 5,600 tokens after compression — comfortably inside the limit.
//
// Erring small is safe: if the slice misses part of a longer contents page the
// completeness check fails and the windowed fallback takes over.
const FRONT_MATTER_CHARS = 16_000;

/**
 * Strip formatting noise from the front matter before spending tokens on it.
 * Dot leaders alone accounted for 95 runs in one 24k slice and carry no
 * information the model needs — only the titles and their order matter.
 */
function compressFrontMatter(text: string): string {
  return text
    .replace(/[.]{3,}/g, " … ")   // "......... 12" -> " … 12"
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

// Must stay at or below the per-call slice inside the detection prompts.
const WINDOW_CHARS = 50_000;
// Windows overlap so a heading sitting on a boundary is fully inside one of them.
const WINDOW_OVERLAP_CHARS = 5_000;
// A chapter occupying more than this share of the book probably swallowed
// headings that were never detected.
const SUSPICIOUS_CHAPTER_SHARE = 0.25;
// About two textbook pages. A scan-found heading starting nearer than this to
// a chapter already found is that chapter, not a new one.
const MIN_CHAPTER_CHARS = 4_000;
// A unit label seen more often than this is a running page header, not the
// heading that opens the unit.
const MAX_OPENING_HEADING_REPEATS = 5;
// The share of a book its contents page can occupy.
const CONTENTS_PAGE_SHARE = 0.05;
// Labels that can name a whole unit (a lesson or part is a section within one).
const UNIT_LABEL_KINDS = new Set(["unit", "chapter", "ምዕራፍ"]);

// ── Front-matter acceptance test ────────────────────────
// Windowing is only worth its cost when the cheap pass looks wrong, so the
// result has to clear a bar before we trust it and stop.
const MIN_CHAPTERS_FOR_CONFIDENCE = 2;
// Titles the model invents can't be located in the text. Requiring most of them
// to be findable catches a hallucinated or wildly wrong list.
const MIN_LOCATABLE_RATIO = 0.6;

export type DetectionStrategy = "front-matter" | "windowed" | "scan-only" | "none";

export interface ChapterDetectionResult {
  chapters: DetectedChapter[];
  provider: string;
  /** Which path produced the AI chapters. */
  strategy: DetectionStrategy;
  windowsScanned: number;
  /** Headings found by the deterministic scan that the AI passes missed. */
  recoveredByScan: number;
  /** Chapters big enough to suggest undetected headings inside them. */
  suspiciouslyLargeChapters: string[];
  warnings: string[];
}

interface HeadingCandidate {
  index: number;
  kind: string;
  number: number;
  title: string;
  /** Label set in capitals ("UNIT TWO"), as a real heading is. */
  capitalised: boolean;
}

// ─── Deterministic heading scan ─────────────────────────

const WORD_NUMBERS: Record<string, number> = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8,
  nine: 9, ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14,
  fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19, twenty: 20,
};

const ROMAN: Record<string, number> = {
  i: 1, ii: 2, iii: 3, iv: 4, v: 5, vi: 6, vii: 7, viii: 8, ix: 9, x: 10,
  xi: 11, xii: 12, xiii: 13, xiv: 14, xv: 15, xvi: 16, xvii: 17, xviii: 18,
  xix: 19, xx: 20,
};

/** Ge'ez numerals ፩–፳, used in Amharic textbooks. */
const GEEZ: Record<string, number> = {
  "፩": 1, "፪": 2, "፫": 3, "፬": 4, "፭": 5, "፮": 6, "፯": 7, "፰": 8, "፱": 9,
  "፲": 10, "፲፩": 11, "፲፪": 12, "፲፫": 13, "፲፬": 14, "፲፭": 15,
};

function parseNumberToken(token: string): number | null {
  const t = token.trim().toLowerCase().replace(/[.:)\]]+$/, "");
  if (/^\d{1,2}$/.test(t)) return parseInt(t, 10);
  if (WORD_NUMBERS[t] !== undefined) return WORD_NUMBERS[t];
  if (ROMAN[t] !== undefined) return ROMAN[t];
  if (GEEZ[token.trim()] !== undefined) return GEEZ[token.trim()];
  return null;
}

/**
 * Sweep the whole document for heading-shaped lines.
 *
 * Deliberately permissive — false positives are filtered afterwards by
 * requiring candidates to form a continuous numbered sequence.
 */
function scanHeadingCandidates(text: string): HeadingCandidate[] {
  const candidates: HeadingCandidate[] = [];
  // "CHAPTER 4 — Cells", "Unit Two: Motion", "ምዕራፍ ፫ ...", "ክፍል 2 ..."
  const labelled =
    /^[ \t_]*(chapter|unit|lesson|section|part|ምዕራፍ|ክፍል)[ \t]+_?([0-9]{1,2}|[ivxlc]{1,5}|[a-z]+|[፩-፼]{1,3})(?=[\s\-–—.:)|]|$)[ \t]*[-–—.:)]?[ \t]*(.{0,160})$/gim;

  let m: RegExpExecArray | null;
  while ((m = labelled.exec(text)) !== null) {
    const number = parseNumberToken(m[2]);
    if (number === null) continue;
    // A contents-page heading drags its dot leader and page number along
    // ("Relations and Functions..........1"). Both are typesetting, not part
    // of the title, and they break every comparison downstream.
    //
    // A running page header ("UNIT 3 145" — unit label, then the page number)
    // reaches here as a bare number, with no space left in front of it because
    // the pattern above consumed it. Measured on the Grade 11 Chemistry
    // textbook: units 3–6 came back as chapters titled "145", "193", "223" and
    // "265" (one- and two-digit pages slipped under the length floor below).
    // A title that is only a page number, Arabic or Roman, is no title.
    let title = (m[3] || "")
      .replace(/[.·]{3,}.*$/, "")
      .replace(/\s+\d{1,4}\s*$/, "")
      .trim();
    if (/^(\d{1,4}|[ivx]{1,6})$/i.test(title)) title = "";
    if (!title) title = titleFromFollowingLines(text, m.index + m[0].length, number);
    candidates.push({
      index: m.index,
      kind: m[1].toLowerCase(),
      number,
      title: title.length >= 3 ? `${capitalise(m[1])} ${number}: ${title}` : `${capitalise(m[1])} ${number}`,
      capitalised: m[1] === m[1].toUpperCase() && m[1] !== m[1].toLowerCase(),
    });
  }

  return candidates;
}

// Section labels that follow a unit title and must not be read as part of it.
const NOT_A_TITLE_LINE = /^(introduction|unit outcomes?|main contents?|learning outcomes?|contents)\b/i;

/**
 * Read a title set on the lines below a bare heading.
 *
 * The Grade 9 Geography textbook has no contents page, and each unit opens
 * with "UNIT TWO" alone on its line and the title beneath it, numbered and
 * often broken across lines:
 *
 *   UNIT SEVEN
 *   7. CONTEMPORARY GEOGRAPHIC
 *   ISSUES AND PUBLIC CONCERNS IN
 *   ETHIOPIA
 *
 * Without this the scan named every unit just "Unit N", which the splitter
 * cannot find in a text that spells the number as a word, so the whole book
 * went into Unit 1. Only a line starting with the unit's own number is taken,
 * which keeps ordinary body text from being read as a title; it is extended
 * by the all-capitals lines that continue it.
 */
function titleFromFollowingLines(text: string, from: number, number: number): string {
  const lines = text.slice(from, from + 400).split("\n").map((l) => l.trim());
  let i = 0;
  while (i < lines.length && lines[i] === "") i++;
  const first = lines[i]?.match(new RegExp(`^${number}\\s*[.:)]?\\s+(.{3,})$`));
  if (!first || /[a-z]/.test(first[1])) return "";

  const parts = [first[1]];
  for (let j = i + 1; j < lines.length && parts.length < 3; j++) {
    const line = lines[j];
    if (!line || /[a-z]/.test(line) || !/[A-Z]/.test(line) || NOT_A_TITLE_LINE.test(line)) break;
    parts.push(line);
  }
  const title = parts.join(" ").replace(/\s+/g, " ").trim();
  if (title.length > 90) return "";
  // Body headings are set in capitals; store them in title case.
  return title
    .toLowerCase()
    .replace(/(^|[\s–-])(\p{L})/gu, (_, sep, ch) => sep + ch.toUpperCase())
    .replace(/(?<=\s)(And|Of|In|The|For|To|On)(?=\s)/g, (w) => w.toLowerCase());
}

function capitalise(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
}

/**
 * Keep only candidates belonging to the document's dominant heading style, and
 * only where their numbers form a sensible increasing run. This is what stops a
 * stray "Part 1" in a preface from being promoted to a chapter.
 */
function filterToDominantSequence(candidates: HeadingCandidate[]): HeadingCandidate[] {
  if (candidates.length === 0) return [];

  const byKind = new Map<string, HeadingCandidate[]>();
  for (const c of candidates) {
    const list = byKind.get(c.kind) ?? [];
    list.push(c);
    byKind.set(c.kind, list);
  }

  let best: HeadingCandidate[] = [];
  for (const list of byKind.values()) {
    // First occurrence of each number, in document order.
    const seen = new Map<number, HeadingCandidate>();
    for (const c of list.sort((a, b) => a.index - b.index)) {
      if (!seen.has(c.number)) seen.set(c.number, c);
    }
    const ordered = [...seen.values()].sort((a, b) => a.index - b.index);

    // Numbers must broadly ascend through the document.
    const ascending = ordered.filter((c, i) => i === 0 || c.number > ordered[i - 1].number);
    if (ascending.length > best.length) best = ascending;
  }

  // A lone match is far more likely to be noise than a real chapter list.
  return best.length >= 2 ? best : [];
}

/** Edit distance, giving up once it exceeds `max`. */
function editDistance(a: string, b: string, max: number): number {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    let rowMin = i;
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      rowMin = Math.min(rowMin, cur[j]);
    }
    if (rowMin > max) return max + 1;
    prev = cur;
  }
  return prev[b.length];
}

/**
 * The first line after the contents page that spells `title` almost exactly —
 * a letter or two apart per ten — or null. Used only for titles that can't be
 * found as written, i.e. a typo on the contents page or in the heading.
 */
function nearMatchingHeading(text: string, title: string, from: number): string | null {
  const norm = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
  const target = norm(title.replace(/^\s*(chapter|unit|lesson|section|part)\s+\S+?\s*[-–—.:)|]+\s*/i, ""));
  if (target.length < 5) return null;
  const max = Math.max(1, Math.floor(target.length / 10));
  for (const raw of text.slice(from).split("\n")) {
    const line = raw.trim();
    if (!line || Math.abs(line.length - target.length) > max + 6) continue;
    // A contents-page line ("…-------202") is not the unit's heading.
    if (/[.\-_·]{4,}/.test(line)) continue;
    const n = norm(line);
    // Same first letter: a heading whose drop cap was lost ("ISTORY, …" for
    // "HISTORY, …") is a worse title than the one we have.
    if (n[0] !== target[0]) continue;
    // A real spelling difference, not just spacing ("500 AD" / "500AD").
    if (n.replace(/ /g, "") === target.replace(/ /g, "")) continue;
    if (editDistance(n, target, max) <= max) return line;
  }
  return null;
}

/** Positions where a line begins, from `from` up to (not including) `to`. */
function lineStartsBetween(text: string, from: number, to: number): number[] {
  const out: number[] = [];
  if (from === 0 || text[from - 1] === "\n") out.push(from);
  for (let i = text.indexOf("\n", from); i >= 0 && i + 1 < to; i = text.indexOf("\n", i + 1)) out.push(i + 1);
  return out;
}

/**
 * Does the text at `pos` actually begin with this title?
 *
 * The title locator falls back to loose matches (its first few long words, or
 * one long word) so a chapter can still be found when its title is garbled.
 * That is too loose for choosing where a unit opens: in Grade 9 History it put
 * Unit 8 ("Political, Social and Economic Processes…") at "political, social
 * and ritual leadership" inside Unit 7. Require a line that begins with the
 * title's opening words, in order, short words included.
 */
function opensWithTitle(text: string, pos: number, title: string): boolean {
  // "&" on the contents page is often "and" on the unit's own title page.
  const norm = (s: string) => s.toLowerCase().replace(/&/g, " and ").replace(/[^\p{L}\p{N}]+/gu, " ").trim();
  // The label may lead either side: a contents title "Unit 3: Cells", or a
  // title page reading "Unit 2: Characteristics and / Classification of…".
  const unlabel = (s: string) => s.replace(/^\s*(chapter|unit|lesson|section|part)\s+\S+?\s*[-–—.:)|]+\s*/i, "");
  const words = norm(unlabel(title)).split(" ").slice(0, 4);
  if (words.length === 0 || words.join(" ").length < 6) return false;
  if (norm(unlabel(text.slice(pos, pos + 200))).startsWith(words.join(" "))) return true;
  // A title page with the number set apart from its label (Grade 9/10
  // Economics): "Unit The Basic Economic Problems" / "2 and Economic Systems",
  // or "Unit Theory of Consumer Behaviour" / "1". Drop the bare label and the
  // number that opens the next line. Allow a typo: that contents page lists
  // "Markerts" for the "Markets" on the title page.
  const page = text.slice(pos, pos + 200).match(/^[ \t]*(chapter|unit)[ \t]+(\S+)([^\n]*)\n[ \t]*\d{1,2}(?=\s)([^]*)$/i);
  if (!page || parseNumberToken(page[2]) !== null) return false;
  const want = words.join(" ");
  const opening = norm(`${page[2]}${page[3]} ${page[4]}`).slice(0, want.length + 2);
  const max = Math.max(1, Math.floor(want.length / 15));
  return [want.length - 1, want.length, want.length + 1].some((len) => editDistance(opening.slice(0, len), want, max) <= max);
}

/**
 * Where each of `titles.length` units starts, read from the book's own unit
 * labels — or null when the labels don't account for every unit cleanly, in
 * which case the splitter falls back to searching for titles.
 *
 * Title search fails in ways labels don't. Grade 11 Geography's contents page
 * names a unit differently from the headers on its pages, so Unit 2 was cut
 * mid-sentence; Grade 9 History's contents page says "c. 500 AD" where its
 * pages say "c. 500AD", so Unit 2 was never found and Unit 1 was cut in half.
 * Every one of these books labels its units, in one of two styles:
 *
 *   - an opening heading, once per unit ("UNIT TWO" — Grade 11/12 History,
 *     Grade 11 Geography);
 *   - a running header on every page ("Unit 2|Ancient World Civilizations…"
 *     in Grade 9/10 History, "UNIT 3 145" in Grade 11 Chemistry).
 *
 * A unit starts at its first label. With running headers the opening page may
 * carry no header (Grade 11 Chemistry), so if the unit's title appears after
 * the previous unit's last header and before this unit's first, the unit
 * starts at the title. A unit with no label at all (Grade 12 History, Unit 1)
 * starts at its title.
 *
 * A contents page lists "UNIT ONE … UNIT NINE" a few lines apart, often
 * without dot leaders (Grade 11/12 History), so a run of consecutive labels
 * closer together than a chapter could be is skipped as the contents page.
 */
function headingChapterStarts(
  text: string,
  scan: HeadingCandidate[],
  titles: string[],
  frontMatterEnd: number,
  textLength: number,
): number[] | null {
  const n = titles.length;
  if (n < MIN_CHAPTERS_FOR_CONFIDENCE) return null;

  // Labels that look like layout rather than prose: set in capitals, or a
  // header repeated word for word on several pages. A sentence that happens to
  // start a line with "Unit 3 explains…" is neither.
  const repeats = new Map<string, number>();
  for (const c of scan) repeats.set(c.title, (repeats.get(c.title) ?? 0) + 1);
  const plausible = scan.filter(
    (c) =>
      UNIT_LABEL_KINDS.has(c.kind) &&
      c.number >= 1 && c.number <= n &&
      (c.capitalised || (repeats.get(c.title) ?? 0) >= 3),
  );
  // One labelling style per book — the kind that names the most units.
  // "Lesson 1" and "Part IV" number sections, not units.
  const unitsNamed = (kind: string) => new Set(plausible.filter((c) => c.kind === kind).map((c) => c.number)).size;
  const kind = [...new Set(plausible.map((c) => c.kind))].sort((a, b) => unitsNamed(b) - unitsNamed(a))[0];
  let labels = plausible.filter((c) => c.kind === kind).sort((a, b) => a.index - b.index);

  // Skip the contents page: a run of three or more consecutive unit numbers,
  // each closer to the last than any real chapter is long.
  let lowerBound = frontMatterEnd;
  for (let i = 0; i < labels.length && labels[i].index < textLength * 0.2; i++) {
    if (labels[i].number !== 1) continue;
    let j = i;
    while (
      j + 1 < labels.length &&
      labels[j + 1].number === labels[j].number + 1 &&
      labels[j + 1].index - labels[j].index < MIN_CHAPTER_CHARS
    ) j++;
    if (j - i + 1 >= 3) {
      lowerBound = Math.max(lowerBound, labels[j].index + 1);
      break;
    }
  }
  labels = labels.filter((c) => c.index >= lowerBound);

  const byNumber = new Map<number, number[]>();
  for (const c of labels) byNumber.set(c.number, [...(byNumber.get(c.number) ?? []), c.index]);

  const starts: number[] = [];
  let labelled = 0;
  // After a unit with running headers, the next unit's opening page lies
  // between that unit's last header and the next unit's first label.
  let afterLastHeader: number | null = null;
  for (let k = 1; k <= n; k++) {
    const prev = starts.length ? starts[starts.length - 1] : lowerBound - 1;
    const own = (byNumber.get(k) ?? []).filter((p) => p > prev);
    const first = own.length ? own[0] : undefined;
    const nextFirst = (byNumber.get(k + 1) ?? []).find((p) => p > (first ?? prev));
    const earliest = starts.length ? prev + MIN_CHAPTER_CHARS : lowerBound;

    let start = first;
    if (first !== undefined) labelled++;

    // The title may open the unit just before its first label — but only look
    // where that can't be a passing mention inside the previous unit: in the
    // gap after the previous unit's last page header, or anywhere before the
    // next label when this unit has no label at all.
    const lo =
      first === undefined ? earliest
      : k === 1 ? (own.length > MAX_OPENING_HEADING_REPEATS ? lowerBound : Math.max(lowerBound, first - MIN_CHAPTER_CHARS))
      : afterLastHeader !== null ? Math.max(afterLastHeader, earliest)
      // After an opening heading, only the page or two before this unit's own
      // heading: Grade 9 Biology sets each unit's title and contents there.
      : Math.max(earliest, first - MIN_CHAPTER_CHARS);
    if (lo !== null) {
      const hi = first ?? nextFirst ?? textLength;
      const titleAt = lineStartsBetween(text, lo, hi).find((p) => opensWithTitle(text, p, titles[k - 1]));
      if (titleAt !== undefined) start = titleAt;
    }

    if (start === undefined || start < earliest) return null;
    starts.push(start);

    const ownBeforeNext = own.filter((p) => nextFirst === undefined || p < nextFirst);
    afterLastHeader =
      ownBeforeNext.length > MAX_OPENING_HEADING_REPEATS ? ownBeforeNext[ownBeforeNext.length - 1] : null;
  }

  // Mostly labelled, or this is a title search in disguise.
  return labelled * 2 >= n ? starts : null;
}

// ─── Title normalisation (for cross-pass dedupe) ────────

function normaliseTitle(title: string): string {
  return title
    .toLowerCase()
    // Trailing qualifiers like "(For Natural Science Students)" describe the
    // audience, not the chapter, and appear only in the contents page — so the
    // same unit reads differently depending on which pass found it.
    .replace(/\s*\([^)]*\)\s*$/g, "")
    .replace(/^(chapter|unit|lesson|section|part|ምዕራፍ|ክፍል)\s*[\d\w፩-፼]*\s*[-–—.:)]*\s*/i, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    // A contents-page title keeps its page number ("Relations and Functions 1").
    // The same chapter found in the body does not.
    .replace(/\s+\d{1,4}$/, "")
    .trim();
}

/**
 * Compare titles with every space removed.
 *
 * PDF text extraction splits words at random — this Grade 10 Mathematics
 * textbook yields "R elations and Functions" from its own contents page — so
 * word-wise comparison reports two different chapters where there is one.
 * Removing spaces entirely makes the OCR damage invisible to the comparison:
 * "relationsandfunctions" either way.
 */
function squashKey(key: string): string {
  return key.replace(/\s+/gu, "");
}

// Below this length a prefix match is more likely to be a coincidence than a
// chapter. Six admits the singular/plural pairs that matter ("circle" against
// "circles", which the old floor of 8 silently skipped).
const MIN_SQUASHED_MATCH = 6;

/**
 * Find an existing entry describing the same chapter.
 *
 * Exact key equality is not enough: the AI reads the contents page and returns
 * "Vectors in Space (For Natural Science Students)" while the deterministic
 * scan reads a body heading and returns "Unit 6: Vectors in Space". Both name
 * one chapter, and listing it twice produces a broken split — the duplicate
 * takes a slice of the book with it.
 *
 * Two rules, unioned: the original word-wise prefix test, plus a space-blind
 * one that survives OCR damage and plural drift.
 */
function findExistingKey(merged: Map<string, unknown>, key: string): string | null {
  if (merged.has(key)) return key;

  const squashed = squashKey(key);
  for (const existing of merged.keys()) {
    if (
      existing.length >= 8 &&
      key.length >= 8 &&
      (existing.startsWith(key) || key.startsWith(existing))
    ) {
      return existing;
    }
    const existingSquashed = squashKey(existing);
    if (
      Math.min(existingSquashed.length, squashed.length) >= MIN_SQUASHED_MATCH &&
      (existingSquashed.startsWith(squashed) || squashed.startsWith(existingSquashed))
    ) {
      return existing;
    }
  }
  return null;
}

// ─── Front-matter acceptance test ───────────────────────

/**
 * Is this chapter list credible enough to skip the windowed sweep?
 *
 * Three cheap checks, all of which a real table of contents passes and a
 * hallucinated or truncated list tends to fail:
 *
 *   1. More than one chapter — a single "Chapter 1" usually means the model
 *      found no contents page and described the opening section instead.
 *   2. Numbering starts at 1 and never goes backwards — a real contents page is
 *      ordered; invented lists tend not to be.
 *   3. Most titles actually appear in the document. A contents page lists real
 *      headings, so they can be located further in. This is the check that
 *      catches fabrication.
 */
function looksComplete(
  chapters: DetectedChapter[],
  bodyIndexOf: (title: string) => number
): boolean {
  if (chapters.length < MIN_CHAPTERS_FOR_CONFIDENCE) return false;

  const numbers = chapters.map((c) => c.chapterNumber);
  if (numbers[0] !== 1) return false;
  for (let i = 1; i < numbers.length; i++) {
    if (numbers[i] <= numbers[i - 1]) return false;
  }

  const locatable = chapters.filter((c) =>
    Number.isFinite(bodyIndexOf(c.title))
  ).length;

  return locatable / chapters.length >= MIN_LOCATABLE_RATIO;
}

// ─── Main entry ─────────────────────────────────────────

export async function detectChaptersFullText(opts: {
  content: string;
  subject: string;
  grade: number;
  language?: string;
  /**
   * Provider call, injectable so the three detection paths (front matter
   * accepted / front matter rejected / no provider reachable) can be tested
   * without spending quota. Defaults to the real chain.
   */
  detect?: typeof detectChapters;
}): Promise<ChapterDetectionResult> {
  const { content, subject, grade, language } = opts;
  const detect = opts.detect ?? detectChapters;
  const warnings: string[] = [];

  // One normalised index over the document, shared by every lookup below and
  // matching the one `splitTextByChapters` uses, so detection and splitting
  // can never disagree about where a title lives.
  const locate = createTitleLocator(content);
  const frontMatterEnd = detectFrontMatterEnd(content);

  /**
   * Where a chapter's body actually begins — its first occurrence past the
   * contents page. Infinity when the title appears nowhere.
   *
   * The previous implementation searched the RAW text for the first match,
   * which is the contents-page entry in any book that has one. On a measured
   * Grade 10 Mathematics textbook this was worse still: six of seven titles
   * matched inside a single preface sentence ("this textbook has 7 units
   * namely: Relations and Functions, Polynomial functions, …"), so all six
   * resolved to positions 2554–2694 — a 140-character span — and the chapter
   * order came out of that sentence rather than out of the book.
   */
  const bodyIndexOf = (title: string): number => {
    const all = locate(title);
    if (all.length === 0) return Number.POSITIVE_INFINITY;
    return all.find((p) => p > frontMatterEnd) ?? all[0];
  };

  // A title the contents page misspells can't be found in the body: Grade 10
  // Chemistry lists Unit 2 as "SOLLUTIONS" while the unit itself is headed
  // "SOLUTIONS", so the split fell back to halving Unit 1. Take the body's
  // spelling when one heading line is a near-exact match.
  const repairTitles = (chapters: DetectedChapter[]): DetectedChapter[] =>
    chapters.map((ch) => {
      // Found past the opening pages: fine. A title seen only on the contents
      // page (its every occurrence within the first few percent of the book)
      // is a title the body spells differently.
      const seen = locate(ch.title);
      const lastSeen = seen.length ? seen[seen.length - 1] : -1;
      if (lastSeen > Math.max(frontMatterEnd, content.length * CONTENTS_PAGE_SHARE)) return ch;
      const fixed = nearMatchingHeading(content, ch.title, Math.max(frontMatterEnd, lastSeen + 1));
      if (!fixed) return ch;
      console.log(`[ChapterDetect] "${ch.title}" not found; using the body heading "${fixed}".`);
      return { ...ch, title: fixed };
    });

  const aiChapters: DetectedChapter[] = [];
  let provider = "none";
  let strategy: DetectionStrategy = "none";
  let windowsScanned = 0;
  // Distinguishes "the model answered, but the answer looks wrong" from "no
  // provider could be reached at all". Only the first justifies windowing.
  let frontMatterAnswered = false;

  // ── Pass 1: front matter — ONE call over the opening pages ──────────────
  // This is the common path. The table of contents lives here, so the model
  // reads a list rather than hunting for headings across hundreds of pages.
  try {
    const result = await detect({
      content: compressFrontMatter(content.slice(0, FRONT_MATTER_CHARS)),
      subject,
      grade,
      language,
    });
    provider = result.provider;
    windowsScanned = 1;
    frontMatterAnswered = true;

    const chapters = repairTitles(result.chapters);
    if (looksComplete(chapters, bodyIndexOf)) {
      aiChapters.push(...chapters);
      strategy = "front-matter";
      console.log(
        `[ChapterDetect] Front matter gave ${chapters.length} chapters via ${provider} — skipping the windowed sweep.`
      );
    } else {
      console.warn(
        `[ChapterDetect] Front matter returned ${result.chapters.length} chapter(s) that failed the ` +
        `completeness check.`
      );
    }
  } catch (err) {
    // Every provider failed — almost always rate limits or exhausted quota.
    console.warn(
      `[ChapterDetect] Front-matter detection could not reach any AI provider ` +
      `(${err instanceof Error ? err.message : err}).`
    );
    warnings.push(
      "No AI provider was reachable for chapter detection (usually a rate limit or exhausted " +
      "daily quota). Chapters were identified from the document's own headings instead — " +
      "review the split before saving, or retry once quota resets."
    );
  }

  // ── Pass 2: deterministic scan of the entire document ───────────────────
  //
  // Contents-page entries are dropped BEFORE the sequence filter runs.
  // `filterToDominantSequence` keeps only headings whose numbers ascend through
  // the document, and a contents page wrecks that ordering: in this Grade 10
  // Mathematics textbook its layout put units 1, 4, 5, 6 and 7 on the contents
  // page but broke 2 and 3 across lines, so the scan saw 1,4,5,6,7 at the front
  // and the real body headings for 2 and 3 a hundred thousand characters later
  // — not ascending, so both were discarded. The scan could then never recover
  // a unit the model had missed, which is the whole point of running it.
  //
  // Run before the windowed sweep so a complete scan can make that sweep
  // unnecessary.
  const rawScan = scanHeadingCandidates(content);
  const bodyScan = rawScan.filter((c) => c.index > frontMatterEnd);
  const scanned = filterToDominantSequence(
    // Keep the unfiltered set if the cutoff leaves too little to work with —
    // a book whose only chapter headings ARE its contents page.
    bodyScan.length >= 2 ? bodyScan : rawScan
  );

  // Every unit from 1 to N found, each with a title. Grade 9 Geography has no
  // contents page, so the front-matter pass fails there — but its headings
  // give all 8 units, and the 8-call windowed sweep added nothing but noise.
  const scanIsComplete =
    scanned.length >= MIN_CHAPTERS_FOR_CONFIDENCE &&
    scanned.every((c, i) => c.number === i + 1 && /:\s*\S/.test(c.title));

  // ── Pass 1b: windowed sweep — FALLBACK ONLY ─────────────────────────────
  // Reserved for documents the front matter DESCRIBED BADLY: scanned books
  // whose OCR mangled the contents page, or books with no contents page.
  //
  // Deliberately NOT run when the front-matter call failed outright. That
  // failure means no provider could be reached — and answering "every provider
  // is rate-limited" with sixteen more calls to those same providers turns one
  // failed request into dozens, which is exactly what made a 400-page upload
  // hang for over thirty minutes. When nothing is reachable, fall through to
  // the free deterministic scan instead.
  if (scanIsComplete && strategy !== "front-matter") {
    console.log(
      `[ChapterDetect] No usable contents page, but the headings give units 1–${scanned.length} — skipping the windowed sweep.`
    );
  }
  if (
    frontMatterAnswered &&
    strategy !== "front-matter" &&
    !scanIsComplete &&
    content.length > FRONT_MATTER_CHARS
  ) {
    const windows: string[] = [];
    const stride = WINDOW_CHARS - WINDOW_OVERLAP_CHARS;
    for (let start = 0; start < content.length; start += stride) {
      windows.push(content.slice(start, start + WINDOW_CHARS));
      if (start + WINDOW_CHARS >= content.length) break;
    }

    let failedWindows = 0;
    for (const [i, window] of windows.entries()) {
      try {
        const result = await detect({ content: window, subject, grade, language });
        provider = result.provider;
        aiChapters.push(...repairTitles(result.chapters));
      } catch (err) {
        failedWindows++;
        console.warn(
          `[ChapterDetect] Window ${i + 1}/${windows.length} failed:`,
          err instanceof Error ? err.message : err
        );
      }
    }

    windowsScanned = windows.length;
    strategy = "windowed";
    warnings.push(
      `The contents page could not be read, so all ${windows.length} sections of the book were scanned. ` +
      `Review the chapter split carefully before saving.`
    );
    if (failedWindows > 0) {
      warnings.push(
        `${failedWindows} of ${windows.length} detection windows failed — some chapters may be missing.`
      );
    }
  }

  // ── Merge (union, AI titles preferred) ──────────────────────────────────
  //
  // `rank` fixes the output order. For AI chapters it is the position the
  // model gave them, because that comes from the book's own contents page and
  // is authoritative — deriving order from text positions instead is what
  // demoted Unit 2 ("Polynomial Functions") to chapter 8 on a real upload,
  // simply because a line break hid it from the preface sentence the other six
  // titles were being ordered by. Scan-recovered chapters have no such
  // authority, so they are slotted in by body position with a fractional rank.
  const merged = new Map<string, { title: string; index: number; rank: number }>();

  // Only accept an AI title that can actually be located in the document.
  //
  // Models hallucinate chapter lists — one NIM model, asked to detect two
  // units, invented "UNIT 5: ???" through "UNIT 18: ???". Unioning passes makes
  // that worse, since a single bad window would inject phantom chapters into
  // the merged result. Requiring the title to be findable is a principled
  // filter: `splitTextByChapters` cannot assign content to a title it can't
  // locate anyway, so an unlocatable chapter is useless even when it is real.
  let rejectedHallucinations = 0;
  let aiRank = 0;
  // Chapter numbers the accepted AI list already covers.
  const aiNumbers = new Set<number>();
  for (const ch of [...aiChapters].sort((a, b) => a.chapterNumber - b.chapterNumber)) {
    const key = normaliseTitle(ch.title);
    if (!key || findExistingKey(merged, key)) continue;

    const index = bodyIndexOf(ch.title);
    if (!Number.isFinite(index)) {
      rejectedHallucinations++;
      continue;
    }
    merged.set(key, { title: ch.title, index, rank: aiRank++ });
    aiNumbers.add(ch.chapterNumber);
  }

  if (rejectedHallucinations > 0) {
    console.warn(
      `[ChapterDetect] Discarded ${rejectedHallucinations} AI-proposed chapter(s) whose titles ` +
      `do not appear in the document (likely hallucinated).`
    );
  }

  // Body positions of the AI chapters, in AI order — the ruler a scan-recovered
  // chapter is measured against to find which two AI chapters it falls between.
  const aiPositions = [...merged.values()]
    .sort((a, b) => a.rank - b.rank)
    .map((c) => c.index);

  let recoveredByScan = 0;
  for (const cand of scanned) {
    // An untitled heading ("Unit 3") normalises to nothing; key it by its
    // label so it can still recover a unit — the position check below keeps
    // it from duplicating one the AI already found.
    const key = normaliseTitle(cand.title) || `${cand.kind} ${cand.number}`;
    if (!key) continue;
    // The AI's contents-page title is richer than a body heading, so an
    // already-present chapter wins and the scan entry is dropped.
    const existingKey = findExistingKey(merged, key);
    if (existingKey) {
      // Without a contents page the AI title was placed at its first mention,
      // which can be a passing reference in an earlier unit. The heading is
      // where the chapter really starts.
      const existing = merged.get(existingKey);
      if (existing && strategy !== "front-matter") existing.index = cand.index;
      continue;
    }
    // Titles can disagree while the position doesn't: a running header
    // ("UNIT 3 · CHEMISTRY GRADE 11") lands a page into the unit the AI already
    // found under its real name. Two chapter starts this close are one chapter
    // — no real chapter is shorter than a couple of pages.
    if ([...merged.values()].some((c) => Math.abs(c.index - cand.index) < MIN_CHAPTER_CHARS)) continue;
    // Positions can't be trusted for that either: an AI title is placed at its
    // first mention past the contents page, which in Grade 12 Physics is a
    // passing "electromagnetism" in Unit 1 — so the real "Unit 4" heading looked
    // like a new chapter. When the contents page was read and accepted, its
    // numbering is authoritative: "Unit N" with N already listed is that unit.
    if (strategy === "front-matter" && aiNumbers.has(cand.number)) continue;
    // Sits just after the last AI chapter that starts before it. The .5 keeps
    // it between two AI ranks without disturbing their relative order.
    const before = aiPositions.filter((p) => p < cand.index).length;
    merged.set(key, { title: cand.title, index: cand.index, rank: before - 0.5 });
    recoveredByScan++;
  }

  if (merged.size === 0) {
    warnings.push("No chapters detected — the whole document will be treated as one chapter.");
    return {
      chapters: [{ chapterNumber: 1, title: "Full Textbook Content" }],
      provider,
      strategy,
      windowsScanned,
      recoveredByScan: 0,
      suspiciouslyLargeChapters: [],
      warnings,
    };
  }

  // Order by rank (AI order, scan entries slotted in), then renumber.
  //
  // AI order is only authoritative when it came from the contents page. In
  // the windowed sweep each window numbers its own chapters from 1, so sorting
  // by those numbers interleaves windows: on Grade 9 Geography "Climate of
  // Ethiopia" (window 3's chapter 2) landed seventh, and the splitter then
  // merged its text into Unit 1. Without a contents page, book order wins.
  const sorted = [...merged.values()].sort((a, b) =>
    strategy === "front-matter"
      ? a.rank - b.rank || a.index - b.index
      : a.index - b.index
  );
  const ordered: DetectedChapter[] = sorted.map((c, i) => ({ chapterNumber: i + 1, title: c.title }));

  // ── Heading positions ───────────────────────────────────────────────────
  // Where the book's own unit labels pin down every chapter's start, the split
  // cuts there instead of searching for titles (see headingChapterStarts).
  const headingStarts = headingChapterStarts(
    content,
    rawScan,
    ordered.map((c) => c.title),
    frontMatterEnd,
    content.length,
  );
  const headingsUsable = headingStarts !== null;
  if (headingStarts) {
    ordered.forEach((ch, i) => { ch.startIndex = headingStarts[i]; });
  }

  // ── Coverage check ──────────────────────────────────────────────────────
  // A chapter spanning a large share of the book usually means headings inside
  // it were missed. Surfaced rather than silently accepted.
  // Measured where the split will actually cut: at the headings when they are
  // used, otherwise at the located titles.
  const positions = headingsUsable
    ? ordered.map((ch, i) => ({ title: ch.title, index: headingStarts![i] }))
    : [...merged.values()].sort((a, b) => a.index - b.index);
  const suspiciouslyLargeChapters: string[] = [];
  for (let i = 0; i < positions.length; i++) {
    const start = Math.max(0, positions[i].index);
    const end = i + 1 < positions.length ? positions[i + 1].index : content.length;
    if ((end - start) / content.length > SUSPICIOUS_CHAPTER_SHARE) {
      suspiciouslyLargeChapters.push(positions[i].title);
    }
  }
  if (suspiciouslyLargeChapters.length > 0) {
    warnings.push(
      `${suspiciouslyLargeChapters.length} chapter(s) cover more than ` +
      `${Math.round(SUSPICIOUS_CHAPTER_SHARE * 100)}% of the book each — they may contain ` +
      `undetected chapters. Review the split before saving.`
    );
  }

  if (recoveredByScan > 0) {
    console.log(
      `[ChapterDetect] Deterministic scan recovered ${recoveredByScan} chapter(s) the AI windows missed.`
    );
  }

  return {
    chapters: ordered,
    provider,
    strategy: strategy === "none" && scanned.length > 0 ? "scan-only" : strategy,
    windowsScanned,
    recoveredByScan,
    suspiciouslyLargeChapters,
    warnings,
  };
}
