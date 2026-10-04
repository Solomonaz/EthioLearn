import { randomUUID } from "crypto";
import { mkdir, readFile, unlink, writeFile } from "fs/promises";
import path from "path";
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { UPLOAD_ROOT, detectType } from "@/lib/uploads";
import { extractTextFromFile } from "@/lib/extract-text";
import { readTextbookFile } from "@/lib/textbook-ingest";
import { extractJson } from "@/lib/question-validation";
import { runTask } from "@/lib/ai-routing";
import { geminiChat } from "@/lib/gemini";
import { openRouterChat } from "@/lib/openrouter";
import { groqChat } from "@/lib/groq";

/**
 * Grade 12 national exam: past papers uploaded by the super admin.
 *
 * Flow: upload PDF → `extractNationalExam` (background) reads the text, asks
 * the model for the questions window by window, applies the paper's answer
 * key, and asks for an explanation of every answer → status REVIEW. The admin
 * checks and fixes the questions, then publishes. Students never see a paper
 * in EXTRACTING or REVIEW.
 *
 * Every question the model could not settle from the paper itself — no answer
 * in the key, a disagreement with the key, a figure it cannot see — is marked
 * `needsReview` with the reason, so review starts from the doubtful ones.
 */

export const EXAM_STREAMS = ["NATURAL", "SOCIAL"] as const;
export const OPTION_LETTERS = ["A", "B", "C", "D", "E", "F"];

// ─── Figure images ───────────────────────────────────────

const IMAGE_DIR = path.join(UPLOAD_ROOT, "exam-images");
const IMAGE_EXTS = ["jpg", "png", "webp"];
export const MAX_EXAM_IMAGE_BYTES = 5 * 1024 * 1024;

export const IMAGE_CONTENT_TYPES: Record<string, string> = {
  jpg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
};

/** Store a figure for a question. Returns the generated key. */
export async function storeExamImage(buf: Buffer, originalName: string): Promise<string> {
  if (buf.length === 0) throw new Error("That file is empty.");
  if (buf.length > MAX_EXAM_IMAGE_BYTES) throw new Error("Image too large. The limit is 5 MB.");
  const detected = detectType(buf, originalName);
  if (!detected.ok || !IMAGE_EXTS.includes(detected.type.ext)) {
    throw new Error("Please upload a JPG, PNG or WebP image.");
  }
  await mkdir(IMAGE_DIR, { recursive: true });
  const key = `${randomUUID()}.${detected.type.ext}`;
  await writeFile(path.join(IMAGE_DIR, key), buf);
  return key;
}

function imagePath(key: string): string {
  if (!/^[0-9a-f-]{36}\.(jpg|png|webp)$/.test(key)) throw new Error("Invalid image key");
  return path.join(IMAGE_DIR, key);
}

export async function readExamImage(key: string): Promise<Buffer> {
  return readFile(imagePath(key));
}

export async function deleteExamImage(key: string | null | undefined): Promise<void> {
  if (!key) return;
  try {
    await unlink(imagePath(key));
  } catch {
    /* already gone */
  }
}

// ─── Model calls ─────────────────────────────────────────

const FEATURE = "exam-extraction" as const;

/** One JSON completion on the exam-extraction chain. */
async function askJson(prompt: string, maxTokens: number): Promise<unknown> {
  const parse = (raw: string | null) => {
    if (!raw) return null;
    try {
      return extractJson(raw);
    } catch {
      return null;
    }
  };
  const { value } = await runTask<unknown>(
    "exam-extraction",
    {
      GEMINI: async () => parse(await geminiChat(prompt, { maxTokens, temperature: 0.1, feature: FEATURE })),
      OPENROUTER: async () => parse(await openRouterChat(prompt, { maxTokens, temperature: 0.1, feature: FEATURE })),
      GROQ: async () =>
        parse(await groqChat(prompt, { maxTokens, temperature: 0.1, feature: FEATURE, responseFormat: { type: "json_object" } })),
    },
    { accept: (v) => !!v && typeof v === "object" },
  );
  return value;
}

// ─── Extraction ──────────────────────────────────────────

interface RawQuestion {
  number: number;
  question: string;
  options: string[];
  answer: string | null; // letter
  mentionsFigure: boolean;
}

const WINDOW_CHARS = 12_000;
const WINDOW_OVERLAP = 1_500;

