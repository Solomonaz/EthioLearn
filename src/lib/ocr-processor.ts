/**
 * OCR Processor — §4.4.2
 *
 * Handles scanned/image-based PDFs using Tesseract.js OCR.
 * Provides per-page confidence scoring and flags pages < 80%.
 *
 * Uses pdf-img-convert (already installed) to convert PDF pages to images,
 * then runs Tesseract.js OCR on each page.
 */

// ─── Types ──────────────────────────────────────────────

export interface PageOcrResult {
  page: number;
  text: string;
  confidence: number; // 0-100 percentage
  flagged: boolean; // true if confidence < 80%
}

export interface OcrExtractionResult {
  text: string;
  pageCount: number;
  wordCount: number;
  pageResults: PageOcrResult[];
  averageConfidence: number;
  flaggedPages: number[];
}

// ─── Constants ──────────────────────────────────────────

const OCR_CONFIDENCE_THRESHOLD = 80; // Pages below this are flagged
const MAX_PAGES_FOR_OCR = 100; // Safety limit

// ─── Main OCR Function ─────────────────────────────────

/**
 * Extract text from a scanned PDF using OCR with confidence scoring.
 *
 * Flow:
 * 1. Convert PDF pages to images via pdf-img-convert
 * 2. Run Tesseract.js OCR on each image
 * 3. Compute per-page confidence scores
 * 4. Flag pages with confidence < 80%
 */
export async function extractTextWithOcr(
  pdfBuffer: Buffer
): Promise<OcrExtractionResult> {
  // Dynamic imports to avoid loading these heavy modules unless needed
  const pdfImgConvert = await import("pdf-img-convert");
  const Tesseract = await import("tesseract.js");

  // 1. Convert PDF to images
  let pageImages: Uint8Array[];
  try {
    const result = await pdfImgConvert.convert(pdfBuffer, {
      width: 1200, // Good balance of quality vs speed
      height: 1600,
    });
    pageImages = result.slice(0, MAX_PAGES_FOR_OCR) as Uint8Array[];
  } catch (error) {
    throw new Error(
      `Failed to convert PDF to images for OCR: ${
        error instanceof Error ? error.message : "Unknown error"
      }`
    );
  }

  if (pageImages.length === 0) {
    throw new Error("PDF contains no pages that could be converted to images.");
  }

  // 2. Create Tesseract worker
  const worker = await Tesseract.createWorker("eng+amh");

  const pageResults: PageOcrResult[] = [];
  const allTexts: string[] = [];

  try {
    // 3. Process each page
    for (let i = 0; i < pageImages.length; i++) {
      try {
        const imageBuffer = Buffer.from(pageImages[i]);
        const {
          data: { text, confidence },
        } = await worker.recognize(imageBuffer);

        const pageConfidence = confidence ?? 0;
        const pageText = text?.trim() ?? "";
        const flagged = pageConfidence < OCR_CONFIDENCE_THRESHOLD;

        pageResults.push({
          page: i + 1,
          text: pageText,
          confidence: Math.round(pageConfidence * 100) / 100,
          flagged,
        });

        if (pageText.length > 0) {
          allTexts.push(pageText);
        }
      } catch (pageError) {
        console.error(`[OCR] Failed to process page ${i + 1}:`, pageError);
        pageResults.push({
          page: i + 1,
          text: "",
          confidence: 0,
          flagged: true,
        });
      }
    }
  } finally {
    await worker.terminate();
  }

  // 4. Compute aggregate results
  const fullText = allTexts.join("\n\n");
  const totalConfidence = pageResults.reduce((sum, p) => sum + p.confidence, 0);
  const averageConfidence =
    pageResults.length > 0
      ? Math.round((totalConfidence / pageResults.length) * 100) / 100
      : 0;

  const flaggedPages = pageResults
    .filter((p) => p.flagged)
    .map((p) => p.page);

  return {
    text: fullText,
    pageCount: pageResults.length,
    wordCount: fullText.split(/\s+/).filter(Boolean).length,
    pageResults,
    averageConfidence,
    flaggedPages,
  };
}
