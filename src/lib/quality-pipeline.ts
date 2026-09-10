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

import { generateEmbeddings, cosineSimilarity } from "./embeddings";
import { ollamaChat, isOllamaEnabled } from "./ollama";
import { groqChat } from "./groq";
import { nvidiaChat } from "./nvidia";
import { geminiChat, GEMINI_FAST_MODEL } from "./gemini";
import type { UsageFeature } from "./usage-logger";

// ─── Types ──────────────────────────────────────────────

export type QualityFlag =
  | "LOW_RELEVANCE"        // Cosine similarity to source < 0.5
  | "INVALID_ANSWER"       // correctAnswer not in options, wrong format
  | "DIFFICULTY_MISMATCH"  // AI-rated difficulty differs from declared
  | "DUPLICATE_QUESTION"   // Semantically similar to another question in this batch
  | "DUPLICATE_EXISTING"   // Semantically similar to a question ALREADY SAVED for this chapter
  | "GRAMMAR_ISSUE"        // Grammar/clarity problems
  | "EMPTY_EXPLANATION"    // Missing explanation
  | "TOO_SHORT"            // Question text suspiciously short
  | "AMBIGUOUS"            // Potentially ambiguous question
  | "FACTUAL_ERROR"        // Correct answer or premise is factually wrong
  | "META_REFERENCE"       // Question text references "the chapter / the text"
  | "COMPOUND_QUESTION"    // MCQ/TRUE_FALSE asks two things ("…and why?")
  | "WEAK_OPTION"          // MCQ uses "All/None of the above" or "Both A and B"
  | "WEAK_DISTRACTOR"      // A wrong option is so implausible it narrows the question
  | "OUT_OF_SCOPE"         // Needs a formula/constant the chapter content never states
  | "ANSWER_SKEW"          // Batch's correct answers are lopsided (position / true-false)
  | "WRONG_KEY"            // Independent solver disagrees with the marked answer
  | "MULTI_ANSWER"         // Independent solver finds 0 or ≥2 defensible answers
  | "UNVERIFIED";          // Independent solver could not run (fail-closed)

export interface QualityResult {
  questionIndex: number;
  qualityScore: number; // 0-1, composite score
  flags: QualityFlag[];
  details: Record<string, string>; // flag → human-readable description
  passed: boolean; // qualityScore >= 0.6
  // Independent-solver gate: true only when a second model re-solved the
  // question blind and agreed with the marked answer. Students are served
  // ONLY verified questions; unverified/rejected are never auto-served.
  verified: boolean;
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
  /** Which distractor is implausible and why; null when all are credible. */
  weakDistractor: string | null;
  /** What the question needs that the source never states; null when in scope. */
  scopeIssue: string | null;
}

// ─── Constants ──────────────────────────────────────────

const QUALITY_PASS_THRESHOLD = 0.6;
const RELEVANCE_THRESHOLD = 0.5;
/**
 * Cosine similarity at which two questions count as the same question.
 *
 * Calibrated against this corpus rather than guessed. Measured on Grade 12
 * Physics Unit 1, embedding hand-verified pairs with gemini-embedding-001:
 *
 *   true duplicates      95.7% – 97.6%
 *   genuinely distinct   73.1% – 82.3%
 *
 * Any two exam questions drawn from ONE chapter already share a register —
 * same subject vocabulary, same MCQ phrasing — so the floor for unrelated
 * pairs sits above 0.70, not near zero. Earlier values of 0.75 and 0.80 were
 * both inside that band: at 0.80 a suspension-bridge question and a
 * centre-of-gravity question matched at 0.81, and an optical-fibre question
 * matched an MRI question at 0.81. 0.90 sits in the empty gap, catching every
 * verified duplicate with ~6 points of margin on each side.
 */
