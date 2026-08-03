/**
 * Post-Processing Quality Pipeline — §4.5.4
 *
 * Runs comprehensive quality checks on AI-generated questions:
 * 1. Cosine similarity relevance check (question vs source content)
 * 2. Answer validation (format/correctness checks)
 * 3. Difficulty verification (AI independent rating)
 * 4. Semantic duplicate detection (pairwise similarity)
 * 5. Grammar/language quality check
 *
 * Questions are flagged but included — admin decides final disposition.
 */

import { GoogleGenerativeAI } from "@google/generative-ai";
import Groq from "groq-sdk";
import { generateEmbeddings, cosineSimilarity } from "./embeddings";
import { ollamaChat } from "./ollama";

// ─── Types ──────────────────────────────────────────────

export type QualityFlag =
  | "LOW_RELEVANCE"        // Cosine similarity to source < 0.5
  | "INVALID_ANSWER"       // correctAnswer not in options, wrong format
  | "DIFFICULTY_MISMATCH"  // AI-rated difficulty differs from declared
  | "DUPLICATE_QUESTION"   // Semantically similar to another question (>0.75)
  | "GRAMMAR_ISSUE"        // Grammar/clarity problems
  | "EMPTY_EXPLANATION"    // Missing explanation
  | "TOO_SHORT"            // Question text suspiciously short
  | "AMBIGUOUS"            // Potentially ambiguous question
  | "FACTUAL_ERROR"        // Correct answer or premise is factually wrong
  | "META_REFERENCE"       // Question text references "the chapter / the text"
  | "COMPOUND_QUESTION"    // MCQ/TRUE_FALSE asks two things ("…and why?")
  | "WEAK_OPTION"          // MCQ uses "All/None of the above" or "Both A and B"
  | "ANSWER_SKEW";         // Batch's correct answers are lopsided (position / true-false)

export interface QualityResult {
  questionIndex: number;
  qualityScore: number; // 0-1, composite score
  flags: QualityFlag[];
  details: Record<string, string>; // flag → human-readable description
  passed: boolean; // qualityScore >= 0.6
}

export interface QualityPipelineResult {
  results: QualityResult[];
  averageScore: number;
  passCount: number;
  failCount: number;
  duplicatePairs: [number, number][]; // pairs of duplicate question indices
}

interface GeneratedQuestion {
  questionText: string;
  type: string;
  options: string[];
  correctAnswer: string;
  difficulty: string;
  explanation: string;
}

// ─── Private AI check result type ───────────────────────

interface AIQualityCheck {
  difficulty: string;          // "EASY" | "MEDIUM" | "HARD" | "" (empty = unparseable)
  grammarIssue: string | null; // null = no issue detected
  factualPassed: boolean;
  factualReason: string;
}

// ─── Constants ──────────────────────────────────────────

const QUALITY_PASS_THRESHOLD = 0.6;
const RELEVANCE_THRESHOLD = 0.5;
const DUPLICATE_THRESHOLD = 0.75; // Lowered from 0.85 to catch near-duplicates
const MIN_QUESTION_LENGTH = 15;

// Skip Ollama chat in production when OLLAMA_BASE_URL is absent or still localhost.
// Mirrors the same guard used in embeddings.ts.
const ollamaChatEnabled =
  !!process.env.OLLAMA_BASE_URL &&
  process.env.OLLAMA_BASE_URL !== "http://localhost:11434";

// Compound question endings that are invalid for MCQ / TRUE_FALSE (Q12)
const COMPOUND_QUESTION_PATTERNS = [
  /,\s*and\s+why\?$/i,
  /,\s*and\s+what\s+is\s+the\s+reason\?$/i,
  /,\s*and\s+how\?$/i,
  /,\s*and\s+explain\.?$/i,
  /\?\s+and\s+why\?$/i,
];

// Weak / meta MCQ options that must never appear (Q6 / Q15 enforcement)
const WEAK_OPTION_PATTERNS = [
  /\b(all|none)\s+of\s+(the\s+)?(above|below|these|options|answers)\b/i,
  /\bboth\s+[a-d]\s+and\s+[a-d]\b/i,
  /\bneither\s+[a-d]\s+nor\s+[a-d]\b/i,
  /\bnone\s+of\s+these\b/i,
];

