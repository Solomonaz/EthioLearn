/**
 * Per-question time budget for timed play (Timed mode + Battle).
 *
 * 5-Tier Cognitive Load Timing Engine:
 * - Tier 1 (20s): Quick Recall (< 26 words, single-word/short choices, unit definitions)
 * - Tier 2 (30s): Standard Conceptual (26–47 words, short range/fact recognition like visible light)
 * - Tier 3 (45s): Moderate Calculation / Medium Reading (48–67 words, 1-step formula with 1 prompt number)
 * - Tier 4 (60s): Long Analytical / Wordy Scenario (68–109 words, multi-sentence choices, 2-step math)
 * - Tier 5 (80s): Deep Problem (>= 110 words, heavy multi-step physics, scientific notation, >= 3 prompt numbers)
 *
 * Pure and dependency-free so both the client (quiz store) and the battle
 * server can share it.
 */

export interface TimingQuestion {
  type?: string;
  difficulty?: string;
  questionText?: string;
  options?: (string | { text?: string })[];
}

// Basic math & science units/operators (with word boundaries to avoid false positives)
const NUMERIC_UNITS_RE =
  /(=|\+|×|·|\*|\/|\^|√|½|\bN\b|\bkg\b|\bm\/s|\bN\/C\b|\bJ\b|\bW\b|°C|μC|\bmol\b|Ω|Δ|\bm²|\bm\^2|\bHz\b|\bPa\b|\bkm\/h\b|\bcm\b|\bmm\b|\beV\b|\bkW\b|\brad\/s\b|\bm\b|\bs\b|\bkm\b|\bmin\b|\bh\b)/i;

// Advanced / multi-step math signals (scientific notation, exponents, roots, trig, complex physics topics)
const COMPLEX_FORMULA_RE =
  /(10\^|10\s*[-\u2212]\s*\d|\b\d+\s*[x×]\s*10|\b(sin|cos|tan)\b|√|\^|²|³|\b(conservation|projectile|trajectory|efficiency|refractive index|half[-\s]?life|photoelectric|capacitance|inductance)\b)/i;

// Reading/interpreting a described graph or figure (with word boundaries to avoid matching "photograph", "paragraph")
const GRAPHICAL_RE =
  /\bgraphs?\b|\bplots?\b|\bcurves?\b|\baxis\b|\baxes\b|\bslopes?\b|\bgradients?\b|area under|intercept|velocity[-\s]?time|distance[-\s]?time/i;

// Identifying questions asking for unit definitions (e.g. "What is the SI unit of...", "measured in")
const UNIT_QUESTION_RE =
  /what (is|are) the (SI |standard )?unit|measured in|expressed in units of|\bunit of\b/i;

/**
 * Returns word count of a string.
 */
function countWords(str: string): number {
  return str.trim().split(/\s+/).filter(Boolean).length;
}

/**
 * Extracts words and metrics from a question object.
 */
function getQuestionMetrics(q: TimingQuestion) {
  const qText = (q.questionText ?? "").trim();
  const optTexts = (q.options ?? []).map((o) =>
    (typeof o === "string" ? o : o?.text ?? "").trim()
  );
  const fullText = `${qText} ${optTexts.join(" ")}`.trim();

  const totalWords = countWords(fullText);
  const qWords = countWords(qText);
  const optWordCounts = optTexts.map(countWords);
  const maxOptWords = Math.max(0, ...optWordCounts);
  const avgOptWords =
    optWordCounts.length > 0
      ? optWordCounts.reduce((a, b) => a + b, 0) / optWordCounts.length
      : 0;

  // Crucial distinction: Numbers in the QUESTION PROMPT vs numbers in the MULTIPLE-CHOICE OPTIONS.
  // A question cannot be a calculation problem if the prompt itself provides no numbers to calculate with!
  const qNumbers = qText.match(/\b\d+(\.\d+)?\b/g) ?? [];
  const optNumbers = optTexts.join(" ").match(/\b\d+(\.\d+)?\b/g) ?? [];
  const qNumCount = qNumbers.length;

  const isUnitQuestion = UNIT_QUESTION_RE.test(qText);
  const qHasUnits = NUMERIC_UNITS_RE.test(qText);
  const qHasComplexMath = COMPLEX_FORMULA_RE.test(qText);
  const hasGraph = GRAPHICAL_RE.test(qText);

  // A genuine calculation prompt must have at least 1 number in the question text and physics/math indicators
  const isCalculationPrompt = !isUnitQuestion && qNumCount >= 1 && (qHasUnits || qHasComplexMath);

  return {
    totalWords,
    qWords,
    maxOptWords,
    avgOptWords,
    qNumCount,
    optNumbersCount: optNumbers.length,
    isUnitQuestion,
    qHasUnits,
    qHasComplexMath,
    hasGraph,
    isCalculationPrompt,
  };
}

// 5-Tier Battle Mode Durations
export const BATTLE_TIER_1_SECONDS = 20; // Tier 1: Quick Recall
export const BATTLE_TIER_2_SECONDS = 30; // Tier 2: Standard Conceptual
export const BATTLE_TIER_3_SECONDS = 45; // Tier 3: Moderate Calculation / Medium Reading
export const BATTLE_TIER_4_SECONDS = 60; // Tier 4: Long Reading / Wordy Choices / 2-Step Math
export const BATTLE_TIER_5_SECONDS = 80; // Tier 5: Heavy Multi-step Physics / Deep Problem