const DUPLICATE_THRESHOLD = 0.9;
const MIN_QUESTION_LENGTH = 15;
/**
 * Cap on question text sent to the AI quality checker.
 *
 * This was 300, which silently cut the checker's copy of any longer question
 * mid-word — and then the checker faithfully reported what it saw. One real
 * example lost its final clause ("…causes its true luminosity to increase by a
 * factor of 18") and came back with three flags that were all the same bug:
 * GRAMMAR_ISSUE ("incomplete sentence"), FACTUAL_ERROR (it solved the half it
 * could see and disagreed with the key), and DIFFICULTY_MISMATCH (what remained
 * really was a one-step MEDIUM problem).
 *
 * HARD questions are long BY DESIGN — templates 1 and 5 both embed two facts in
 * the stem — so the cap was selecting against exactly the questions the rubric
 * asks for. The saving never justified it: ~150 extra characters across a batch
 * of five is under 200 tokens. This is now a runaway guard, not a budget.
 */
const MAX_CHECKED_QUESTION_CHARS = 1200;
/** How many already-saved questions a new batch is compared against. */
const MAX_EXISTING_COMPARED = 300;

// Shared guard from lib/ollama — off in production, on when OLLAMA_ENABLED=true.
const ollamaChatEnabled = isOllamaEnabled();

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

// Deterministic (non-AI) structural flags that should block a question from
// being served to a student, who takes the test immediately and can't vet it.
// EMPTY_EXPLANATION is intentionally excluded — it's a minor issue, not a defect
// that misleads the test-taker.
const STUDENT_BLOCKING_FLAGS: QualityFlag[] = [
  "TOO_SHORT",
  "META_REFERENCE",
  "COMPOUND_QUESTION",
  "WEAK_OPTION",
];

/**
 * True if a question has a blocking deterministic defect (bad answer format,
 * meta-reference, compound stem, or a weak "All/None of the above" option).
 * Used by the student flow to drop such questions without an AI round-trip.
 */