// Phrases that must not appear in question text (Q11 enforcement)
const META_REF_PATTERNS = [
  /\bthis chapter\b/i,
  /\bthe chapter\b/i,
  /\bfrom the chapter\b/i,
  /\bthe text\b/i,
  /\bfrom the text\b/i,
  /\bthe passage\b/i,
  /\bthe content\b/i,
  /\bthe textbook\b/i,
  /\baccording to the book\b/i,
  /\bbased on the reading\b/i,
];

// ─── 1. Answer Validation ──────────────────────────────

function validateAnswer(q: GeneratedQuestion): { valid: boolean; issue?: string } {
  const type = q.type.toUpperCase();

  if (!q.correctAnswer || q.correctAnswer.trim().length === 0) {
    return { valid: false, issue: "Empty correct answer" };
  }

  if (type === "MCQ") {
    if (!Array.isArray(q.options) || q.options.length < 2) {
      return { valid: false, issue: "MCQ requires at least 2 options" };
    }
    const optLower = q.options.map((o) => o.toLowerCase().trim());
    if (!optLower.includes(q.correctAnswer.toLowerCase().trim())) {
      return { valid: false, issue: "Correct answer not found in options" };
    }
  } else if (type === "TRUE_FALSE") {
    if (!["True", "False", "true", "false"].includes(q.correctAnswer.trim())) {
      return { valid: false, issue: "TRUE_FALSE answer must be 'True' or 'False'" };
    }
  } else if (type === "FILL_IN_BLANK") {
    if (!q.questionText.includes("_______")) {
      return { valid: false, issue: "FILL_IN_BLANK must contain blank (_______)" };
    }
  } else if (type === "MATCH_PAIRS") {
    if (!q.correctAnswer.includes(":") || !q.correctAnswer.includes("|")) {
      return { valid: false, issue: "MATCH_PAIRS answer must use colon:pipe format" };
    }
  } else if (type === "ORDERING") {
    if (!q.correctAnswer.includes("|")) {
      return { valid: false, issue: "ORDERING answer must use pipe-separated format" };
    }
  }

  return { valid: true };
}

// ─── 2. Structural Checks ──────────────────────────────

function structuralChecks(q: GeneratedQuestion): QualityFlag[] {
  const flags: QualityFlag[] = [];

  if (q.questionText.trim().length < MIN_QUESTION_LENGTH) {
    flags.push("TOO_SHORT");
  }

  if (!q.explanation || q.explanation.trim().length === 0) {
    flags.push("EMPTY_EXPLANATION");
  }

  if (META_REF_PATTERNS.some((p) => p.test(q.questionText))) {
    flags.push("META_REFERENCE");
  }

  const type = q.type.toUpperCase();
  if (
    (type === "MCQ" || type === "TRUE_FALSE") &&
    COMPOUND_QUESTION_PATTERNS.some((p) => p.test(q.questionText.trim()))
  ) {
    flags.push("COMPOUND_QUESTION");
  }

  if (
    type === "MCQ" &&
    Array.isArray(q.options) &&
    q.options.some((o) => WEAK_OPTION_PATTERNS.some((p) => p.test(o)))
  ) {
    flags.push("WEAK_OPTION");
  }

  return flags;
}

// ─── 3. Combined AI Quality Checks (difficulty + grammar + factual) ──────────
//
// Replaces the former verifyAITextQuality + factCheckQuestions pair.
// Merging into one call halves API usage and eliminates the parallel
// rate-limit collision that occurred when both ran against Gemini simultaneously.
// Provider order: Groq (production primary) → Gemini → Ollama (local dev only).

