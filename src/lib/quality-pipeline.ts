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
  | "DUPLICATE_QUESTION"   // Semantically similar to another question (>0.85)
  | "GRAMMAR_ISSUE"        // Grammar/clarity problems
  | "EMPTY_EXPLANATION"    // Missing explanation
  | "TOO_SHORT"            // Question text suspiciously short
  | "AMBIGUOUS"            // Potentially ambiguous question
  | "FACTUAL_ERROR"        // Correct answer or premise is factually wrong
  | "META_REFERENCE";      // Question text references "the chapter / the text"

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

// ─── Constants ──────────────────────────────────────────

const QUALITY_PASS_THRESHOLD = 0.6;
const RELEVANCE_THRESHOLD = 0.5;
const DUPLICATE_THRESHOLD = 0.85;
const MIN_QUESTION_LENGTH = 15;

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

  return flags;
}

// ─── 3. Consolidated AI Text Quality Check ───────────────

async function verifyAITextQuality(
  questions: GeneratedQuestion[],
  subject: string,
  grade: number
): Promise<{
  difficulties: Map<number, { aiDifficulty: string; match: boolean }>;
  grammarIssues: Map<number, string>;
}> {
  const result = {
    difficulties: new Map<number, { aiDifficulty: string; match: boolean }>(),
    grammarIssues: new Map<number, string>(),
  };

  const questionList = questions
    .slice(0, 20)
    .map((q, i) => `Q${i}: [${q.type}] difficulty: ${q.difficulty}\n${q.questionText.slice(0, 300)}`)
    .join("\n");

  const prompt = `You are an expert at reviewing exam questions for Grade ${grade} ${subject} in the Ethiopian curriculum.

TASK 1: RATING DIFFICULTY
Rate each question's difficulty as EASY, MEDIUM, or HARD:
- EASY: Direct recall, simple facts, basic definitions
- MEDIUM: Comprehension, application of learned concepts
- HARD: Analysis, synthesis, multi-step reasoning

TASK 2: GRAMMAR AND CLARITY
Flag ONLY questions with clear structural/grammatical issues or extreme ambiguity. DO NOT flag grammatically correct questions.

QUESTIONS:
${questionList}

Return JSON only:
{
  "ratings": [{ "index": 0, "difficulty": "EASY|MEDIUM|HARD" }, ...],
  "issues": [{ "index": 0, "issue": "description of the grammar problem" } ...]
}
If there are no grammar issues, leave the issues array empty.`;

  let rawText = "";

  // 1. Ollama Mistral (local, no quota)
  try {
    const raw = await ollamaChat(prompt);
    if (raw) rawText = raw;
  } catch {
    // fall through
  }

  // 2. Gemini
  if (!rawText && process.env.GEMINI_API_KEY) {
    try {
      const client = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
      const model = client.getGenerativeModel({
        model: "gemini-2.0-flash",
        generationConfig: { responseMimeType: "application/json", temperature: 0.1, maxOutputTokens: 1536 },
      });
      rawText = (await model.generateContent(prompt)).response.text();
    } catch (err) {
      if (String(err).includes("429")) console.warn("[Quality Pipeline] Gemini rate-limited.");
    }
  }

  // 3. Groq
  if (!rawText && process.env.GROQ_API_KEY) {
    try {
      const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });
      const res = await groq.chat.completions.create({
        model: "llama-3.3-70b-versatile",
        messages: [{ role: "user", content: prompt }],
        temperature: 0.1,
        max_tokens: 1536,
        response_format: { type: "json_object" },
      });
      rawText = res.choices[0]?.message?.content ?? "";
    } catch (fallbackError) {
      console.warn("[Quality Pipeline] All providers failed text quality check:", fallbackError instanceof Error ? fallbackError.message : String(fallbackError));
      return result;
    }
  }

  if (!rawText) return result;

  try {
    const parsed = JSON.parse(rawText);
    
    // Parse difficulty ratings
    const ratings = Array.isArray(parsed.ratings) ? parsed.ratings : [];
    for (const r of ratings) {
      const idx = Number(r.index);
      const aiDiff = String(r.difficulty).toUpperCase();
      if (idx >= 0 && idx < questions.length && ["EASY", "MEDIUM", "HARD"].includes(aiDiff)) {
        result.difficulties.set(idx, { aiDifficulty: aiDiff, match: aiDiff === questions[idx].difficulty.toUpperCase() });
      }
    }

    // Parse grammar issues
    const issues = Array.isArray(parsed.issues) ? parsed.issues : [];
    for (const item of issues) {
      const idx = Number(item.index);
      if (idx >= 0 && idx < questions.length && typeof item.issue === "string") {
        result.grammarIssues.set(idx, item.issue);
      }
    }
  } catch {
    // JSON parse failed — skip check silently
  }

  return result;
}

// ─── 4b. Factual Accuracy Check ────────────────────────

/**
 * Ask an AI model to verify that each question's premise and marked correct
 * answer are factually accurate. Runs in a single batched call for efficiency.
 * Returns a map of question index → { passed, reason }.
 */