export function hasBlockingStructuralIssue(q: GeneratedQuestion): boolean {
  if (!validateAnswer(q).valid) return true;
  return structuralChecks(q).some((f) => STUDENT_BLOCKING_FLAGS.includes(f));
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
  grade: number,
  /** Chapter passages these questions were generated from — the scope yardstick. */
  sourceExcerpts: string[] = []
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
        `Question: ${q.questionText.slice(0, MAX_CHECKED_QUESTION_CHARS)}\n` +
        `Options:\n${opts}\n` +
        `Marked correct: ${q.correctAnswer}`
      );
    })
    .join("\n\n");

  // Only run the scope check when we actually have the source to judge against.
  const sourceBlock = sourceExcerpts.length
    ? `\n\nSOURCE CONTENT (the chapter passages these questions came from):\n"""\n${sourceExcerpts.join("\n\n---\n\n")}\n"""\n`
    : "";

  const scopeCheck = sourceExcerpts.length
    ? `

CHECK 5 — SCOPE: Can the question be answered using ONLY the SOURCE CONTENT
above plus arithmetic? Set scopeIssue to a short string naming what is missing,
or null when the question is in scope.
- Flag it when the question needs a FORMULA, PHYSICAL CONSTANT, or named
  relationship that the source never states — e.g. computing with a refractive
  index, a speed of sound in tissue, v = f x lambda, or P = F x v when the
  source contains none of them. The physics being correct is irrelevant: if the
  source does not supply it, the question is out of scope for this chapter.
- Do NOT flag a question merely because it applies a relationship the source
  DOES name, nor for ordinary arithmetic, unit conversion, or vocabulary a
  Grade ${grade} student is assumed to have.
- The excerpts are the passages CLOSEST to these questions, not the whole
  chapter. Something you cannot see may still be in the book, so treat absence
  from the excerpts as weak evidence: flag only when the question plainly needs
  an outside formula or constant, never merely because you did not spot it.
- Be conservative: if the supporting statement plausibly sits in the source,
  treat it as in scope and return null.`
    : "";

  const prompt = `You are a strict quality-checker for Grade ${grade} ${subject} exam questions.

For EACH question perform ${sourceExcerpts.length ? "FIVE" : "FOUR"} checks:

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

CHECK 4 — DISTRACTOR PLAUSIBILITY: Every WRONG option must be a mistake a
student who half-understood the material could actually make. Set
weakDistractor to a short string naming the offending option and why, or null
when all distractors are credible.
- Flag options that are physically absurd (an instrument spontaneously becoming
  a different instrument, a radio pulse causing nuclear fusion), that contradict
  everyday experience, or that borrow vocabulary from an unrelated topic purely
  to sound wrong. Nobody picks these, so they turn a 4-option question into a
  3-option one and inflate the guess rate.
- A distractor is GOOD when you can name the specific misunderstanding behind
  it. Judge only the wrong options — never the marked correct answer.${scopeCheck}${sourceBlock}

QUESTIONS:
${questionList}

Return JSON only — no markdown, no code fences:
{
  "checks": [
    { "index": 0, "difficulty": "MEDIUM", "grammarIssue": null, "factualPassed": true, "factualReason": "", "weakDistractor": null, "scopeIssue": null },
    { "index": 1, "difficulty": "HARD", "grammarIssue": null, "factualPassed": false, "factualReason": "Premise wrong: primary sexual characteristics are present from birth.", "weakDistractor": "Option B (nuclear fusion from a radiofrequency pulse) is physically absurd — no student would pick it.", "scopeIssue": "Needs the speed of sound in tissue (1540 m/s) and v = f x lambda; the source states neither." }
  ]
}`;

  let rawText = "";

  // 1. Groq — fast, high rate limits, always available in production.
  //    Goes through groqChat so the model id comes from GROQ_MODEL in one
  //    place; this call site used to pin llama-3.3-70b-versatile, which Groq
  //    has since decommissioned (404) while groq.ts had already moved on.
  if (process.env.GROQ_API_KEY) {
    try {
      rawText = (await groqChat(prompt, { temperature: 0.1, maxTokens: 4096, feature: "quality-check" })) ?? "";
      if (rawText) console.info("[Quality Pipeline] AI checks via groq");
    } catch (err) {
      console.warn("[Quality Pipeline] Groq failed AI checks:", err instanceof Error ? err.message : String(err));
    }
  }

  // 2. Gemini — fallback (lower free-tier rate limits than Groq)
  if (!rawText && process.env.GEMINI_API_KEY) {
    try {
      rawText = (await geminiChat(prompt, {
        model: GEMINI_FAST_MODEL,
        temperature: 0.1,
        maxTokens: 4096,
        feature: "quality-check",
      })) ?? "";
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
        weakDistractor:
          typeof c.weakDistractor === "string" && c.weakDistractor.trim().length > 0
            ? c.weakDistractor.trim()
            : null,
        scopeIssue:
          typeof c.scopeIssue === "string" && c.scopeIssue.trim().length > 0
            ? c.scopeIssue.trim()
            : null,
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
// Smaller than the old 20: the prompt now carries source passages for the
// scope check, so a 20-question batch would send a very large request.
const AI_CHECK_BATCH_SIZE = 8;
/** Most source passages attached to one check batch. */
const MAX_SCOPE_EXCERPTS = 5;
/** Source windows retrieved per question — top-1 missed supporting passages. */
const SCOPE_WINDOWS_PER_QUESTION = 2;
/**
 * Chars kept from each passage. Full 4,000-char windows made the request big
 * enough that Groq's JSON mode failed outright (json_validate_failed with an
 * empty generation) — and because every check shares that one call, a prompt
 * too large for the scope check silently disabled difficulty, grammar and
 * factual checking too. Keep this modest.
 */
const SCOPE_EXCERPT_CHARS = 1500;

async function runAIQualityChecks(
  questions: GeneratedQuestion[],
  subject: string,
  grade: number,
  /** Per-question best-matching source window, aligned with `questions`. */
  questionExcerpts: string[][] = []
): Promise<Map<number, AIQualityCheck>> {
  const result = new Map<number, AIQualityCheck>();

  for (let start = 0; start < questions.length; start += AI_CHECK_BATCH_SIZE) {
    const batch = questions.slice(start, start + AI_CHECK_BATCH_SIZE);
    // The distinct passages this batch came from — deduplicated, since several
    // questions usually share one window.
    const excerpts = [
      ...new Set(
        questionExcerpts.slice(start, start + AI_CHECK_BATCH_SIZE).flat().filter(Boolean)
      ),
    ]
      .slice(0, MAX_SCOPE_EXCERPTS)
      .map((e) => e.slice(0, SCOPE_EXCERPT_CHARS));
    const batchResult = await runAIQualityChecksBatch(batch, subject, grade, excerpts);
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

/**
 * Compare each NEW question against the chapter's already-saved questions.
 *
 * `detectDuplicates` above only looks inside the current batch, which is why a
 * chapter could accumulate the same question many times over: each generation
 * was self-consistent and blind to every previous one. Returns index → the
 * saved question it repeats.
 */
function detectExistingDuplicates(
  questionEmbeddings: number[][],
  existingEmbeddings: number[][],
  existingTexts: string[]
): Map<number, string> {
  const hits = new Map<number, string>();
  if (existingEmbeddings.length === 0 || questionEmbeddings.length === 0) return hits;

  for (let i = 0; i < questionEmbeddings.length; i++) {
    const qe = questionEmbeddings[i];
    if (!qe) continue;
    let bestSim = 0;
    let bestIdx = -1;
    for (let j = 0; j < existingEmbeddings.length; j++) {
      const sim = cosineSimilarity(qe, existingEmbeddings[j]);
      if (sim > bestSim) { bestSim = sim; bestIdx = j; }
    }
    if (bestIdx >= 0 && bestSim >= DUPLICATE_THRESHOLD) {
      const text = existingTexts[bestIdx] ?? "";
      hits.set(
        i,
        `Already in this chapter (${(bestSim * 100).toFixed(0)}% similar): "${text.slice(0, 110)}${text.length > 110 ? "…" : ""}"`
      );
    }
  }
  return hits;
}

/**
 * Guard against a scope flag raised on incomplete evidence.
 *
 * The scope check only sees the passages nearest a question, not the whole
 * chapter, so "the source never states X" really means "X was not in the
 * fragment I was shown". That is the same unsound inference that made the old
 * 300-char question truncation produce phantom grammar and factual errors.
 *
 * Before a scope flag is trusted, the thing the checker says is missing is
 * looked for in the FULL source. A real example: a projectile question was
 * flagged for "missing horizontal range formula" when Unit 2 derives
 * R = v0^2 sin2θ/g in full — the phrase "horizontal range" is right there in
 * the chapter, so the claim is contradicted and the flag is dropped.
 *
 * Returns true when the source demonstrably DOES contain what was called
 * missing, i.e. the flag should be suppressed.
 */
const SCOPE_STOPWORDS = new Set([
  "missing", "needs", "requires", "the", "a", "an", "of", "for", "and", "or",
  "this", "that", "is", "are", "not", "in", "to", "from", "with", "formula",
  "constant", "value", "source", "content", "chapter", "question", "given",
  "stated", "state", "states", "never", "does", "no",
]);

function scopeClaimContradicted(issue: string, fullSource: string): boolean {
  const norm = (t: string) => t.toLowerCase().replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();
  const src = norm(fullSource);
  if (!src) return false;

  const words = norm(issue).split(" ").filter((w) => w.length > 3 && !SCOPE_STOPWORDS.has(w));
  // Bigrams, not single words: "speed" alone appears in almost any physics
  // chapter, whereas "speed of sound" appearing verbatim is real evidence.
  for (let i = 0; i < words.length - 1; i++) {
    if (src.includes(`${words[i]} ${words[i + 1]}`)) return true;
  }
  return false;
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

// ─── Independent-solver verification (the real quality gate) ───────────────
//
// The critic is shown each question WITHOUT its answer key, must solve it
// itself, and must report how many options are defensibly correct. We then
// compare its blind answer to the marked answer. This catches the two failures
// a "does this look ok?" glance misses: a WRONG answer key, and questions where
// TWO options are both correct. It runs on a DIFFERENT provider than the one
// that generated the questions (cross-model), and FAILS CLOSED — if it cannot
// run, the question is marked unverified, never silently passed.

export type VerifyVerdict = "verified" | "rejected" | "unverified";
export interface VerifyResult {
  verdict: VerifyVerdict;
  reason: string;
  flag?: QualityFlag; // WRONG_KEY | MULTI_ANSWER | UNVERIFIED
  solved?: string; // the critic's own blind answer
}

const VERIFY_BATCH_SIZE = 8;

type ChatFn = (
  prompt: string,
  opts?: { temperature?: number; maxTokens?: number; feature?: UsageFeature },
) => Promise<string | null>;

// Try providers in an order that puts the generator's own provider LAST, so the
// critic is a different model whenever another is available. Returns "" if none
// respond (→ fail closed).
async function runVerifierChat(prompt: string, avoidProvider?: string): Promise<string> {
  const providers: { name: string; fn: ChatFn }[] = [
    // NOTE: Cerebras was removed (free tier returns 402). Gemini leads the pool
    // to match every other chain, but `avoidProvider` still outranks this order:
    // when Gemini generated the questions it is demoted so the critic is a
    // different model. In the common case (Gemini generates) the verifier is
    // therefore Groq — which is the point of the blind cross-check.
    { name: "gemini", fn: (p, o) => geminiChat(p, o) },
    { name: "groq", fn: (p, o) => groqChat(p, o) },
    { name: "nvidia", fn: (p, o) => nvidiaChat(p, o) },
  ];
  // Preference order:
  //   1. a cloud provider that did NOT generate these questions (true second opinion)
  //   2. the generating provider itself — not independent, but a real check,
  //      and seconds rather than minutes
  //   3. local Ollama LAST
  //
  // Ollama is last deliberately. It used to sit ahead of the generating
  // provider, so when the independent cloud verifier failed, verification fell
  // to CPU inference and took 203s where Groq answers in about 10 — turning a
  // one-minute quiz into a four-minute wait. Preferring a fast non-independent
  // check over a slow independent one is the right trade here: the alternative
  // the student actually experiences is giving up.
  const ordered = [
    ...providers.filter((p) => p.name !== avoidProvider),
    ...providers.filter((p) => p.name === avoidProvider),
    ...(ollamaChatEnabled
      ? [{ name: "ollama", fn: (p: string) => ollamaChat(p) as Promise<string | null> }]
      : []),
  ];

  // Retry the whole chain with backoff before giving up.
  //
  // Generation and verification run back to back inside one request, so they
  // compete for the SAME per-minute token budget: a quiz spends 3–4 provider
  // calls in quick succession. When the pool is thin (Gemini's free tier allows
  // 20 requests/day, so a single 429 from Groq can leave nothing) the verifier
  // was the step that lost — every question came back UNVERIFIED, fail-closed
  // dropped them all, and the student saw a hard error for what was really a
  // transient rate limit. A short wait is usually enough for the window to roll.
  const RETRY_DELAYS_MS = [0, 2_000, 6_000];

  for (const [attempt, delay] of RETRY_DELAYS_MS.entries()) {
    if (delay > 0) {
      console.warn(
        `[Quality] No verifier reachable — retrying in ${delay}ms (attempt ${attempt + 1}/${RETRY_DELAYS_MS.length}).`
      );
      await new Promise((r) => setTimeout(r, delay));
    }

    for (const p of ordered) {
      try {
        const out = await p.fn(prompt, { temperature: 0.1, maxTokens: 1200, feature: "answer-verification" });
        // A non-empty string is NOT success. Accepting one was the bug: NVIDIA
        // answers this prompt with prose or a malformed object rather than the
        // verdict schema, and because that is "non-empty" the chain stopped
        // there — never reaching Ollama or Groq. The unusable reply then failed
        // to parse, every question came back UNVERIFIED, fail-closed dropped
        // them all, and the student saw an error while two working verifiers
        // sat untried. Only a reply that actually yields verdicts counts.
        if (out && out.trim() && hasUsableVerdicts(out)) return out;
        if (out && out.trim()) {
          console.warn(
            `[Quality] Verifier "${p.name}" replied but produced no usable verdicts — trying the next provider.`
          );
        }
      } catch {
        /* try the next provider */
      }
    }
  }

  return "";
}

/** Does this raw reply actually contain the verdict array the caller needs? */
function hasUsableVerdicts(raw: string): boolean {
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed?.verdicts) && parsed.verdicts.length > 0;
  } catch {
    return false;
  }
}

function buildVerifyPrompt(
  items: { localIndex: number; q: GeneratedQuestion }[],
  subject: string,
  grade: number,
): string {
  const list = items
    .map(({ localIndex, q }) => {
      if (q.type.toUpperCase() === "TRUE_FALSE") {
        return `Q${localIndex} [TRUE_FALSE]\nStatement: ${q.questionText}`;
      }
      const opts = q.options
        .map((o, j) => `  ${String.fromCharCode(65 + j)}. ${o}`)
        .join("\n");
      return `Q${localIndex} [MCQ]\nQuestion: ${q.questionText}\nOptions:\n${opts}`;
    })
    .join("\n\n");

  return `You are a meticulous Grade ${grade} ${subject} examiner. You are given exam questions WITHOUT their answer keys. For EACH question, work independently:

1. SOLVE it yourself from your own knowledge.
2. Decide how many of the options are DEFENSIBLY correct — i.e. how many a knowledgeable student could justify as correct: 0, 1, or 2 (use 2 to mean "two or more").
3. If EXACTLY ONE option is correct, report its letter (A, B, C, …) as "answer" — for TRUE_FALSE report "True" or "False". If 0 or 2+ options are correct, or the question is ambiguous, set "answer" to null and "correctCount" accordingly.

Be strict. If two options are both true, if none is clearly correct, or if the stem is ambiguous, correctCount must NOT be 1.

QUESTIONS:
${list}

Return JSON ONLY (no markdown):
{"verdicts":[{"index":0,"answer":"C","correctCount":1,"reason":""},{"index":1,"answer":null,"correctCount":2,"reason":"Both B and C are correct"}]}`;
}

function resolveVerdict(
  q: GeneratedQuestion,
  v: { answer?: unknown; correctCount?: unknown; reason?: unknown } | undefined,
): VerifyResult {
  if (!v) return { verdict: "unverified", reason: "No verifier response", flag: "UNVERIFIED" };

  const reason = typeof v.reason === "string" ? v.reason : "";
  const cc = Number(v.correctCount);
  if (cc !== 1) {
    return {
      verdict: "rejected",
      reason: reason || `Independent solver found ${Number.isFinite(cc) ? cc : "an unclear number of"} defensible answers`,
      flag: "MULTI_ANSWER",
    };
  }

  const ans = String(v.answer ?? "").trim();
  if (!ans) {
    return { verdict: "rejected", reason: reason || "Solver gave no single answer", flag: "MULTI_ANSWER" };
  }

  const marked = String(q.correctAnswer).trim().toLowerCase();
  let criticText = ans.toLowerCase();
  // Map an option letter (A/B/C…) to that option's text for comparison.
  if (q.type.toUpperCase() === "MCQ" && /^[a-z]$/i.test(ans)) {
    const idx = ans.toUpperCase().charCodeAt(0) - 65;
    if (idx >= 0 && idx < q.options.length) criticText = String(q.options[idx]).trim().toLowerCase();
  }

  if (criticText === marked) {
    return { verdict: "verified", reason: "", solved: ans };
  }
  return {
    verdict: "rejected",
    reason: reason || `Independent solver chose "${ans}", which disagrees with the marked answer`,
    flag: "WRONG_KEY",
    solved: ans,
  };
}

/**
 * Independently re-solve MCQ / TRUE_FALSE questions with a cross-model critic
 * and return a verdict per question (aligned to the input order). Non-MCQ/TF
 * types default to "verified" here (they are gated by the other pipeline checks
 * — blind free-text comparison is unreliable for them).
 */
export async function verifyQuestions(
  questions: GeneratedQuestion[],
  subject: string,
  grade: number,
  opts?: { avoidProvider?: string },
): Promise<VerifyResult[]> {
  const results: VerifyResult[] = questions.map(() => ({ verdict: "verified", reason: "" }));

  const checkable = questions
    .map((q, i) => ({ q, i }))
    .filter(({ q }) => {
      const t = q.type.toUpperCase();
      return t === "MCQ" || t === "TRUE_FALSE";
    });
  if (checkable.length === 0) return results;

  for (let s = 0; s < checkable.length; s += VERIFY_BATCH_SIZE) {
    const batch = checkable.slice(s, s + VERIFY_BATCH_SIZE);
    const items = batch.map((b, localIndex) => ({ localIndex, q: b.q }));
    const raw = await runVerifierChat(buildVerifyPrompt(items, subject, grade), opts?.avoidProvider);

    const verdictMap = new Map<number, { answer?: unknown; correctCount?: unknown; reason?: unknown }>();
    if (raw) {
      try {
        const parsed = JSON.parse(raw);
        for (const v of Array.isArray(parsed.verdicts) ? parsed.verdicts : []) {
          verdictMap.set(Number(v.index), v);
        }
      } catch {
        /* leave map empty → those items become unverified below */
      }
    }

    batch.forEach((b, localIndex) => {
      // Fail closed: no verifier response at all ⇒ unverified.
      results[b.i] = raw
        ? resolveVerdict(b.q, verdictMap.get(localIndex))
        : { verdict: "unverified", reason: "Verifier unavailable", flag: "UNVERIFIED" };
    });
  }

  return results;
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
  grade: number,
  generatorProvider?: string,
  /**
   * Question texts ALREADY SAVED for this chapter. Duplicate detection used to
   * compare a batch only against itself, so generating ten times produced the
   * same question ten times and nothing noticed — the repeats were only ever
   * visible once they were all in the database. Passing the existing bank makes
   * each new question checkable against what the chapter already has.
   */
  existingQuestions: string[] = []
): Promise<QualityPipelineResult> {
  // Pre-compute all embeddings in a single batch (source windows + all
  // questions). The source is split into windows so relevance is scored against
  // the WHOLE document, not just its opening 5k characters. Sharing one batched
  // call keeps duplicate detection and relevance scoring on a single API round.
  const sourceWindows = splitSourceForRelevance(sourceContent);
  // Cap the saved bank so a large chapter cannot make this call unbounded.
  // Newest first: a repeat of something generated recently is the likely case.
  const existingSlice = existingQuestions.slice(0, MAX_EXISTING_COMPARED);
  const allTexts = [
    ...sourceWindows,
    ...questions.map((q) => q.questionText),
    ...existingSlice,
  ];
  let sourceEmbeddings: number[][] = [];
  let questionEmbeddings: number[][] = [];
  let existingEmbeddings: number[][] = [];

  try {
    const embeddingResults = await generateEmbeddings(allTexts);
    sourceEmbeddings = embeddingResults
      .slice(0, sourceWindows.length)
      .map((r) => r.embedding);
    questionEmbeddings = embeddingResults
      .slice(sourceWindows.length, sourceWindows.length + questions.length)
      .map((r) => r.embedding);
    existingEmbeddings = embeddingResults
      .slice(sourceWindows.length + questions.length)
      .map((r) => r.embedding);
  } catch (error) {
    console.warn("[Quality Pipeline] Embedding generation failed, skipping similarity checks:", error);
  }

  // Single combined AI check (difficulty + grammar + factual accuracy).
  // Groq-first provider order prevents the Gemini rate-limit collisions
  // that occurred when two parallel AI calls hit the same endpoint.
  // Each question's closest source window, used as the scope yardstick. The
  // embeddings for both are already computed above, so this costs nothing.
  const questionExcerpts: string[][] = questions.map((_, i) => {
    const qe = questionEmbeddings[i];
    if (!qe || sourceEmbeddings.length === 0) return [];
    return sourceEmbeddings
      .map((se, w) => ({ w, sim: cosineSimilarity(qe, se) }))
      .sort((a, b) => b.sim - a.sim)
      .slice(0, SCOPE_WINDOWS_PER_QUESTION)
      .map(({ w }) => sourceWindows[w]);
  });

  const aiChecksMap = await runAIQualityChecks(questions, subject, grade, questionExcerpts);
  // Independent-solver verification (blind re-solve, cross-model, fail-closed).
  const verifyResults = await verifyQuestions(questions, subject, grade, {
    avoidProvider: generatorProvider,
  });
  const duplicateResult = detectDuplicates(questions, questionEmbeddings);
  const existingDupes = detectExistingDuplicates(questionEmbeddings, existingEmbeddings, existingSlice);
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

    // 5b. Repeat of a question the chapter already has. Penalised harder than
    // an in-batch duplicate: one of a duplicate pair is still worth keeping,
    // whereas this one adds nothing the bank does not already contain.
    const existingHit = existingDupes.get(idx);
    if (existingHit) {
      flags.push("DUPLICATE_EXISTING");
      details["DUPLICATE_EXISTING"] = existingHit;
      penalty += 0.35;
    }

    // 5c. Implausible distractor — narrows the question without testing anything.
    if (aiCheck?.weakDistractor) {
      flags.push("WEAK_DISTRACTOR");
      details["WEAK_DISTRACTOR"] = aiCheck.weakDistractor;
      penalty += 0.15;
    }

    // 5d. Needs a formula or constant this chapter never states — but only
    // when the full source does not contradict the claim (see above).
    if (aiCheck?.scopeIssue) {
      if (scopeClaimContradicted(aiCheck.scopeIssue, sourceContent)) {
        console.info(
          `[Quality] Scope flag on Q${idx + 1} dropped — the source does contain it: "${aiCheck.scopeIssue}"`
        );
      } else {
        flags.push("OUT_OF_SCOPE");
        details["OUT_OF_SCOPE"] = aiCheck.scopeIssue;
        penalty += 0.3;
      }
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

    // 9. Independent-solver verdict (authoritative correctness gate)
    const verify = verifyResults[idx];
    const verified = verify?.verdict === "verified";
    if (verify && verify.verdict !== "verified") {
      const flag = verify.flag ?? "UNVERIFIED";
      flags.push(flag);
      details[flag] = verify.reason;
      // A disagreeing/ambiguous answer is severe; an unverifiable one is a
      // softer flag but still blocks the student (verified === false) below.
      penalty += verify.verdict === "rejected" ? 0.5 : 0.2;
    }

    const qualityScore = Math.max(0, Math.round((1 - penalty) * 100) / 100);

    return {
      questionIndex: idx,
      qualityScore,
      flags,
      details,
      passed: qualityScore >= QUALITY_PASS_THRESHOLD,
      verified,
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