async function runAIQualityChecksBatch(
  questions: GeneratedQuestion[],
  subject: string,
  grade: number
): Promise<Map<number, AIQualityCheck>> {
  const result = new Map<number, AIQualityCheck>();
  if (questions.length === 0) return result;

  const questionList = questions
    .map((q, i) => {
      const opts = q.options
        .map((o, j) => `  ${String.fromCharCode(65 + j)}. ${o}`)
        .join("\n");
      return (
        `Q${i} [${q.type}] difficulty: ${q.difficulty}\n` +
        `Question: ${q.questionText.slice(0, 300)}\n` +
        `Options:\n${opts}\n` +
        `Marked correct: ${q.correctAnswer}`
      );
    })
    .join("\n\n");

  const prompt = `You are a strict quality-checker for Grade ${grade} ${subject} exam questions.

For EACH question perform THREE checks:

CHECK 1 — DIFFICULTY: Rate as EASY, MEDIUM, or HARD.
- EASY: Direct recall, simple facts, basic definitions.
- MEDIUM: Comprehension, application of learned concepts.
- HARD: Analysis, synthesis, multi-step reasoning.

CHECK 2 — GRAMMAR: Return the grammatical or structural issue as a short string,
or null if the question is grammatically correct. Do NOT flag correct questions.

CHECK 3 — FACTUAL ACCURACY & SINGLE ANSWER: Verify all six:
(a) The question premise is factually accurate.
(b) The marked correct answer is genuinely correct.
(c) No wrong option could also be defended as correct by a knowledgeable student.
(d) No two options say logically equivalent things from opposite angles
    (e.g. "A is more rigid" vs "B is more flexible" are the same conclusion).
(e) EXACTLY ONE option is true. Fail if the stem lets two or more options be
    simultaneously correct — especially "which dominates / best applies / wins"
    stems comparing PARALLEL or INDEPENDENT schemes (different classification
    systems, timelines, or labelling methods), where each option is correct
    under its own scheme and there is no single answer.
(f) No option is a meta-option like "All of the above", "None of the above",
    or "Both A and B" — every option must be a concrete, substantive answer.
Return factualPassed: false with a concise reason if ANY sub-check fails.

QUESTIONS:
${questionList}

Return JSON only — no markdown, no code fences:
{
  "checks": [
    { "index": 0, "difficulty": "MEDIUM", "grammarIssue": null, "factualPassed": true, "factualReason": "" },
    { "index": 1, "difficulty": "HARD", "grammarIssue": null, "factualPassed": false, "factualReason": "Premise wrong: primary sexual characteristics are present from birth, not developed during puberty." }
  ]
}`;

  let rawText = "";

  // 1. Groq — fast, high rate limits, always available in production
  if (process.env.GROQ_API_KEY) {
    try {
      const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });
      const res = await groq.chat.completions.create({
        model: "llama-3.3-70b-versatile",
        messages: [{ role: "user", content: prompt }],
        temperature: 0.1,
        max_tokens: 2048,
        response_format: { type: "json_object" },
      });
      rawText = res.choices[0]?.message?.content ?? "";
      if (rawText) console.info("[Quality Pipeline] AI checks via groq");
    } catch (err) {
      console.warn("[Quality Pipeline] Groq failed AI checks:", err instanceof Error ? err.message : String(err));
    }
  }

  // 2. Gemini — fallback (lower free-tier rate limits than Groq)
  if (!rawText && process.env.GEMINI_API_KEY) {
    try {
      const client = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
      const model = client.getGenerativeModel({
        model: "gemini-2.0-flash",
        generationConfig: { responseMimeType: "application/json", temperature: 0.1, maxOutputTokens: 2048 },
      });
      rawText = (await model.generateContent(prompt)).response.text();
      if (rawText) console.info("[Quality Pipeline] AI checks via gemini");
    } catch (err) {
      if (String(err).includes("429")) {
        console.warn("[Quality Pipeline] Gemini rate-limited.");
      } else {
        console.warn("[Quality Pipeline] Gemini failed AI checks:", err instanceof Error ? err.message : String(err));
      }
    }
  }

  // 3. Ollama — local dev only, skipped in production (ollamaChatEnabled guard)
  if (!rawText && ollamaChatEnabled) {
    try {
      const raw = await ollamaChat(prompt);
      if (raw) {
        rawText = raw;
        console.info("[Quality Pipeline] AI checks via ollama");
      }
    } catch { /* fall through */ }
  }

  if (!rawText) return result;

  try {
    const parsed = JSON.parse(rawText);
    for (const c of (Array.isArray(parsed.checks) ? parsed.checks : [])) {
      const idx = Number(c.index);
      if (idx < 0 || idx >= questions.length) continue;
      const aiDiff = String(c.difficulty ?? "").toUpperCase();
      result.set(idx, {
        difficulty: ["EASY", "MEDIUM", "HARD"].includes(aiDiff) ? aiDiff : "",
        grammarIssue:
          typeof c.grammarIssue === "string" && c.grammarIssue.trim().length > 0
            ? c.grammarIssue.trim()
            : null,
        // Default factualPassed to true on parse failure — no false positives
        factualPassed: typeof c.factualPassed === "boolean" ? c.factualPassed : true,
        factualReason: typeof c.factualReason === "string" ? c.factualReason : "",
      });
    }
  } catch {
    // JSON parse failed — return empty map; questions proceed without AI flags
  }

  return result;
}