/** Split on line boundaries into overlapping windows, so no question is cut in half everywhere. */
function windows(text: string): string[] {
  const out: string[] = [];
  let start = 0;
  while (start < text.length) {
    let end = Math.min(text.length, start + WINDOW_CHARS);
    if (end < text.length) {
      const nl = text.lastIndexOf("\n", end);
      if (nl > start + WINDOW_CHARS / 2) end = nl;
    }
    out.push(text.slice(start, end));
    if (end >= text.length) break;
    start = Math.max(end - WINDOW_OVERLAP, start + 1);
  }
  return out;
}

function extractionPrompt(subject: string, chunk: string): string {
  return `You are digitising a past Ethiopian Grade 12 national exam (ESSLCE) paper in ${subject}.
Below is a section of the paper's text, possibly from OCR, so it may contain spacing errors and stray characters.

Extract EVERY multiple-choice question that appears in this section. Rules:
- Keep each question's wording as printed. Only fix obvious OCR spacing and broken words.
- "options": the option texts in printed order WITHOUT their letter labels (no "A." or "(B)").
- If a question depends on shared material printed before a group of questions (a reading passage, a table, data, a scenario), copy that shared material at the start of EACH dependent question's text, so the question can be read on its own.
- Write mathematics in LaTeX between \\( and \\), e.g. \\(x^2 + 3x\\), \\(\\frac{1}{2}\\).
- "answer": the correct option letter ONLY if this section shows it (e.g. an answer key); otherwise null. Never guess.
- "mentionsFigure": true if the question needs a diagram, graph or picture that the text cannot show.
- Skip instructions, headers, page numbers and anything that is not a question.
- If the section contains an answer key (a list like "1. B  2. D ..."), also return it in "answerKey".
- If a question is cut off at the start or end of the section, skip it.

Return ONLY JSON in this shape:
{"questions":[{"number":1,"question":"...","options":["...","...","...","..."],"answer":null,"mentionsFigure":false}],"answerKey":[{"number":1,"letter":"B"}]}

PAPER SECTION:
"""
${chunk}
"""`;
}

function cleanOption(s: string): string {
  return s.replace(/^\s*\(?[A-Fa-f][.)]\s+/, "").trim();
}

function toRawQuestions(value: unknown): { questions: RawQuestion[]; key: Map<number, string> } {
  const v = value as { questions?: unknown[]; answerKey?: unknown[] };
  const questions: RawQuestion[] = [];
  for (const q of Array.isArray(v?.questions) ? v.questions : []) {
    const r = q as Record<string, unknown>;
    const number = Number(r.number);
    const question = typeof r.question === "string" ? r.question.trim() : "";
    const options = Array.isArray(r.options) ? r.options.map((o) => cleanOption(String(o))).filter(Boolean) : [];
    if (!Number.isInteger(number) || number < 1 || number > 300 || !question || options.length < 2) continue;
    const letter = typeof r.answer === "string" ? r.answer.trim().toUpperCase().slice(0, 1) : "";
    questions.push({
      number,
      question,
      options: options.slice(0, OPTION_LETTERS.length),
      answer: OPTION_LETTERS.includes(letter) ? letter : null,
      mentionsFigure: r.mentionsFigure === true,
    });
  }
  const key = new Map<number, string>();
  for (const k of Array.isArray(v?.answerKey) ? v.answerKey : []) {
    const r = k as Record<string, unknown>;
    const n = Number(r.number);
    const letter = typeof r.letter === "string" ? r.letter.trim().toUpperCase().slice(0, 1) : "";
    if (Number.isInteger(n) && OPTION_LETTERS.includes(letter)) key.set(n, letter);
  }
  return { questions, key };
}

interface Explained {
  letter: string | null;
  explanation: string | null;
  disagrees: boolean;
}

