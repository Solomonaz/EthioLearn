/**
 * Shared prompt builders for question generation.
 *
 * This is the single source of truth for how we ask ANY LLM provider
 * (Groq, Gemini, Ollama, etc.) to produce exam questions. Keeping the
 * prompt centralized means a single edit here improves quality across
 * every provider simultaneously.
 *
 * Design goals (addressing observed quality issues):
 *   1. Difficulty is tied to Bloom's Taxonomy so HARD actually means hard.
 *   2. TRUE_FALSE is restricted to EASY / MEDIUM (never HARD — 50% guess rate).
 *   3. The correct answer must NOT appear verbatim in the question text,
 *      and the question must not trivially "define" the answer.
 *   4. MCQ distractors must be plausible, same-domain, and non-obvious.
 *   5. A generated batch must cover diverse subtopics — no repetition.
 *   6. The model is asked to self-audit each question before emitting it.
 */

import type { GenerateOptions } from "./gemini";

// ─── Difficulty rubric (Bloom-aligned) ─────────────────────────────────────

const DIFFICULTY_RUBRIC = `DIFFICULTY RUBRIC (STRICT — follow Bloom's Taxonomy):
• EASY   → Bloom levels 1–2 (Remember / Understand).
           Direct recall of a definition, fact, name, or date stated in the text.
           One-step reasoning. Answerable from a single sentence.
• MEDIUM → Bloom levels 3–4 (Apply / Analyze).
           Requires applying a concept to a new example, comparing two ideas,
           identifying cause-and-effect, or interpreting a short scenario.
           Cannot be answered by copy-pasting a single sentence.
• HARD   → Bloom levels 5–6 (Evaluate / Create).
           Requires multi-step reasoning, synthesis across multiple paragraphs,
           evaluating competing claims, justifying a conclusion, or solving a
           non-trivial problem. A well-prepared student should still need to
           think carefully. A question is NOT HARD just because it's labelled HARD.

           HARD question templates — use these as structural models:
           • "A [cell/organism/system] is exposed to [novel scenario from chapter].
             Based on [specific process named in chapter], what would most likely
             happen and why?"
           • "Given that [Fact A from chapter] and [Fact B from chapter] are both
             true, which conclusion is best supported by both?"
           • "A student claims [common misconception about a chapter concept].
             Which evidence from the chapter BEST refutes this claim?"
           • "Which of the following would MOST LIKELY result if [specific process
             from chapter] were disrupted, and what is the reason?"
           • "Compare [Concept A] and [Concept B] from the chapter. In what
             situation would [A] be more appropriate than [B], and why?"

SELF-CHECK: Before labelling a question HARD, confirm it satisfies AT LEAST ONE of:
  (a) requires combining two or more distinct facts from different parts of the content,
  (b) requires a calculation, derivation, or multi-step inference,
  (c) requires evaluating or justifying why one option is better than another,
  (d) requires applying a concept to a novel scenario not stated verbatim in the text.
If none apply, downgrade it to MEDIUM.
ADDITIONALLY: A question is NOT HARD if a student can answer it by:
  - reading a single sentence from the chapter,
  - eliminating obviously wrong options without knowing the content,
  - using general common sense without having studied the chapter.`;

// ─── Universal quality rules ───────────────────────────────────────────────

const QUALITY_RULES = `QUALITY RULES (apply to EVERY question):
Q1. ANSWER-LEAKAGE BAN: The correct answer (or a near-synonym) MUST NOT appear
    verbatim in the questionText. The question must not contain a phrase that
    uniquely defines the answer (e.g. do NOT ask "What period lasted from the
    5th to the 15th century?" when the answer is "The Middle Ages" — the dates
    are the definition).
Q2. DISTRACTOR QUALITY (MCQ): All 3 wrong options must be PLAUSIBLE,
    belong to the same category/domain as the correct answer, and represent
    realistic student misconceptions. No joke options, no obviously-out-of-scope
    options, no options from a different time period / subject / unit.
Q3. TOPIC DIVERSITY: Across the whole batch, cover DIFFERENT subtopics from the
    chapter. Do not generate multiple questions testing the exact same fact.
    Aim for broad coverage of the chapter content.
Q4. TRUE_FALSE DIFFICULTY CAP: TRUE_FALSE questions may ONLY be labelled EASY
    or MEDIUM — never HARD. (Binary questions have a 50% random-guess rate and
    cannot meaningfully test HARD-level reasoning.)
Q5. FILL_IN_BLANK QUALITY: The blank must remove a meaningful, specific term
    (a concept, number, name, or technical word) — not a common stop-word and
    not a word whose answer is already present elsewhere in the sentence.
Q6. NO TRICK QUESTIONS: Avoid double negatives, ambiguous wording, "all of the
    above / none of the above", and culturally loaded phrasing.
Q7. GROUNDED IN CONTENT: Every question must be answerable from the chapter
    content below. Do NOT invent facts, dates, or names not present in the text.
Q8. EXPLANATION QUALITY: Each explanation must cite the concept from the
    chapter and briefly state WHY the correct answer is right AND why the
    main distractor is wrong (for MCQ).
Q9. FACTUAL ACCURACY: Before emitting each question, independently verify that
    the correct answer is (a) supported by the chapter content AND (b) consistent
    with established, universally accepted science. If any doubt exists about the
    scientific accuracy of the answer, discard the question and generate a
    different one. Do NOT trust a plausible-sounding answer — confirm it.
    EXAMPLE OF ERROR TO AVOID: marking "The cell is the lowest level of biological
    organization" as correct, when atoms, molecules, and organelles are all lower
    levels. The cell is the basic unit of LIFE, not the lowest level of organization.
Q10. NO GENERIC QUESTIONS: Every question must be specific to named facts,
    processes, numbers, or terminology from THIS chapter. Reject any question
    that a student could answer correctly using only general common sense or
    background domain knowledge, without having read this specific chapter.
    LITMUS TEST: mentally remove the chapter content — if the correct answer is
    still obvious, the question is too generic. Rewrite it to reference a specific
    term, value, mechanism, or scenario that only appears in this chapter.`;

