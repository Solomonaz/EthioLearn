// eslint-disable-next-line @typescript-eslint/no-require-imports
const pdfParse = require("pdf-parse/lib/pdf-parse.js");
import mammoth from "mammoth";
import { extractPdfTextWithLayout } from "./pdf-text";

const MAX_FILE_SIZE = 500 * 1024 * 1024; // 500 MB

// ─── Types ──────────────────────────────────────────────

export interface PageOcrInfo {
  page: number;
  confidence: number;
  flagged: boolean;
}

export interface ExtractionResult {
  text: string;
  pageCount?: number;
  wordCount: number;
  /** True when OCR was used (scanned PDF) */
  usedOcr?: boolean;
  /** Average OCR confidence (0-100), only set when usedOcr=true */
  ocrConfidence?: number;
  /** Pages with OCR confidence < 80%, flagged for manual review */
  flaggedPages?: number[];
  /** Per-page OCR details, only set when usedOcr=true */
  pageOcrDetails?: PageOcrInfo[];
  /** True when the PDF exceeded the OCR page cap and pages were NOT read. */
  truncated?: boolean;
  /** How many trailing pages were skipped by the OCR cap. */
  pagesSkipped?: number;
  /** Human-readable warnings to show the admin after upload. */
  warnings?: string[];
}

// ─── Main Entry ─────────────────────────────────────────

/**
 * Extract text content from a PDF, DOCX, or EPUB file buffer.
 */
export async function extractTextFromFile(
  buffer: Buffer,
  fileName: string
): Promise<ExtractionResult> {
  if (buffer.length > MAX_FILE_SIZE) {
    throw new Error(
      `File too large. Maximum size is ${MAX_FILE_SIZE / (1024 * 1024)} MB.`
    );
  }

  const ext = fileName.toLowerCase().split(".").pop();

  if (ext === "pdf") {
    return extractFromPdf(buffer);
  }

  if (ext === "docx" || ext === "doc") {
    return extractFromDocx(buffer);
  }

  if (ext === "epub") {
    return extractFromEpub(buffer);
  }

  throw new Error(
    `Unsupported file type: .${ext}. Please upload a PDF, DOCX, or EPUB file.`
  );
}

// ─── PDF Extraction (with OCR fallback) ─────────────────

/**
 * Chars per page under which a PDF is treated as scanned.
 *
 * The previous test was `text.length >= 50` for the WHOLE document, which is
 * not a density test at all. A 426-page scanned Grade 12 Mathematics book
 * yielded 2,251 characters — its cover plus the "take care of this book"
 * notice — comfortably clearing 50, so OCR never ran and chapter detection was
 * handed a cover page. Every provider then correctly reported "no chapters",
 * and the real fault (no text layer) was invisible.
 *
 * Measured densities: digital Physics 1,566 chars/page, digital Grade 10
 * Mathematics 1,126, scanned Grade 12 Mathematics 5. A threshold of 100
 * separates those by an order of magnitude in both directions.
 */
const MIN_CHARS_PER_PAGE = 100;

async function extractFromPdf(buffer: Buffer): Promise<ExtractionResult> {
  try {
    const data = await pdfParse(buffer);
    const flat = ((data.text as string) || "").trim();
    const pageCount = (data.numpages as number) || 1;
    const perPage = flat.length / Math.max(1, pageCount);

    if (flat.length >= 50 && perPage >= MIN_CHARS_PER_PAGE) {
      // There IS a text layer. Re-extract it with glyph positions so exponents
      // and subscripts survive — pdf-parse discards them, which silently
      // corrupts every formula. Falls back to the flat text if that fails.
      let text = flat;
      try {
        const laidOut = await extractPdfTextWithLayout(buffer);
        if (laidOut && laidOut.text.length >= flat.length * 0.5) {
          text = laidOut.text;
          console.log(
            `[Extract] Layout-aware extraction used (${text.length.toLocaleString()} chars, ` +
              `${Math.round(perPage)} chars/page) — super/subscripts preserved.`
          );
        }
      } catch (e) {
        console.warn(
          `[Extract] Layout-aware extraction failed, using flat text: ${e instanceof Error ? e.message : String(e)}`
        );
      }

      return {
        text,
        pageCount,
        wordCount: text.split(/\s+/).length,
        usedOcr: false,
      };
    }

    // Too little text for the page count: the pages are images, not text.
    console.log(
      `[Extract] PDF yielded ${flat.length} chars over ${pageCount} page(s) ` +
        `(${perPage.toFixed(1)}/page, below ${MIN_CHARS_PER_PAGE}) — treating as scanned, attempting OCR...`
    );
    return await extractFromPdfWithOcr(buffer);
  } catch (error) {
    if (error instanceof Error && error.message.includes("extract meaningful")) {
      throw error;
    }

    // pdfParse itself failed — try OCR as last resort
    console.log("[Extract] pdfParse failed — attempting OCR fallback...");
    try {
      return await extractFromPdfWithOcr(buffer);
    } catch {
      throw new Error(
        `Failed to parse PDF: ${
          error instanceof Error ? error.message : "Unknown error"
        }`
      );
    }
  }
}

