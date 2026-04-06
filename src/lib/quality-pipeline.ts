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
import { generateEmbeddings, cosineSimilarity } from "./embeddings";

// ─── Types ──────────────────────────────────────────────

export type QualityFlag =
  | "LOW_RELEVANCE"        // Cosine similarity to source < 0.5
  | "INVALID_ANSWER"       // correctAnswer not in options, wrong format
  | "DIFFICULTY_MISMATCH"  // AI-rated difficulty differs from declared
  | "DUPLICATE_QUESTION"   // Semantically similar to another question (>0.85)
  | "GRAMMAR_ISSUE"        // Grammar/clarity problems
  | "EMPTY_EXPLANATION"    // Missing explanation
  | "TOO_SHORT"            // Question text suspiciously short
  | "AMBIGUOUS";           // Potentially ambiguous question

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

  return flags;
}

// ─── 3. Difficulty Verification via AI ─────────────────

async function verifyDifficulties(
  questions: GeneratedQuestion[],
  subject: string,
  grade: number
): Promise<Map<number, { aiDifficulty: string; match: boolean }>> {
  const result = new Map<number, { aiDifficulty: string; match: boolean }>();

  try {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) return result;

    const client = new GoogleGenerativeAI(apiKey);
    const model = client.getGenerativeModel({
      model: "gemini-2.0-flash",
      generationConfig: {
        responseMimeType: "application/json",
        temperature: 0.1,
        maxOutputTokens: 2048,
      },
    });

    const questionList = questions
      .slice(0, 20) // Limit batch size
      .map(
        (q, i) =>
          `Q${i}: [${q.type}] ${q.questionText.slice(0, 200)}`
      )
      .join("\n");

    const prompt = `You are an expert at rating exam question difficulty for Grade ${grade} ${subject} in the Ethiopian curriculum.

Rate each question's difficulty as EASY, MEDIUM, or HARD based on:
- EASY: Direct recall, simple facts, basic definitions
- MEDIUM: Comprehension, application of learned concepts
- HARD: Analysis, synthesis, multi-step reasoning

QUESTIONS:
${questionList}

Return JSON: { "ratings": [{ "index": 0, "difficulty": "EASY|MEDIUM|HARD" }, ...] }`;

    const aiResult = await model.generateContent(prompt);
    const parsed = JSON.parse(aiResult.response.text());
    const ratings = Array.isArray(parsed.ratings) ? parsed.ratings : [];

    for (const r of ratings) {
      const idx = Number(r.index);
      const aiDiff = String(r.difficulty).toUpperCase();
      if (idx >= 0 && idx < questions.length && ["EASY", "MEDIUM", "HARD"].includes(aiDiff)) {
        result.set(idx, {
          aiDifficulty: aiDiff,
          match: aiDiff === questions[idx].difficulty.toUpperCase(),
        });
      }
    }
  } catch (error) {
    console.error("[Quality Pipeline] Difficulty verification failed:", error);
  }

  return result;
}

// ─── 4. Grammar/Language Check via AI ──────────────────

async function checkGrammar(
  questions: GeneratedQuestion[]
): Promise<Map<number, string>> {
  const issues = new Map<number, string>();

  try {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) return issues;

    const client = new GoogleGenerativeAI(apiKey);
    const model = client.getGenerativeModel({
      model: "gemini-2.0-flash",
      generationConfig: {
        responseMimeType: "application/json",
        temperature: 0.1,
        maxOutputTokens: 2048,
      },
    });

    const questionList = questions
      .slice(0, 20)
      .map((q, i) => `Q${i}: ${q.questionText.slice(0, 300)}`)
      .join("\n");

    const prompt = `Review these exam questions for grammar, clarity, and language quality.
Flag ONLY questions with clear issues (grammatical errors, unclear phrasing, ambiguity).
Do NOT flag questions that are grammatically correct.

QUESTIONS:
${questionList}

Return JSON: { "issues": [{ "index": 0, "issue": "description of the problem" }, ...] }
If no issues are found, return: { "issues": [] }`;

    const result = await model.generateContent(prompt);
    const parsed = JSON.parse(result.response.text());

    if (Array.isArray(parsed.issues)) {
      for (const item of parsed.issues) {
        const idx = Number(item.index);
        if (idx >= 0 && idx < questions.length && typeof item.issue === "string") {
          issues.set(idx, item.issue);
        }
      }
    }
  } catch (error) {
    console.error("[Quality Pipeline] Grammar check failed:", error);
  }

  return issues;
}

// ─── 5. Semantic Duplicate Detection ───────────────────

async function detectDuplicates(
  questions: GeneratedQuestion[]
): Promise<{ duplicatePairs: [number, number][]; similarities: Map<string, number> }> {
  const duplicatePairs: [number, number][] = [];
  const similarities = new Map<string, number>();

  if (questions.length < 2) return { duplicatePairs, similarities };

  try {
    // Generate embeddings for all question texts
    const texts = questions.map((q) => q.questionText);
    const embeddingResults = await generateEmbeddings(texts);
    const embeddings = embeddingResults.map((r) => r.embedding);

    // Pairwise comparison
    for (let i = 0; i < embeddings.length; i++) {
      for (let j = i + 1; j < embeddings.length; j++) {
        const sim = cosineSimilarity(embeddings[i], embeddings[j]);
        const key = `${i}-${j}`;
        similarities.set(key, sim);

        if (sim >= DUPLICATE_THRESHOLD) {
          duplicatePairs.push([i, j]);
        }
      }
    }
  } catch (error) {
    console.error("[Quality Pipeline] Duplicate detection failed:", error);
  }

  return { duplicatePairs, similarities };
}

// ─── 6. Relevance Check (question vs source content) ───

async function checkRelevance(
  questions: GeneratedQuestion[],
  sourceContent: string
): Promise<Map<number, number>> {
  const relevanceScores = new Map<number, number>();

  try {
    // Embed the source content (use first 5000 chars as representative)
    const sourceSnippet = sourceContent.slice(0, 5000);
    const allTexts = [sourceSnippet, ...questions.map((q) => q.questionText)];

    const embeddingResults = await generateEmbeddings(allTexts);
    const sourceEmbedding = embeddingResults[0].embedding;

    for (let i = 1; i < embeddingResults.length; i++) {
      const sim = cosineSimilarity(sourceEmbedding, embeddingResults[i].embedding);
      relevanceScores.set(i - 1, sim);
    }
  } catch (error) {
    console.error("[Quality Pipeline] Relevance check failed:", error);
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
  // Run all checks in parallel
  const [difficultyMap, grammarMap, duplicateResult, relevanceMap] =
    await Promise.all([
      verifyDifficulties(questions, subject, grade),
      checkGrammar(questions),
      detectDuplicates(questions),
      checkRelevance(questions, sourceContent),
    ]);

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