// Run the AI quality check over EVERY question, in batches of 20 to keep each
// prompt within a safe token budget. Previously only the first 20 questions
// were checked, so questions 21–30 silently skipped difficulty/grammar/factual
// verification. Batch-local indices are offset back to global positions.
const AI_CHECK_BATCH_SIZE = 20;

async function runAIQualityChecks(
  questions: GeneratedQuestion[],
  subject: string,
  grade: number
): Promise<Map<number, AIQualityCheck>> {
  const result = new Map<number, AIQualityCheck>();

  for (let start = 0; start < questions.length; start += AI_CHECK_BATCH_SIZE) {
    const batch = questions.slice(start, start + AI_CHECK_BATCH_SIZE);
    const batchResult = await runAIQualityChecksBatch(batch, subject, grade);
    for (const [localIdx, check] of batchResult) {
      result.set(start + localIdx, check);
    }
  }

  return result;
}

// ─── 5. Semantic Duplicate Detection ───────────────────

function detectDuplicates(
  questions: GeneratedQuestion[],
  questionEmbeddings: number[][]
): { duplicatePairs: [number, number][]; similarities: Map<string, number> } {
  const duplicatePairs: [number, number][] = [];
  const similarities = new Map<string, number>();

  if (questions.length < 2 || questionEmbeddings.length < 2) {
    return { duplicatePairs, similarities };
  }

  for (let i = 0; i < questionEmbeddings.length; i++) {
    for (let j = i + 1; j < questionEmbeddings.length; j++) {
      const sim = cosineSimilarity(questionEmbeddings[i], questionEmbeddings[j]);
      similarities.set(`${i}-${j}`, sim);
      if (sim >= DUPLICATE_THRESHOLD) {
        duplicatePairs.push([i, j]);
      }
    }
  }

  return { duplicatePairs, similarities };
}

// ─── 6. Relevance Check (question vs source content) ───
//
// Scores each question against the ENTIRE source, not just its opening. The
// source is split into windows (see splitSourceForRelevance) that are embedded
// individually; a question's relevance is its BEST (max) cosine similarity to
// any window. This fixes the bias where a valid question drawn from content
// deep in the chapter was flagged LOW_RELEVANCE because only the first ~5k
// characters were embedded as "the source".

function checkRelevance(
  questions: GeneratedQuestion[],
  sourceEmbeddings: number[][],
  questionEmbeddings: number[][]
): Map<number, number> {
  const relevanceScores = new Map<number, number>();

  if (sourceEmbeddings.length === 0) return relevanceScores;

  for (let i = 0; i < questions.length; i++) {
    const qEmbedding = questionEmbeddings[i];
    if (!qEmbedding) continue;

    let best = -1;
    for (const sourceEmbedding of sourceEmbeddings) {
      const sim = cosineSimilarity(sourceEmbedding, qEmbedding);
      if (sim > best) best = sim;
    }
    if (best >= -1) relevanceScores.set(i, best);
  }

  return relevanceScores;
}

// Split source content into overlapping-free windows for whole-document
// relevance scoring. Windows are capped so a very large "all chapters" source
// (up to ~80k chars) stays within a bounded number of embedding calls.
function splitSourceForRelevance(
  text: string,
  windowChars = 4000,
  maxWindows = 25
): string[] {
  const trimmed = text.trim();
  if (!trimmed) return [];

  const windows: string[] = [];
  for (let i = 0; i < trimmed.length && windows.length < maxWindows; i += windowChars) {
    const slice = trimmed.slice(i, i + windowChars).trim();
    if (slice) windows.push(slice);
  }
  return windows;
}