/** Ask for the answer (when unknown) and an explanation, a batch at a time. */
async function explainBatch(subject: string, batch: RawQuestion[]): Promise<Map<number, Explained>> {
  const items = batch.map((q) => ({
    number: q.number,
    question: q.question,
    options: q.options.map((o, i) => `${OPTION_LETTERS[i]}. ${o}`),
    knownAnswer: q.answer,
  }));
  const prompt = `You are an experienced Ethiopian Grade 12 ${subject} teacher preparing answers for a past national exam.
For each question:
- If "knownAnswer" is given, it comes from the official answer key: explain why it is correct. If you are confident it is wrong, still explain the correct one, set "letter" to the option you believe is correct and "disagrees": true.
- If "knownAnswer" is null, solve the question and give the correct option letter.
- "explanation": 1–3 sentences a student can learn from. Use LaTeX between \\( and \\) for maths.
- If a question cannot be answered without a missing figure, set "letter" to null and say so in the explanation.

Questions:
${JSON.stringify(items)}

Return ONLY JSON: {"answers":[{"number":1,"letter":"B","explanation":"...","disagrees":false}]}`;
  const out = new Map<number, Explained>();
  try {
    const value = (await askJson(prompt, 8192)) as { answers?: unknown[] };
    for (const a of Array.isArray(value?.answers) ? value.answers : []) {
      const r = a as Record<string, unknown>;
      const n = Number(r.number);
      const letter = typeof r.letter === "string" ? r.letter.trim().toUpperCase().slice(0, 1) : "";
      out.set(n, {
        letter: OPTION_LETTERS.includes(letter) ? letter : null,
        explanation: typeof r.explanation === "string" && r.explanation.trim() ? r.explanation.trim() : null,
        disagrees: r.disagrees === true,
      });
    }
  } catch (err) {
    console.warn(`[NationalExam] Explanation batch failed: ${err instanceof Error ? err.message : err}`);
  }
  return out;
}

/**
 * An extraction still marked as running after this long died with the server
 * (a restart or deploy kills background work); it may be started again.
 */
const STALE_EXTRACTION_MS = 30 * 60 * 1000;

export function isStaleExtraction(updatedAt: Date | string): boolean {
  return Date.now() - new Date(updatedAt).getTime() > STALE_EXTRACTION_MS;
}

/**
 * Read an uploaded paper into questions. Runs in the background after upload;
 * leaves the exam in REVIEW (or FAILED with a reason the admin can see).
 */