// ─── OCR Fallback for Scanned PDFs ──────────────────────

async function extractFromPdfWithOcr(
  buffer: Buffer
): Promise<ExtractionResult> {
  try {
    const { extractTextWithOcr } = await import("./ocr-processor");
    const ocrResult = await extractTextWithOcr(buffer);

    if (!ocrResult.text || ocrResult.text.length < 50) {
      throw new Error(
        "OCR could not extract meaningful text from this PDF. The document may be blank or very low quality."
      );
    }

    const warnings: string[] = [];
    if (ocrResult.truncated) {
      warnings.push(
        `Only the first ${ocrResult.pageCount} of ${ocrResult.totalPagesInDocument} pages were read — ` +
        `${ocrResult.pagesSkipped} page(s) were skipped by the OCR limit. Split this file and upload the rest separately.`
      );
    }
    if (ocrResult.flaggedPages.length > 0) {
      warnings.push(
        `${ocrResult.flaggedPages.length} page(s) scanned below 80% OCR confidence and may contain errors.`
      );
    }

    return {
      text: ocrResult.text,
      pageCount: ocrResult.pageCount,
      wordCount: ocrResult.wordCount,
      usedOcr: true,
      ocrConfidence: ocrResult.averageConfidence,
      flaggedPages: ocrResult.flaggedPages,
      truncated: ocrResult.truncated,
      pagesSkipped: ocrResult.pagesSkipped,
      warnings,
      pageOcrDetails: ocrResult.pageResults.map((p) => ({
        page: p.page,
        confidence: p.confidence,
        flagged: p.flagged,
      })),
    };
  } catch (error) {
    if (
      error instanceof Error &&
      (error.message.includes("OCR could not") ||
        error.message.includes("extract meaningful"))
    ) {
      throw error;
    }
    throw new Error(
      `OCR processing failed: ${
        error instanceof Error ? error.message : "Unknown error"
      }`
    );
  }
}

// ─── DOCX Extraction ────────────────────────────────────

async function extractFromDocx(buffer: Buffer): Promise<ExtractionResult> {
  try {
    const result = await mammoth.extractRawText({ buffer });
    const text = (result.value || "").trim();

    if (!text || text.length < 50) {
      throw new Error(
        "Could not extract meaningful text from this document. The file may be empty or corrupted."
      );
    }

    return {
      text,
      wordCount: text.split(/\s+/).length,
      usedOcr: false,
    };
  } catch (error) {
    if (error instanceof Error && error.message.includes("extract meaningful")) {
      throw error;
    }
    throw new Error(
      `Failed to parse document: ${
        error instanceof Error ? error.message : "Unknown error"
      }`
    );
  }
}

// ─── EPUB Extraction — §4.4.1 ───────────────────────────

async function extractFromEpub(buffer: Buffer): Promise<ExtractionResult> {
  try {
    const EPub = (await import("epub2")).default;
    const fs = await import("fs");
    const path = await import("path");
    const os = await import("os");

    // epub2 requires a file path — write buffer to a temp file
    const tmpDir = os.tmpdir();
    const tmpFile = path.join(tmpDir, `abugida_epub_${Date.now()}.epub`);
    fs.writeFileSync(tmpFile, buffer);

    try {
      const epub = await EPub.createAsync(tmpFile);

      // Get the reading order (spine)
      const chapters: string[] = [];

      // epub.flow contains the reading order
      const flow = epub.flow || [];

      for (const item of flow) {
        try {
          const chapterText: string = await new Promise((resolve, reject) => {
            epub.getChapter(item.id, (error: Error | null, text: string) => {
              if (error) reject(error);
              else resolve(text || "");
            });
          });

          // Strip HTML tags to get plain text
          const plainText = stripHtml(chapterText).trim();
          if (plainText.length > 10) {
            chapters.push(plainText);
          }
        } catch {
          // Skip chapters that fail to parse
          continue;
        }
      }

      const fullText = chapters.join("\n\n");

      if (!fullText || fullText.length < 50) {
        throw new Error(
          "Could not extract meaningful text from this EPUB. The file may be empty or use unsupported formatting."
        );
      }

      return {
        text: fullText,
        wordCount: fullText.split(/\s+/).length,
        usedOcr: false,
      };
    } finally {
      // Clean up temp file
      try {
        fs.unlinkSync(tmpFile);
      } catch {
        // Ignore cleanup errors
      }
    }
  } catch (error) {
    if (error instanceof Error && error.message.includes("extract meaningful")) {
      throw error;
    }
    throw new Error(
      `Failed to parse EPUB: ${
        error instanceof Error ? error.message : "Unknown error"
      }`
    );
  }
}

/**
 * Strip HTML tags from a string, preserving text content.
 * Also decodes common HTML entities.
 */
function stripHtml(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n\n")
    .replace(/<\/div>/gi, "\n")
    .replace(/<\/h[1-6]>/gi, "\n\n")
    .replace(/<\/li>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
