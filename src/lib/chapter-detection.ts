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
    /^[ \t]*(chapter|unit|lesson|section|part|ምዕራፍ|ክፍል)[ \t]+([0-9]{1,2}|[ivxlc]{1,5}|[a-z]+|[፩-፼]{1,3})[ \t]*[-–—.:)]?[ \t]*(.{0,90})$/gim;

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
    candidates.push({
      index: m.index,
      kind: m[1].toLowerCase(),
      number,
      title: title.length >= 3 ? `${capitalise(m[1])} ${number}: ${title}` : `${capitalise(m[1])} ${number}`,
    });
  }

  return candidates;
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

    if (looksComplete(result.chapters, bodyIndexOf)) {
      aiChapters.push(...result.chapters);
      strategy = "front-matter";
      console.log(
        `[ChapterDetect] Front matter gave ${result.chapters.length} chapters via ${provider} — skipping the windowed sweep.`
      );
    } else {
      console.warn(
        `[ChapterDetect] Front matter returned ${result.chapters.length} chapter(s) that failed the ` +
        `completeness check — falling back to a windowed sweep of the whole document.`
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
  if (frontMatterAnswered && strategy !== "front-matter" && content.length > FRONT_MATTER_CHARS) {
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
        aiChapters.push(...result.chapters);
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
  const rawScan = scanHeadingCandidates(content);
  const bodyScan = rawScan.filter((c) => c.index > frontMatterEnd);
  const scanned = filterToDominantSequence(
    // Keep the unfiltered set if the cutoff leaves too little to work with —
    // a book whose only chapter headings ARE its contents page.
    bodyScan.length >= 2 ? bodyScan : rawScan
  );

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
  for (const ch of [...aiChapters].sort((a, b) => a.chapterNumber - b.chapterNumber)) {
    const key = normaliseTitle(ch.title);
    if (!key || findExistingKey(merged, key)) continue;

    const index = bodyIndexOf(ch.title);
    if (!Number.isFinite(index)) {
      rejectedHallucinations++;
      continue;
    }
    merged.set(key, { title: ch.title, index, rank: aiRank++ });
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
    // The AI's contents-page title is richer than a body heading, so an
    // already-present chapter wins and the scan entry is dropped.
    if (!key || findExistingKey(merged, key)) continue;
    // Titles can disagree while the position doesn't: a running header
    // ("UNIT 3 · CHEMISTRY GRADE 11") lands a page into the unit the AI already
    // found under its real name. Two chapter starts this close are one chapter
    // — no real chapter is shorter than a couple of pages.
    if ([...merged.values()].some((c) => Math.abs(c.index - cand.index) < MIN_CHAPTER_CHARS)) continue;
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
  const sorted = [...merged.values()].sort(
    (a, b) => a.rank - b.rank || a.index - b.index
  );
  const ordered = sorted.map((c, i) => ({ chapterNumber: i + 1, title: c.title }));

  // ── Coverage check ──────────────────────────────────────────────────────
  // A chapter spanning a large share of the book usually means headings inside
  // it were missed. Surfaced rather than silently accepted.
  const positions = [...merged.values()].sort((a, b) => a.index - b.index);
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