export async function extractNationalExam(examId: string): Promise<void> {
  const exam = await db.nationalExam.findUnique({
    where: { id: examId },
    select: { id: true, subject: true, sourceFile: true, sourceFileName: true },
  });
  if (!exam?.sourceFile) return;

  try {
    const buffer = await readTextbookFile(exam.sourceFile);
    const extraction = await extractTextFromFile(buffer, exam.sourceFileName ?? exam.sourceFile);
    const text = extraction.text?.trim() ?? "";
    if (text.length < 200) throw new Error("Almost no text could be read from this PDF.");

    // 1. Questions, window by window. Overlapping windows return some
    //    questions twice: keep the fuller copy.
    const byNumber = new Map<number, RawQuestion>();
    const key = new Map<number, string>();
    for (const chunk of windows(text)) {
      const value = await askJson(extractionPrompt(exam.subject, chunk), 16384);
      const parsed = toRawQuestions(value);
      for (const q of parsed.questions) {
        const prev = byNumber.get(q.number);
        if (!prev || q.question.length + q.options.join("").length > prev.question.length + prev.options.join("").length) {
          byNumber.set(q.number, { ...q, answer: q.answer ?? prev?.answer ?? null, mentionsFigure: q.mentionsFigure || !!prev?.mentionsFigure });
        }
      }
      for (const [n, l] of parsed.key) key.set(n, l);
    }
    const questions = [...byNumber.values()].sort((a, b) => a.number - b.number);
    if (questions.length === 0) throw new Error("No multiple-choice questions were found in this PDF.");
    for (const q of questions) if (key.has(q.number)) q.answer = key.get(q.number)!;

    // 2. Answers (when the key lacked them) and explanations.
    const explained = new Map<number, Explained>();
    for (let i = 0; i < questions.length; i += 15) {
      for (const [n, e] of await explainBatch(exam.subject, questions.slice(i, i + 15))) explained.set(n, e);
    }

    // 3. Save. Re-extraction replaces the questions wholesale.
    const rows: Prisma.NationalExamQuestionCreateManyInput[] = questions.map((q) => {
      const e = explained.get(q.number);
      const notes: string[] = [];
      let letter = q.answer;
      if (!letter) {
        letter = e?.letter ?? null;
        notes.push(
          letter
            ? "AI-suggested answer — please confirm. The paper has no answer key for this question."
            : "No answer found — please set it.",
        );
      } else if (e?.disagrees && e.letter && e.letter !== letter) {
        notes.push(`AI thinks the answer is ${e.letter}, not ${letter} as in the key — please check.`);
      }
      if (q.mentionsFigure) notes.push("Refers to a figure — attach the image.");
      const idx = letter ? OPTION_LETTERS.indexOf(letter) : -1;
      return {
        examId,
        number: q.number,
        questionText: q.question,
        options: q.options,
        correctAnswer: idx >= 0 && idx < q.options.length ? q.options[idx] : null,
        explanation: e?.explanation ?? null,
        needsReview: notes.length > 0,
        reviewNote: notes.join(" ") || null,
      };
    });

    const oldImages = await db.nationalExamQuestion.findMany({ where: { examId }, select: { imageFile: true } });
    await db.$transaction([
      db.nationalExamQuestion.deleteMany({ where: { examId } }),
      db.nationalExamQuestion.createMany({ data: rows }),
      db.nationalExam.update({
        where: { id: examId },
        data: { status: "REVIEW", questionCount: rows.length, extractionError: null },
      }),
    ]);
    await Promise.all(oldImages.map((o) => deleteExamImage(o.imageFile)));
    console.log(`[NationalExam] ${examId}: extracted ${rows.length} questions (${key.size} answers from the key).`);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[NationalExam] Extraction failed for ${examId}: ${message}`);
    await db.nationalExam.update({
      where: { id: examId },
      data: { status: "FAILED", extractionError: message.slice(0, 1000) },
    });
  }
}

// ─── Attempts ────────────────────────────────────────────

/** When an exam-mode attempt's time is up. */
export function examDeadline(startedAt: Date, durationMinutes: number): Date {
  return new Date(startedAt.getTime() + durationMinutes * 60_000);
}

/**
 * Score and close an attempt. `answers` replaces what was saved (exam mode
 * sends its final answers on submit); without it the saved answers count.
 * Idempotent: a finished attempt is left as it is. No points are awarded.
 */
export async function finishAttempt(
  attemptId: string,
  answers?: unknown,
): Promise<{ correctCount: number; totalQuestions: number } | null> {
  const attempt = await db.nationalExamAttempt.findUnique({
    where: { id: attemptId },
    select: {
      completedAt: true, answers: true, correctCount: true, totalQuestions: true,
      exam: { select: { questions: { select: { id: true, options: true, correctAnswer: true } } } },
    },
  });
  if (!attempt) return null;
  if (attempt.completedAt) return { correctCount: attempt.correctCount, totalQuestions: attempt.totalQuestions };

  const questions = attempt.exam.questions;
  const final = cleanAnswers(answers ?? attempt.answers, questions);
  const correctCount = questions.filter((q) => q.correctAnswer && final[q.id] === q.correctAnswer).length;
  // completedAt: null in the filter, so two racing submits cannot both score it.
  await db.nationalExamAttempt.updateMany({
    where: { id: attemptId, completedAt: null },
    data: { answers: final, correctCount, totalQuestions: questions.length, completedAt: new Date() },
  });
  return { correctCount, totalQuestions: questions.length };
}

/** Answers stored on an attempt, keeping only questions of this paper and option texts. */
export function cleanAnswers(
  raw: unknown,
  questions: { id: string; options: unknown }[],
): Record<string, string> {
  const out: Record<string, string> = {};
  if (!raw || typeof raw !== "object") return out;
  const byId = new Map(questions.map((q) => [q.id, (q.options as string[]) ?? []]));
  for (const [qid, value] of Object.entries(raw as Record<string, unknown>)) {
    const opts = byId.get(qid);
    if (opts && typeof value === "string" && opts.includes(value)) out[qid] = value;
  }
  return out;
}

/** The full review of a finished attempt: every question with the student's choice, the answer and why. */
export function buildReview(
  questions: {
    id: string;
    number: number;
    questionText: string;
    options: unknown;
    correctAnswer: string | null;
    explanation: string | null;
    imageFile: string | null;
  }[],
  answers: Record<string, string>,
) {
  return questions.map((q) => ({
    ...publicQuestion(q),
    chosen: answers[q.id] ?? null,
    correctAnswer: q.correctAnswer,
    explanation: q.explanation,
    isCorrect: !!q.correctAnswer && answers[q.id] === q.correctAnswer,
  }));
}

/** Questions as a student may see them during an attempt: no answers, no explanations. */
export function publicQuestion(q: {
  id: string;
  number: number;
  questionText: string;
  options: unknown;
  imageFile: string | null;
}) {
  return {
    id: q.id,
    number: q.number,
    questionText: q.questionText,
    options: Array.isArray(q.options) ? (q.options as string[]) : [],
    hasImage: !!q.imageFile,
  };
}
