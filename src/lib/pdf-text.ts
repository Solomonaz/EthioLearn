/**
 * Layout-aware PDF text extraction.
 *
 * `pdf-parse` returns a flat string with all glyph positions discarded, which
 * destroys mathematics. Measured on Grade 12 Physics, a formula reading
 * `g = 9.8 m/s²` came out as three separate lines:
 *
 *     "g=9.8m/s"
 *     "2"
 *     "."
 *
 * The exponent survives as a detached `2` on its own line, so a model reading
 * that content cannot tell `m/s²` from `m/s` followed by the number 2 — and a
 * physics question generated from it carries the wrong units. Across the whole
 * book there were ZERO Unicode superscripts: every exponent was in that state.
 *
 * pdf.js exposes what pdf-parse throws away. Each text run carries a transform
 * (x, y) and a height, and a superscript is simply a run that is SMALLER than
 * body text and sits ABOVE the baseline of its neighbour; a subscript is
 * smaller and below. That is enough to put `^` and `_` back deterministically —
 * no AI call, no cost, no guessing.
 *
 * What this does NOT fix: fraction bars (a stacked fraction still linearises
 * badly) and words the PDF genuinely renders without a space between them
 * (`isg=9.8m/s` appears that way in the source). Both were already broken
 * before; this module simply stops making exponents worse.
 */

export interface PdfTextItem {
  str: string;
  /** Horizontal position, from the pdf.js transform matrix. */
  x: number;
  /** Baseline position, from the pdf.js transform matrix. */
  y: number;
  /** Rendered glyph height — the signal that separates a superscript. */
  h: number;
  /** Rendered width, used to detect gaps the text layer omitted. */
  w: number;
}

/** Fraction of body height under which a run counts as super/subscript. */
const SMALL_RATIO = 0.85;
/** Vertical offset (as a fraction of body height) that marks a raised run. */
const RAISE_RATIO = 0.12;
/** Vertical offset that marks a dropped run. Smaller: descenders sit closer. */
const DROP_RATIO = 0.08;
/** Horizontal gap (as a fraction of body height) that implies a missing space. */
const SPACE_RATIO = 0.25;
/** Runs closer than this fraction of body height belong to the same visual line. */
const LINE_RATIO = 0.6;

/**
 * The page's body text height: the most common rounded height, weighted by how
 * many characters use it. Weighting by character count rather than run count
 * stops a page full of short superscripts from being mistaken for body text.
 */
function bodyHeight(items: PdfTextItem[]): number {
  const tally = new Map<number, number>();
  for (const i of items) {
    const key = Math.round(i.h * 2) / 2;
    tally.set(key, (tally.get(key) ?? 0) + i.str.length);
  }
  const best = [...tally.entries()].sort((a, b) => b[1] - a[1])[0];
  return best ? best[0] : 10;
}

/** Group runs into visual lines, top to bottom then left to right. */
function groupLines(items: PdfTextItem[], body: number): PdfTextItem[][] {
  const lines: PdfTextItem[][] = [];
  for (const item of [...items].sort((a, b) => b.y - a.y || a.x - b.x)) {
    const current = lines[lines.length - 1];
    if (current && Math.abs(current[0].y - item.y) < body * LINE_RATIO) current.push(item);
    else lines.push([item]);
  }
  return lines;
}

/**
 * Rebuild one page's text with super/subscripts restored.
 *
 * Exported separately from the pdf.js plumbing so it can be unit-tested on
 * synthetic runs without opening a document.
 */
