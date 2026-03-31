// eslint-disable-next-line @typescript-eslint/no-require-imports
const pdfParse = require("pdf-parse/lib/pdf-parse.js");
import mammoth from "mammoth";

const MAX_FILE_SIZE = 500 * 1024 * 1024; // 50 MB

export interface ExtractionResult {
  text: string;
  pageCount?: number;
  wordCount: number;
}

/**
 * Extract text content from a PDF or DOCX file buffer.
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

  throw new Error(
    `Unsupported file type: .${ext}. Please upload a PDF or DOCX file.`
  );
}

async function extractFromPdf(buffer: Buffer): Promise<ExtractionResult> {
  try {
    const data = await pdfParse(buffer);
    const text = (data.text as string || "").trim();

    if (!text || text.length < 50) {
      throw new Error(
        "Could not extract meaningful text from this PDF. It may be a scanned image. Please try a text-based PDF or DOCX file."
      );
    }

    return {
      text,
      pageCount: data.numpages as number,
      wordCount: text.split(/\s+/).length,
    };
  } catch (error) {
    if (error instanceof Error && error.message.includes("extract meaningful")) {
      throw error;
    }
    throw new Error(
      `Failed to parse PDF: ${error instanceof Error ? error.message : "Unknown error"}`
    );
  }
}

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
    };
  } catch (error) {
    if (error instanceof Error && error.message.includes("extract meaningful")) {
      throw error;
    }
    throw new Error(
      `Failed to parse document: ${error instanceof Error ? error.message : "Unknown error"}`
    );
  }
}
