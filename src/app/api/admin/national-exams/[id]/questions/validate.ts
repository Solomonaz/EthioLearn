import { OPTION_LETTERS } from "@/lib/national-exam";

export interface QuestionInput {
  number?: number;
  questionText?: string;
  options?: string[];
  correctAnswer?: string | null;
  explanation?: string | null;
  needsReview?: boolean;
}

/**
 * Validate an admin's question edit. With `full`, text and options are
 * required (a new question); otherwise only the fields present are checked.
 * The correct answer must be one of the options, compared after trimming.
 */
export function validateQuestionInput(
  body: Record<string, unknown>,
  full: boolean,
): { ok: true; data: QuestionInput } | { ok: false; error: string } {
  const data: QuestionInput = {};

  if (body.number !== undefined && body.number !== null && body.number !== "") {
    const n = Number(body.number);
    if (!Number.isInteger(n) || n < 1 || n > 300) return { ok: false, error: "Question number must be 1–300." };
    data.number = n;
  }
  if (body.questionText !== undefined || full) {
    const t = typeof body.questionText === "string" ? body.questionText.trim() : "";
    if (!t) return { ok: false, error: "Question text is required." };
    data.questionText = t.slice(0, 10_000);
  }
  if (body.options !== undefined || full) {
    const opts = Array.isArray(body.options) ? body.options.map((o) => String(o ?? "").trim()) : [];
    if (opts.length < 2 || opts.length > OPTION_LETTERS.length) {
      return { ok: false, error: `A question needs 2 to ${OPTION_LETTERS.length} options.` };
    }
    if (opts.some((o) => !o)) return { ok: false, error: "Options cannot be empty." };
    if (new Set(opts.map((o) => o.toLowerCase())).size !== opts.length) return { ok: false, error: "Options must all be different." };
    data.options = opts.map((o) => o.slice(0, 2000));
  }
  if (body.correctAnswer !== undefined) {
    data.correctAnswer = body.correctAnswer === null || body.correctAnswer === "" ? null : String(body.correctAnswer).trim();
  }
  if (body.explanation !== undefined) {
    const e = typeof body.explanation === "string" ? body.explanation.trim() : "";
    data.explanation = e ? e.slice(0, 5000) : null;
  }
  if (body.needsReview !== undefined) data.needsReview = body.needsReview === true;
  return { ok: true, data };
}