export function rebuildPageText(items: PdfTextItem[]): string {
  const real = items.filter((i) => i.str.trim() && i.h > 0);
  if (real.length === 0) return "";

  const body = bodyHeight(real);
  const out: string[] = [];

  for (const line of groupLines(real, body)) {
    line.sort((a, b) => a.x - b.x);
    let s = "";

    for (let k = 0; k < line.length; k++) {
      const item = line[k];
      const prev = line[k - 1];

      // Compare against the nearest NORMAL-height run, not the line's highest
      // point. Using the line maximum mislabels every subscript on a line whose
      // tallest element is itself raised — which is most formula lines.
      let ref: PdfTextItem | undefined;
      for (let j = k - 1; j >= 0; j--) {
        if (line[j].h >= body * SMALL_RATIO) { ref = line[j]; break; }
      }
      if (!ref) {
        for (let j = k + 1; j < line.length; j++) {
          if (line[j].h >= body * SMALL_RATIO) { ref = line[j]; break; }
        }
      }

      // Re-insert a space the text layer left out.
      if (prev) {
        const gap = item.x - (prev.x + prev.w);
        if (gap > body * SPACE_RATIO && !s.endsWith(" ")) s += " ";
      }

      const text = item.str.trim();
      const small = item.h < body * SMALL_RATIO;

      // Only digits, letters and sign characters become scripts. Punctuation
      // that happens to render small (a full stop, a comma) must stay literal,
      // or sentences acquire stray carets.
      if (small && ref && /^[\dA-Za-z+\-°ο]+$/.test(text)) {
        const dy = item.y - ref.y;
        if (dy > body * RAISE_RATIO) { s += "^" + text; continue; }
        if (dy < -body * DROP_RATIO) { s += "_" + text; continue; }
      }

      s += item.str;
    }

    const cleaned = s.replace(/[ \t]+/g, " ").trim();
    if (cleaned) out.push(cleaned);
  }

  return out.join("\n");
}

/**
 * Extract a whole PDF's text with mathematics preserved.
 *
 * Returns null when the document yields essentially nothing, so the caller can
 * fall back to `pdf-parse` (and then OCR) rather than treat an empty string as
 * a successful read.
 */
export async function extractPdfTextWithLayout(
  buffer: Buffer
): Promise<{ text: string; pageCount: number } | null> {
  // Imported lazily: pdf.js is heavy, and a text-layer PDF handled by the
  // normal path should not pay for loading it.
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");

  // pdf.js needs the standard-font metrics to map glyphs in documents that use
  // the base-14 fonts without embedding them. Without it, it logs
  // "Ensure that the standardFontDataUrl API parameter is provided" and can
  // mis-map characters — which on a maths book means wrong symbols, silently.
  //
  // Note it must be a plain FILESYSTEM path, not a file:// URL: pdf.js loads
  // this through its Node data factory, which reads from disk directly and
  // cannot fetch a file:// URL.
  let standardFontDataUrl: string | undefined;
  try {
    const { createRequire } = await import("module");
    const req = createRequire(import.meta.url);
    const pkg = req.resolve("pdfjs-dist/package.json");
    standardFontDataUrl = pkg.replace(/package\.json$/, "standard_fonts/");
  } catch {
    // Resolution failure is not fatal — extraction still works, just noisier.
  }

  const doc = await pdfjs.getDocument({
    data: new Uint8Array(buffer),
    // Server-side extraction: no fonts to fetch, no canvas to paint.
    disableFontFace: true,
    isEvalSupported: false,
    ...(standardFontDataUrl ? { standardFontDataUrl } : {}),
  }).promise;

  const pages: string[] = [];
  for (let n = 1; n <= doc.numPages; n++) {
    try {
      const page = await doc.getPage(n);
      const content = await page.getTextContent();
      const items: PdfTextItem[] = (
        content.items as { str: string; transform: number[]; height: number; width: number }[]
      )
        .filter((i) => typeof i.str === "string")
        .map((i) => ({ str: i.str, x: i.transform[4], y: i.transform[5], h: i.height, w: i.width }));
      pages.push(rebuildPageText(items));
      page.cleanup();
    } catch {
      // One unreadable page must not lose the other four hundred.
      pages.push("");
    }
  }

  await doc.destroy().catch(() => undefined);

  const text = pages.join("\n\n").trim();
  if (text.length < 50) return null;
  return { text, pageCount: doc.numPages };
}