async function factCheckQuestions(
  questions: GeneratedQuestion[],
  subject: string,
  grade: number
): Promise<Map<number, { passed: boolean; reason: string }>> {
  const result = new Map<number, { passed: boolean; reason: string }>();

  const questionList = questions
    .slice(0, 20)
    .map((q, i) => {
      const opts = q.options
        .map((o, j) => `  ${String.fromCharCode(65 + j)}. ${o}`)
        .join("\n");
      return `Q${i} [${q.type}]:\nQuestion: ${q.questionText}\nOptions:\n${opts}\nMarked correct: ${q.correctAnswer}`;
    })
    .join("\n\n");

  const prompt = `You are a strict fact-checker for Grade ${grade} ${subject} exam questions.

For EACH question verify ALL THREE of the following:
1. Is the question stem/premise itself factually accurate?
2. Is the marked correct answer genuinely the ONLY correct answer among the options?
3. Are there any other options that could also be considered correct (ambiguous)?

Respond PASS only when all three checks pass with full confidence.
Respond FAIL with a concise reason whenever any check fails.

QUESTIONS:
${questionList}

Return JSON only — no markdown:
{
  "checks": [
    { "index": 0, "passed": true, "reason": "" },
    { "index": 1, "passed": false, "reason": "Premise is wrong: primary sexual characteristics are present from birth, not developed during puberty." }
  ]
}`;

  let rawText = "";

  // Provider fallback: Ollama → Gemini → Groq (same order as rest of pipeline)
  try {
    const raw = await ollamaChat(prompt);
    if (raw) rawText = raw;
  } catch { /* fall through */ }

  if (!rawText && process.env.GEMINI_API_KEY) {
    try {
      const client = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
      const model = client.getGenerativeModel({
        model: "gemini-2.0-flash",
        generationConfig: { responseMimeType: "application/json", temperature: 0.1, maxOutputTokens: 2048 },
      });
      rawText = (await model.generateContent(prompt)).response.text();
    } catch (err) {
      if (String(err).includes("429")) console.warn("[Quality Pipeline] Gemini rate-limited (fact-check).");
    }
  }

  if (!rawText && process.env.GROQ_API_KEY) {
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
    } catch (e) {
      console.warn("[Quality Pipeline] All providers failed fact-check:", e instanceof Error ? e.message : String(e));
      return result;
    }
  }

  if (!rawText) return result;

  try {
    const parsed = JSON.parse(rawText);
    const checks = Array.isArray(parsed.checks) ? parsed.checks : [];
    for (const c of checks) {
      const idx = Number(c.index);
      if (idx >= 0 && idx < questions.length && typeof c.passed === "boolean") {
        result.set(idx, {
          passed: c.passed,
          reason: typeof c.reason === "string" ? c.reason : "",
        });
      }
    }
  } catch {
    // JSON parse failed — skip silently, questions proceed without factual flag
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

function checkRelevance(
  questions: GeneratedQuestion[],
  sourceEmbedding: number[],
  questionEmbeddings: number[][]
): Map<number, number> {
  const relevanceScores = new Map<number, number>();

  for (let i = 0; i < questions.length; i++) {
    if (questionEmbeddings[i]) {
      relevanceScores.set(i, cosineSimilarity(sourceEmbedding, questionEmbeddings[i]));
    }
  }

  return relevanceScores;
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
  // Pre-compute all embeddings in a single batch (source + all questions).
  // This avoids making 2N+1 separate embedding calls by sharing one N+1 call
  // between duplicate detection and relevance scoring.
  const sourceSnippet = sourceContent.slice(0, 5000);
  const allTexts = [sourceSnippet, ...questions.map((q) => q.questionText)];
  let sourceEmbedding: number[] = [];
  let questionEmbeddings: number[][] = [];

  try {
    const embeddingResults = await generateEmbeddings(allTexts);
    sourceEmbedding = embeddingResults[0].embedding;
    questionEmbeddings = embeddingResults.slice(1).map((r) => r.embedding);
  } catch (error) {
    console.warn("[Quality Pipeline] Embedding generation failed, skipping similarity checks:", error);
  }

  // Run AI checks in parallel: text quality + factual accuracy
  const [aiTextQuality, factCheckMap] = await Promise.all([
    verifyAITextQuality(questions, subject, grade),
    factCheckQuestions(questions, subject, grade),
  ]);
  const duplicateResult = detectDuplicates(questions, questionEmbeddings);
  const relevanceMap = checkRelevance(questions, sourceEmbedding, questionEmbeddings);

  const difficultyMap = aiTextQuality.difficulties;
  const grammarMap = aiTextQuality.grammarIssues;

  const duplicateIndices = new Set(
    duplicateResult.duplicatePairs.flat()
  );

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
    }

    // 3. Relevance check
    const relevance = relevanceMap.get(idx);
    if (relevance !== undefined && relevance < RELEVANCE_THRESHOLD) {
      flags.push("LOW_RELEVANCE");
      details["LOW_RELEVANCE"] = `Cosine similarity to source: ${relevance.toFixed(3)} (threshold: ${RELEVANCE_THRESHOLD})`;
      penalty += 0.25;
    }

    // 4. Difficulty mismatch
    const diffCheck = difficultyMap.get(idx);
    if (diffCheck && !diffCheck.match) {
      flags.push("DIFFICULTY_MISMATCH");
      details["DIFFICULTY_MISMATCH"] = `Declared: ${q.difficulty}, AI rated: ${diffCheck.aiDifficulty}`;
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
    const grammarIssue = grammarMap.get(idx);
    if (grammarIssue) {
      flags.push("GRAMMAR_ISSUE");
      details["GRAMMAR_ISSUE"] = grammarIssue;
      penalty += 0.15;
    }

    // 7. Factual accuracy
    const factCheck = factCheckMap.get(idx);
    if (factCheck && !factCheck.passed) {
      flags.push("FACTUAL_ERROR");
      details["FACTUAL_ERROR"] = factCheck.reason || "Factual accuracy check failed";
      penalty += 0.45; // Severe — a wrong correct answer directly harms students
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