// Compatibility exports
export const BATTLE_BASE_SECONDS = BATTLE_TIER_1_SECONDS;
export const BATTLE_STANDARD_SECONDS = BATTLE_TIER_2_SECONDS;
export const BATTLE_HEAVY_SECONDS = BATTLE_TIER_5_SECONDS;
export const BATTLE_RECALL_SECONDS = BATTLE_TIER_1_SECONDS;

/**
 * Assigns a 5-tier time limit based on cognitive reading load and true calculation intensity.
 */
export function getBattleSeconds(q: TimingQuestion): number {
  const {
    totalWords,
    qWords,
    maxOptWords,
    avgOptWords,
    qNumCount,
    optNumbersCount,
    isUnitQuestion,
    qHasComplexMath,
    hasGraph,
    isCalculationPrompt,
  } = getQuestionMetrics(q);

  const diff = String(q.difficulty ?? "MEDIUM").toUpperCase();

  // Unit questions (e.g. "What is the standard SI unit of angular acceleration?") are always 20s
  if (isUnitQuestion && totalWords < 40) {
    return BATTLE_TIER_1_SECONDS; // 20s
  }

  // ── Tier 5: 80 Seconds (Heavy Multi-Step Calculation / Deepest Problem) ──
  // Triggers ONLY if:
  // 1. Massive reading load (>= 110 words total)
  // 2. Heavy multi-step math with scientific notation or >= 3 given numbers in prompt
  // 3. Complex formula (trig, projectiles, vectors) with >= 2 given numbers in prompt
  const isTier5Calculation =
    isCalculationPrompt &&
    ((qHasComplexMath && qNumCount >= 2) || qNumCount >= 3);

  if (totalWords >= 110 || isTier5Calculation) {
    return BATTLE_TIER_5_SECONDS; // 80s
  }

  // ── Tier 4: 60 Seconds (Long Analytical Reading / 2-Step Calculation) ──
  // Triggers if:
  // 1. Long wordy scenario (>= 68 words total)
  // 2. High choice length (avgOptWords >= 9 or maxOptWords >= 12 with totalWords >= 58)
  // 3. Dense question prompt (qWords >= 35 with totalWords >= 58)
  // 4. Standard 2-step calculation (>= 2 given numbers in prompt)
  const isTier4Reading =
    totalWords >= 68 ||
    (totalWords >= 58 && avgOptWords >= 9) ||
    (totalWords >= 58 && maxOptWords >= 12) ||
    (qWords >= 35 && totalWords >= 58);

  const isTier4Calculation = isCalculationPrompt && qNumCount >= 2;

  if (isTier4Reading || isTier4Calculation || (hasGraph && qNumCount >= 1)) {
    return BATTLE_TIER_4_SECONDS; // 60s
  }

  // ── Tier 3: 45 Seconds (Moderate Calculation / Medium Reading) ──
  // Triggers if:
  // 1. Moderate reading load (48–67 words total)
  // 2. Standard 1-step calculation (1 given number in prompt with formula/unit)
  // 3. Interpreting a described graph/curve
  const isTier3Reading = totalWords >= 48 || avgOptWords >= 6;
  const isTier3Calculation = isCalculationPrompt && qNumCount >= 1;

  if (isTier3Reading || isTier3Calculation || hasGraph) {
    return BATTLE_TIER_3_SECONDS; // 45s
  }

  // ── Tier 2: 30 Seconds (Standard Conceptual / Short Range Recognition) ──
  // Triggers if:
  // 1. Standard text (26–47 words total)
  // 2. Multiple-choice numerical range recognition (like visible light 400–700 nm)
  // 3. Medium difficulty
  if (totalWords >= 26 || optNumbersCount >= 2 || diff === "MEDIUM") {
    return BATTLE_TIER_2_SECONDS; // 30s
  }

  // ── Tier 1: 20 Seconds (Quick Recall) ──
  // Short text (< 26 words total), direct definition, or factual recall
  return BATTLE_TIER_1_SECONDS; // 20s
}

/**
 * Full per-question budget for Timed (solo) play.
 */
export function getQuestionSeconds(q: TimingQuestion): number {
  const battleSecs = getBattleSeconds(q);
  const diff = String(q.difficulty ?? "MEDIUM").toUpperCase();

  // In solo play, grant slightly more buffer based on the tier
  let secs = battleSecs;
  if (battleSecs >= BATTLE_TIER_4_SECONDS) {
    secs = Math.min(battleSecs + 15, 90);
  } else if (battleSecs >= BATTLE_TIER_3_SECONDS) {
    secs = battleSecs + 10;
  } else if (diff === "EASY") {
    secs = 20;
  }

  // Match/ordering questions require more taps
  const type = String(q.type ?? "MCQ").toUpperCase();
  if (type === "MATCH_PAIRS" || type === "ORDERING") secs += 10;

  return Math.min(secs, 90);
}

/**
 * Legacy compatibility helper.
 */
export function isHeavyQuestion(q: TimingQuestion): boolean {
  return getBattleSeconds(q) >= BATTLE_TIER_3_SECONDS;
}