// ─── Batch answer-balance check ────────────────────────
// Flags a lopsided answer key across the batch. MCQ option order is already
// randomised at generation, so this mainly catches TRUE_FALSE batches that skew
// heavily to one answer (which shuffling cannot fix). Returns a map of question
// index → reason for the questions that should carry the ANSWER_SKEW flag.
function detectAnswerSkew(questions: GeneratedQuestion[]): Map<number, string> {
  const flagged = new Map<number, string>();

  // TRUE_FALSE balance
  const tf = questions
    .map((q, i) => ({ i, ans: String(q.correctAnswer).trim().toLowerCase() }))
    .filter(({ i }) => questions[i].type.toUpperCase() === "TRUE_FALSE");
  if (tf.length >= 4) {
    const trueRatio = tf.filter((x) => x.ans === "true").length / tf.length;
    if (trueRatio >= 0.75 || trueRatio <= 0.25) {
      const majority = trueRatio >= 0.5 ? "True" : "False";
      const pct = Math.round((trueRatio >= 0.5 ? trueRatio : 1 - trueRatio) * 100);
      for (const { i } of tf) {
        flagged.set(i, `${pct}% of True/False answers are "${majority}" — vary the mix toward ~50/50`);
      }
    }
  }

  // MCQ correct-answer position balance (safety net; usually uniform post-shuffle)
  const mcqByPos: Record<number, number[]> = {};
  let mcqTotal = 0;
  questions.forEach((q, i) => {
    if (q.type.toUpperCase() !== "MCQ" || !Array.isArray(q.options)) return;
    const pos = q.options
      .map((o) => String(o).trim().toLowerCase())
      .indexOf(String(q.correctAnswer).trim().toLowerCase());
    if (pos < 0) return;
    if (!mcqByPos[pos]) mcqByPos[pos] = [];
    mcqByPos[pos].push(i);
    mcqTotal++;
  });
  if (mcqTotal >= 4) {
    let topPos = -1;
    let topLen = 0;
    for (const [p, idxs] of Object.entries(mcqByPos)) {
      if (idxs.length > topLen) {
        topLen = idxs.length;
        topPos = Number(p);
      }
    }
    if (topPos >= 0 && topLen / mcqTotal > 0.6) {
      const label = String.fromCharCode(65 + topPos);
      const pct = Math.round((topLen / mcqTotal) * 100);
      for (const i of mcqByPos[topPos]) {
        flagged.set(i, `${pct}% of MCQ correct answers are in position ${label} — distribute across options`);
      }
    }
  }

  return flagged;
}

// ─── Main Pipeline ──────────────────────────────────────

/**
 * Run the full quality pipeline on generated questions.
 * All checks run in parallel for speed.
 */