// ─── Format rules per question type ────────────────────────────────────────

const FORMAT_RULES = `QUESTION-TYPE FORMAT RULES:
1. MCQ
   - questionText: a complete interrogative sentence (ends with "?").
   - options: exactly 4 distinct items.
   - correctAnswer: must match one option EXACTLY (character-for-character).
   - STRICTLY DO NOT use "_______" fill-in-the-blank phrasing for MCQ.
2. TRUE_FALSE
   - questionText: a single declarative statement (no question mark).
   - options: exactly ["True", "False"].
   - correctAnswer: either "True" or "False".
   - difficulty: EASY or MEDIUM only (see Q4 above).
3. FILL_IN_BLANK
   - questionText: contains EXACTLY one "_______" (seven underscores).
   - correctAnswer: the exact missing word or short phrase.
   - options: may be [].
4. MATCH_PAIRS
   - questionText: instruction to match Column A with Column B.
   - options: all Column-A items followed by all Column-B items in their
     CORRECT corresponding order, e.g. [A1, A2, A3, B1, B2, B3]. (The UI
     shuffles Column B at render time.)
   - correctAnswer: pipe-separated pairs, colon inside each pair,
     e.g. "A1:B1|A2:B2|A3:B3".
5. ORDERING
   - questionText: instruction to arrange items in the correct sequence.
   - options: all items in RANDOM order.
   - correctAnswer: items in the CORRECT order, pipe-separated,
     e.g. "Step1|Step2|Step3".`;

// ─── Main builder ──────────────────────────────────────────────────────────

/**
 * Builds the universal question-generation prompt used by every provider.
 * A single edit here propagates to Groq, Gemini, and Ollama.
 */
export function buildQuestionGenerationPrompt(
  opts: GenerateOptions,
  contentCharLimit: number = 30000
): string {
  const count = opts.count ?? 10;
  const types = opts.questionTypes ?? ["MCQ"];
  const lang = opts.language ?? "en";

  const difficultyInstruction =
    opts.difficulty && opts.difficulty !== "MIXED"
      ? `All ${count} questions must be ${opts.difficulty} difficulty — and they must TRULY meet that level per the rubric below.`
      : `Mix difficulties: roughly 30% EASY, 40% MEDIUM, 30% HARD. Each question's label must TRULY match the rubric below.`;

  return `You are an expert educational content designer for the Ethiopian national curriculum, with deep experience in assessment writing and Bloom's Taxonomy.

TASK: Generate exactly ${count} high-quality exam questions based ONLY on the textbook chapter content provided below.

SUBJECT: ${opts.subject}
GRADE:   Grade ${opts.grade}
CHAPTER: ${opts.chapterTitle}
LANGUAGE: ${lang === "en" ? "English" : lang}
REQUESTED TYPES: ${types.join(", ")}

${DIFFICULTY_RUBRIC}

${QUALITY_RULES}

${FORMAT_RULES}

DIFFICULTY TARGET FOR THIS BATCH:
${difficultyInstruction}

FINAL SELF-AUDIT (do this silently before producing the JSON):
For each candidate question, verify:
  ✓ The answer does not appear verbatim in the question (Q1).
  ✓ MCQ distractors are all plausible and same-domain (Q2).
  ✓ This subtopic has not already been covered in this batch (Q3).
  ✓ If TRUE_FALSE, difficulty is not HARD (Q4).
  ✓ Difficulty label truly matches the Bloom's rubric — not just claimed.
  ✓ The question is answerable from the chapter content (Q7).
  ✓ The correct answer is scientifically accurate, not just plausible (Q9).
  ✓ The question cannot be answered by common sense alone — it requires
    knowing specific content from this chapter (Q10).
  ✓ If labelled HARD: it combines ≥2 facts, applies a concept to a new
    scenario, or requires evaluating competing claims — NOT single-fact recall.
If a question fails ANY check, REWRITE it before emitting. Do not lower
the bar — rewrite until all checks pass or replace with a different question.

OUTPUT FORMAT: Return ONLY a valid JSON object (no markdown, no code fences,
no commentary) with a single key "questions" containing an array of EXACTLY
${count} question objects. Each object must have:
- "questionText":  string
- "type":          "MCQ" | "TRUE_FALSE" | "FILL_IN_BLANK" | "MATCH_PAIRS" | "ORDERING"
- "options":       string[]
- "correctAnswer": string  (formatted exactly per the type rule)
- "difficulty":    "EASY" | "MEDIUM" | "HARD"
- "explanation":   string

CHAPTER CONTENT:
"""
${opts.content.slice(0, contentCharLimit)}
"""

Now produce the JSON object with exactly ${count} questions. No preamble, no markdown.`;
}