export async function runQualityPipeline(
  questions: GeneratedQuestion[],
  sourceContent: string,
  subject: string,
  grade: number
): Promise<QualityPipelineResult> {
  // Pre-compute all embeddings in a single batch (source windows + all
  // questions). The source is split into windows so relevance is scored against
  // the WHOLE document, not just its opening 5k characters. Sharing one batched
  // call keeps duplicate detection and relevance scoring on a single API round.
  const sourceWindows = splitSourceForRelevance(sourceContent);
  const allTexts = [...sourceWindows, ...questions.map((q) => q.questionText)];
  let sourceEmbeddings: number[][] = [];
  let questionEmbeddings: number[][] = [];

  try {
    const embeddingResults = await generateEmbeddings(allTexts);
    sourceEmbeddings = embeddingResults
      .slice(0, sourceWindows.length)
      .map((r) => r.embedding);
    questionEmbeddings = embeddingResults
      .slice(sourceWindows.length)
      .map((r) => r.embedding);
  } catch (error) {
    console.warn("[Quality Pipeline] Embedding generation failed, skipping similarity checks:", error);
  }

  // Single combined AI check (difficulty + grammar + factual accuracy).
  // Groq-first provider order prevents the Gemini rate-limit collisions
  // that occurred when two parallel AI calls hit the same endpoint.
  const aiChecksMap = await runAIQualityChecks(questions, subject, grade);
  const duplicateResult = detectDuplicates(questions, questionEmbeddings);
  const relevanceMap = checkRelevance(questions, sourceEmbeddings, questionEmbeddings);

  const duplicateIndices = new Set(
    duplicateResult.duplicatePairs.flat()
  );

  // Batch-level answer-balance check (position / true-false skew).
  const answerSkew = detectAnswerSkew(questions);

  // Build results for each question
  const results: QualityResult[] = questions.map((q, idx) => {
    const flags: QualityFlag[] = [];
    const details: Record<string, string> = {};
    let penalty = 0;

    // 1. Answer validation
    const answerCheck = validateAnswer(q);
    if (!answerCheck.valid) {
      flags.push("INVALID_ANSWER");
      details["INVALID_ANSWER"] = answerCheck.issue!;
      penalty += 0.4;
    }

    // 2. Structural checks
    const structural = structuralChecks(q);
    for (const flag of structural) {
      flags.push(flag);
      if (flag === "TOO_SHORT") {
        details["TOO_SHORT"] = "Question text is suspiciously short";
        penalty += 0.15;
      }
      if (flag === "EMPTY_EXPLANATION") {
        details["EMPTY_EXPLANATION"] = "Missing explanation for the answer";
        penalty += 0.1;
      }
      if (flag === "META_REFERENCE") {
        details["META_REFERENCE"] = "Question references 'the chapter', 'the text', or similar — must be rewritten as a standalone item";
        penalty += 0.1;
      }
      if (flag === "COMPOUND_QUESTION") {
        details["COMPOUND_QUESTION"] = "MCQ/TRUE_FALSE asks two things (e.g. '…and why?') — options cannot answer both; split into a single focused question";
        penalty += 0.25;
      }
      if (flag === "WEAK_OPTION") {
        details["WEAK_OPTION"] = "MCQ uses a meta-option ('All/None of the above', 'Both A and B') — replace with a concrete, substantive answer";
        penalty += 0.2;
      }
    }

    // 3. Relevance check
    const relevance = relevanceMap.get(idx);
    if (relevance !== undefined && relevance < RELEVANCE_THRESHOLD) {
      flags.push("LOW_RELEVANCE");
      details["LOW_RELEVANCE"] = `Cosine similarity to source: ${relevance.toFixed(3)} (threshold: ${RELEVANCE_THRESHOLD})`;
      penalty += 0.25;
    }

    // 4. AI checks (difficulty + grammar + factual) — single map lookup
    const aiCheck = aiChecksMap.get(idx);

    if (aiCheck?.difficulty && aiCheck.difficulty !== q.difficulty.toUpperCase()) {
      flags.push("DIFFICULTY_MISMATCH");
      details["DIFFICULTY_MISMATCH"] = `Declared: ${q.difficulty}, AI rated: ${aiCheck.difficulty}`;
      penalty += 0.1;
    }

    // 5. Duplicate
    if (duplicateIndices.has(idx)) {
      flags.push("DUPLICATE_QUESTION");
      const pairs = duplicateResult.duplicatePairs
        .filter((p) => p.includes(idx))
        .map((p) => p.find((i) => i !== idx)!);
      details["DUPLICATE_QUESTION"] = `Semantically similar to question(s): ${pairs.map((i) => i + 1).join(", ")}`;
      penalty += 0.2;
    }

    // 6. Grammar
    if (aiCheck?.grammarIssue) {
      flags.push("GRAMMAR_ISSUE");
      details["GRAMMAR_ISSUE"] = aiCheck.grammarIssue;
      penalty += 0.15;
    }

    // 7. Factual accuracy
    if (aiCheck && !aiCheck.factualPassed) {
      flags.push("FACTUAL_ERROR");
      details["FACTUAL_ERROR"] = aiCheck.factualReason || "Factual accuracy check failed";
      penalty += 0.45; // Severe — a wrong correct answer directly harms students
    }

    // 8. Answer-key skew (batch-level: lopsided position or true/false balance)
    const skewReason = answerSkew.get(idx);
    if (skewReason) {
      flags.push("ANSWER_SKEW");
      details["ANSWER_SKEW"] = skewReason;
      penalty += 0.1;
    }

    const qualityScore = Math.max(0, Math.round((1 - penalty) * 100) / 100);

    return {
      questionIndex: idx,
      qualityScore,
      flags,
      details,
      passed: qualityScore >= QUALITY_PASS_THRESHOLD,
    };
  });

  const averageScore =
    results.length > 0
      ? Math.round(
          (results.reduce((s, r) => s + r.qualityScore, 0) / results.length) *
            100
        ) / 100
      : 0;

  return {
    results,
    averageScore,
    passCount: results.filter((r) => r.passed).length,
    failCount: results.filter((r) => !r.passed).length,
    duplicatePairs: duplicateResult.duplicatePairs,
  };
}
