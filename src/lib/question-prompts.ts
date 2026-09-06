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

// Single shared content window for question generation so every provider
// (Gemini, Groq, NVIDIA) sees the SAME slice of chapter text and
// therefore produces comparable questions regardless of which one answers.
export const QUESTION_CONTENT_CHARS = 30000;

// ─── Deterministic output sanitizer ────────────────────────────────────────

/**
 * Strip source-referencing lead-ins ("According to the chapter, …", "Based on
 * the text, …") from a generated question so it reads as a standalone exam item.
 *
 * LLMs ignore the prompt's meta-reference ban (rule Q11) often enough that a
 * deterministic pass is required. Gated on an explicit source noun so genuine
 * phrasings like "According to Herodotus, …" or "In the process of …" are left
 * untouched. Applied by every provider's validator, so it runs regardless of
 * which model produced the question.
 */
export function sanitizeQuestionText(text: string): string {
  if (!text) return text;
  let t = text.trim();

  const leadIn =
    /^(?:according to|based on|as (?:stated|described|mentioned|explained|noted|discussed|shown|outlined) in|as per|per|from|in)\s+(?:the\s+)?(?:chapters?|texts?|passages?|content|textbooks?|books?|readings?|lessons?|units?|materials?|documents?|paragraphs?|sections?|author)\b[^,:.?!]*[,:]\s*/i;
  let prev: string;
  do {
    prev = t;
    t = t.replace(leadIn, "");
  } while (t !== prev && t.length > 0);

  t = t.replace(
    /,?\s*(?:according to|as (?:stated|described|mentioned|noted) in|based on)\s+(?:the\s+)?(?:chapters?|texts?|passages?|content|textbooks?|books?|readings?|lessons?|units?)\b/gi,
    ""
  );

  t = t.replace(/\s{2,}/g, " ").replace(/^[,;:\s]+/, "").trim();
  if (t.length > 0) t = t[0].toUpperCase() + t.slice(1);
  return t;
}

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
           Multi-step reasoning that CANNOT be completed with a single remembered
           fact. The correct answer requires the student to do ONE OR MORE of:
           (a) Combine ≥2 separate mechanisms or facts from different parts of
               the content to reach a conclusion neither fact alone supports,
           (b) Detect the specific flaw in a plausible but incorrect student claim
               that mixes real facts incorrectly,
           (c) Predict the net effect of two simultaneous or competing processes,
           (d) Choose which of two valid principles applies to a novel scenario,
               and explain why the other does NOT apply.

           ─── HARD QUESTION TEMPLATES ─────────────────────────────────────────
           Use these as structural models. Replace ALL brackets with real names,
           values, and terms from the chapter content. The final questionText must
           NEVER contain placeholder brackets or phrases like "from the chapter",
           "the text", "the content", or "the passage".

           TEMPLATE 1 — Misconception Refutation:
           "A student claims that [specific plausible-but-wrong statement that
           blends two real chapter facts incorrectly]. Which of the following
           BEST identifies the flaw in this reasoning?"
           HOW: The 4 options are 4 different diagnoses of what went wrong.
           Only one correctly identifies which fact was misapplied and why.
           Student must know BOTH facts to distinguish the correct diagnosis
           from the other plausible ones.

           TEMPLATE 2 — Competing Processes:
           "If [Process A — use actual chapter name] and [Process B — use
           actual chapter name] were both active simultaneously in [named
           cell/system], which outcome would dominate?"
           HOW: Options propose 4 different net outcomes with different
           mechanistic reasons. Student must understand BOTH processes to
           decide which wins under the stated conditions.
           CRITICAL CONSTRAINT: A and B must be GENUINELY COMPETING — forces or
           mechanisms that push the SAME variable in OPPOSITE directions so that
           only ONE net outcome is possible. Do NOT use this template with
           parallel, independent, or classification schemes (e.g. two different
           ways of naming/categorizing the same thing, two timelines, two
           labelling systems). Under parallel schemes every option is separately
           true, so "which dominates" has no single answer — that is a BROKEN
           question. If the two things do not physically conflict over one
           shared outcome, pick a different template.

           TEMPLATE 3 — Evidence Evaluation:
           "Which of the following observations would MOST STRONGLY support
           the conclusion that [specific named principle from the chapter] is
           the primary mechanism at work?"
           HOW: Options are 4 experimental observations. Three are consistent
           with alternative explanations; only one uniquely confirms the named
           principle. Student must evaluate each observation, not just recall.

           TEMPLATE 4 — Consequence of Disruption:
           "Which of the following would be the PRIMARY consequence if [specific
           named structure or process] were permanently disabled, given that
           [a supporting fact that makes the cascade non-obvious]?"
           HOW: Options are 4 plausible cascading effects. Student must know
           what the structure does AND trace how its loss propagates — not just
           state its normal function.

           TEMPLATE 5 — Cross-concept Synthesis:
           "Given that [Fact A about Concept X] and [Fact B about Concept Y],
           which conclusion is supported by BOTH facts combined but NOT by
           either fact alone?"
           HOW: Each wrong option can be defended using only ONE of the two
           facts. The correct answer requires both to be known simultaneously.

           ─── ANTI-PATTERNS — these are NOT HARD — do not generate them ────────
           The following structural types look like HARD questions but are NOT,
           regardless of the subject (Biology, History, Physics, Math, etc.):

           ✗ STEM-IMPLIES-ANSWER: "Why does [single process] cause [outcome]?"
             The question already contains the causal relationship; the student
             only needs to confirm it. Any subject is vulnerable to this:
             "Why does heating a metal cause it to expand?"
             "Why did inflation rise when more currency was printed?"
             → Fix: make the student CHOOSE which mechanism among competing
               alternatives is responsible, or compare two scenarios where
               the outcome differs unexpectedly.

           ✗ SINGLE-FACT PREMISE: "Given that [one fact about X], which
             consequence follows?"
             One fact → one inference. No synthesis across concepts required.
             → Fix: add a second independent fact and require a conclusion
               that depends on BOTH simultaneously.

           ✗ ABSTRACT FAILURE: "What would happen if [broad system] could no
             longer perform its main function?"
             Too vague — any of many consequences is defensible. Options
             become arbitrary because no specific mechanism is constrained.
             → Fix: name the SPECIFIC sub-process that fails and a specific
               observable outcome to evaluate.

           ✗ DEFINITION RECALL DRESSED AS REASONING: "Given that [textbook
             definition], which of the following is a consequence?"
             Restating the textbook definition as a premise and asking for
             its implication is still recall — the answer is inside the premise.
             → Fix: use the principle in a NON-TEXTBOOK scenario where its
               application is non-obvious.

HARD SELF-CHECK: Before labelling a question HARD, it must pass ALL four:
  ✓ DUAL-FACT TEST: A student who knows only ONE fact from this chapter
    cannot answer it. The correct answer depends on knowing ≥2 facts together.
  ✓ MECHANISM TEST: The correct answer requires a multi-step inference, a flaw
    evaluation, or a competing-process resolution — not a single definition.
  ✓ OPTION COHERENCE: All 4 options are direct logical responses to the SAME
    question premise. No option introduces an unrelated topic or mechanism.
  ✓ DISTRACTOR PLAUSIBILITY: Wrong options are believable to a student who
    knows PART of the content but not the full picture.
If any check fails, rewrite the question or downgrade it to MEDIUM.`;

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
    CRITICALLY: Before finalizing, verify each wrong option is DEFINITIVELY
    FALSE — not just less likely. If a knowledgeable student could defend any
    wrong option as also correct, discard that distractor and write a new one.
    Also ensure no two options say the same thing from opposite angles
    (e.g. "A is more rigid" and "B is more flexible" are logically equivalent
    and must not both appear as options).
Q3. TOPIC DIVERSITY (HARD CAP): Across the whole batch, cover DIFFERENT
    subtopics from the chapter. Spread questions across the chapter's DISTINCT
    sections, civilizations, people, and events — do not cluster.
    HARD LIMIT: AT MOST 2 questions may touch the same named entity, event, or
    sub-topic (e.g. one specific kingdom's decline, one person, one invention).
    A 3rd question on the same nexus is FORBIDDEN — replace it with one drawn
    from an as-yet-uncovered part of the chapter.
    BEFORE FINALIZING: list the primary subtopic of each question; if any single
    subtopic appears 3+ times, rewrite the extras to cover different material.
    If the chapter spans multiple civilizations/regions/themes, the batch must
    sample BROADLY across them, not exhaust one.
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
    with established, universally accepted knowledge for this subject and grade.
    If any doubt exists about the accuracy of the answer, discard the question
    and generate a different one. Do NOT trust a plausible-sounding answer —
    confirm it is correct.
    COMMON ERROR PATTERN TO AVOID (applies to any subject): selecting an answer
    that sounds authoritative but is only partially true, oversimplified, or
    contradicts standard curriculum — e.g. confusing the "basic unit" of
    something with the "smallest/lowest level", misattributing a discovery,
    stating an approximation as an exact value, or reversing a cause-effect
    relationship. When in doubt, choose a different question entirely.
Q10. NO GENERIC QUESTIONS: Every question must be specific to named facts,
    processes, numbers, or terminology from THIS chapter. Reject any question
    that a student could answer correctly using only general common sense or
    background domain knowledge, without having read this specific chapter.
    LITMUS TEST: mentally remove the chapter content — if the correct answer is
    still obvious, the question is too generic. Rewrite it to reference a specific
    term, value, mechanism, or scenario that only appears in this chapter.
Q12. NO COMPOUND QUESTIONS (MCQ / TRUE_FALSE only): The questionText must ask
    exactly ONE thing. Do NOT append "and why?", "and what is the reason?",
    "and how?", "and explain", or any second question after the main question.
    The options must be able to fully answer the COMPLETE question on their own.
    If you want to test reasoning, make the ENTIRE question about the reason.
    WRONG: "What would happen to the cell, and why?"
    WRONG: "Which of the following would result, and what is the reason?"
    RIGHT: "What would happen to the cell?"
    RIGHT: "Why does the cell swell when placed in a hypotonic solution?"
Q11. NO META-REFERENCES: The questionText must NEVER contain phrases such as
    "this chapter", "the chapter", "the text", "the passage", "the content",
    "the textbook", "according to the book", "based on the reading", "from the
    chapter", or any phrase that reveals the question's source. Questions must
    read as fully standalone exam items — a student should not be reminded
    they are reading from a textbook.
    WRONG: "According to the chapter, what triggers the menstrual cycle?"
    WRONG: "Which evidence from the chapter best refutes this claim?"
    RIGHT: "What is the primary hormonal trigger for the menstrual cycle?"
    RIGHT: "Which of the following best refutes the claim that X occurs in Y?"
Q13. DISTRACTOR COHERENCE (MCQ only): Every option must be a DIRECT LOGICAL
    RESPONSE to the exact question being asked — not a fact about a related but
    different topic. The question premise defines the domain; all 4 options must
    stay inside that domain.
    HOW TO CHECK: Read the question stem. Identify the category of answer it
    calls for (e.g. "a consequence", "a cause", "an observation", "a year").
    Then verify all 4 options belong to that same category. This rule applies
    to every subject — Biology, History, Physics, Chemistry, Mathematics, etc.
    WRONG PATTERN: Question asks about consequence of [Mechanism A] → some
           options answer a different question about [unrelated Mechanism B].
           Example: "What happens to X under condition Y?" but options C and D
           are about what happens to X under a completely different condition Z.
    RIGHT PATTERN: All 4 options are valid candidates for the same answer
           slot — they differ in their claim, not in the question they answer.
           Example: Question asks "what is the PRIMARY cause of [event]?" →
           all 4 options must be plausible causes of that event, not a mix
           of causes, effects, definitions, and dates.
    If any option answers a question other than the one being asked, replace it
    with an option that stays in the same logical domain as the other three.
Q14. EXACTLY ONE CORRECT ANSWER: Precisely one option may be true; the other
    three must each be DEFINITIVELY false. Reject any stem whose framing lets
    two or more options be simultaneously correct. In particular, do NOT ask
    which of several PARALLEL or INDEPENDENT schemes "dominates", "best applies",
    or "wins" when each option is correct under its own separate scheme — there
    is no single answer. If you need to test parallel schemes, constrain the
    question to ONE named scheme so only one option fits.
    WRONG: "If the behaviour periodization and the tool-making periodization were
      both applied to the Old Stone Age, which outcome would dominate?" (each
      scheme gives a different, equally-valid label — multiple options are true).
    RIGHT: "Under the human-behaviour periodization, the Old Stone Age falls in
      which stage?" (one scheme → exactly one correct answer).
Q15. NO "ALL/NONE OF THE ABOVE": Never use "All of the above", "None of the
    above", "Both A and B", or similar meta-options. Every option must be a
    concrete, substantive answer. (Reinforces Q6.)
Q16. ANSWER BALANCE: Never make the correct choice predictable.
    - MCQ: do NOT always place the correct answer first. Vary which option is
      correct across the batch. (The system also shuffles options after you,
      so never write a stem that hints at a position like "the first option".)
    - TRUE_FALSE: write a MIX of true and false statements — aim for roughly
      half TRUE and half FALSE across the batch. Do NOT default every statement
      to true; deliberately include statements whose correct answer is False.`;

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
     e.g. "Step1|Step2|Step3".
   - NO SORT-KEY LEAKAGE: options must NEVER contain the value that reveals the
     order — no years, dates, numbers, or step labels ("first", "1st", "Phase 1")
     embedded in the option text. The student must order by KNOWLEDGE, not by
     reading a printed number and sorting it.
     WRONG: ["Roman conquest (30 B.C)", "Philip II wins (338 B.C)", …]  ← dates leak the order
     RIGHT: ["Roman conquest of Greece", "Philip II defeats the Greek city-states", …]
     (The correctAnswer still encodes the true order; the options must not.)`;

/**
 * Keep only the format rules for the question types actually requested.
 *
 * FORMAT_RULES documents all five types, and the whole block was sent every
 * time — so asking for 5 MCQs still shipped the MATCH_PAIRS and ORDERING specs.
 * That mattered: the built prompt reached 23,727 characters for a 2,018-character
 * chapter (91% instructions), landing at ~8,182 tokens against Groq's 8,000 TPM
 * limit. Generation then failed with a 413 no matter how short the chapter was.
 *
 * Dropping the irrelevant sections is quality-neutral — a model generating MCQs
 * has no use for the ORDERING rules — and takes the request back under the cap.
 */
function formatRulesFor(types: string[]): string {
  const wanted = new Set(types.map((t) => t.toUpperCase()));
  const [header, ...sections] = FORMAT_RULES.split(/\n(?=\d+\. [A-Z_]+\n)/);

  const kept = sections.filter((section) => {
    const name = section.match(/^\d+\.\s+([A-Z_]+)/)?.[1];
    return name ? wanted.has(name) : true;
  });

  // Renumber so the model never sees "1. MCQ" followed by "4. MATCH_PAIRS".
  const renumbered = kept.map((sec, i) => sec.replace(/^\d+\./, `${i + 1}.`));
  return [header, ...renumbered].join("\n");
}

// ─── Quantitative subjects (Physics, Maths, Chemistry …) ───────────────────

/**
 * True for calculation-heavy subjects that should get numerical + graph-based
 * questions, not just conceptual prose. Matched loosely on the subject name.
 */
export function isQuantitativeSubject(subject: string): boolean {
  const s = (subject || "").toLowerCase();
  return (
    s.includes("phys") ||
    s.includes("math") || // mathematics, maths
    s.includes("chem") ||
    s.includes("account") ||
    s.includes("econom") ||
    s.includes("statist")
  );
}

const QUANTITATIVE_INSTRUCTIONS = `QUANTITATIVE-SUBJECT REQUIREMENTS (this is a calculation-heavy subject):
This subject is tested with NUMERICAL and GRAPHICAL reasoning — NOT only
definitions. A batch of pure prose/recall questions is a FAILURE for this
subject. Across the batch, AT LEAST HALF the questions MUST be one of:

A. NUMERICAL / CALCULATION questions
   - Give specific numeric values WITH UNITS (e.g. F = 12 N, m = 3 kg, v = 4 m/s)
     that are consistent with the formulas, laws, or worked examples in the
     chapter content below.
   - Require the student to SELECT a formula/method, SUBSTITUTE the values, and
     COMPUTE a result. The correctAnswer is the computed value WITH its unit.
   - Distractors MUST be the results of COMMON, REALISTIC mistakes — not random
     numbers: using the wrong formula, a unit-conversion slip, an arithmetic
     error, dropping a constant/factor (e.g. forgetting the ½ in KE = ½mv²),
     or inverting a ratio. Each wrong option should be reachable by a specific
     misstep a real student makes.
   - The explanation MUST show the formula, the substitution, and the arithmetic.
   - Keep numbers clean enough to solve by hand at this grade level.

B. GRAPH / DIAGRAM / TABLE INTERPRETATION questions (described fully in words —
   questions are text-only, so DESCRIBE the figure, never reference an unseen image)
   - Describe the graph/figure/table precisely in the questionText, e.g.
     "A velocity–time graph is a straight line from (0 s, 0 m/s) to (4 s, 20 m/s)."
     then ask the student to read or compute a slope/gradient, area under the
     line, intercept, rate of change, or trend.
   - The description must be complete enough to answer from the text alone.

DIFFICULTY FOR NUMERICAL ITEMS (overrides the conceptual templates for this subject):
   • EASY   → recall a formula, constant, unit, or a one-step plug-in with given values.
   • MEDIUM → a single-formula calculation, or reading one value off a described graph.
   • HARD   → a MULTI-STEP problem: chain two formulas, convert units then compute,
              or combine two quantities so the answer needs ≥2 steps. A multi-step
              numerical problem fully satisfies the HARD bar for this subject.

Prefer MCQ (numeric options) or FILL_IN_BLANK (numeric answer) for calculations.
Still include SOME conceptual questions, but the batch must be a genuine MIX of
numerical, graphical, and conceptual — never all prose.`;

// Fast-play variant (Timed / Battle): calculation & graph questions that need
// real working are unfair under a per-question countdown, so they are limited to
// quick, single-step items and heavy multi-step / graph-reading is excluded.
const FAST_MODE_INSTRUCTIONS = `FAST-PLAY MODE (this quiz is TIMED / head-to-head — every question has a short countdown):
Questions MUST be answerable within a few seconds. Therefore:
• NO multi-step calculations. At most a SINGLE, mental-math step (e.g. F = m·a
  with small whole numbers) — nothing requiring paper, long division, or chaining
  two formulas.
• NO questions that require reading values off a described graph, computing a
  slope/area, or interpreting a figure — these take too long under a countdown.
• Favour quick recall, definitions, unit/formula identification ("which formula
  gives kinetic energy?"), and one-line conceptual questions.
• Keep questionText and every option SHORT.`;

// ─── Main builder ──────────────────────────────────────────────────────────

/**
 * Builds the universal question-generation prompt used by every provider.
 * A single edit here propagates to Groq, Gemini, and Ollama.
 */
export function buildQuestionGenerationPrompt(
  opts: GenerateOptions,
  contentCharLimit: number = QUESTION_CONTENT_CHARS
): string {
  const count = opts.count ?? 10;
  const types = opts.questionTypes ?? ["MCQ"];
  const lang = opts.language ?? "en";

  const difficultyInstruction =
    opts.difficulty && opts.difficulty !== "MIXED"
      ? `All ${count} questions must be ${opts.difficulty} difficulty — and they must TRULY meet that level per the rubric below.`
      : `Mix difficulties: roughly 30% EASY, 40% MEDIUM, 30% HARD. Each question's label must TRULY match the rubric below.`;

  // Timed / Battle play can't fairly ask heavy calculation or graph questions
  // under a countdown, so those modes get the "fast" ruleset instead of the
  // quantitative one. SOLO (or unspecified) keeps the full numerical + graph mix.
  const fastMode = opts.mode === "TIMED" || opts.mode === "GROUP";
  const quantitativeBlock = fastMode
    ? `\n${FAST_MODE_INSTRUCTIONS}\n`
    : isQuantitativeSubject(opts.subject)
      ? `\n${QUANTITATIVE_INSTRUCTIONS}\n`
      : "";

  return `You are an expert educational content designer for the Ethiopian national curriculum, with deep experience in assessment writing and Bloom's Taxonomy.

TASK: Generate exactly ${count} high-quality exam questions based ONLY on the textbook chapter content provided below.

SUBJECT: ${opts.subject}
GRADE:   Grade ${opts.grade}
CHAPTER: ${opts.chapterTitle}
LANGUAGE: ${lang === "en" ? "English" : lang}
REQUESTED TYPES: ${types.join(", ")}

${DIFFICULTY_RUBRIC}

${QUALITY_RULES}

${formatRulesFor(types)}
${quantitativeBlock}
DIFFICULTY TARGET FOR THIS BATCH:
${difficultyInstruction}

FINAL SELF-AUDIT (do this silently before producing the JSON):
For each candidate question, verify ALL of the following:

  CONTENT CHECKS:
  ✓ [Q1]  The answer does not appear verbatim in the question stem.
  ✓ [Q7]  The question is answerable from the chapter content provided.
  ✓ [Q9]  The correct answer is factually accurate — not just plausible.
  ✓ [Q10] The question CANNOT be answered by common sense alone; it requires
          knowing specific content from this chapter.

  FORMAT CHECKS:
  ✓ [Q4]  If TRUE_FALSE, difficulty is EASY or MEDIUM — never HARD.
  ✓ [Q11] The questionText contains NO phrase like "this chapter", "the text",
          "from the chapter", "the passage", "according to the book", or similar.
  ✓ [Q12] The questionText asks exactly ONE thing — no "and why?", "and how?",
          "and what is the reason?", or any second question appended.

  DISTRACTOR CHECKS (MCQ only):
  ✓ [Q2]  Every wrong option is definitively false — a knowledgeable student
          cannot defend it as correct.
  ✓ [Q2]  No two options say the same thing from opposite angles.
  ✓ [Q2]  All 3 wrong options belong to the same category/domain as the answer.
  ✓ [Q13] Every option is a direct logical response to the question being asked.
          Read the stem → identify the category of answer it calls for → verify
          all 4 options stay inside that category. If any option answers a
          DIFFERENT question, replace it.

  DIVERSITY CHECK:
  ✓ [Q3]  No single named entity/event/sub-topic appears in 3+ questions across
          the batch. List each question's subtopic; if any repeats 3+ times,
          rewrite the extras to cover uncovered parts of the chapter.

  ORDERING CHECK (only if type = ORDERING):
  ✓  No option contains a year, date, number, or step label that would let the
     student sort without knowledge. If any option leaks the order, remove the
     value from the option text (keep it only in correctAnswer).

  HARD-SPECIFIC CHECKS (only if difficulty = HARD):
  ✓ DUAL-FACT: A student who knows only ONE fact from the chapter cannot
    answer this question correctly.
  ✓ MECHANISM: The question requires multi-step inference, flaw detection,
    competing-process reasoning, or cross-concept synthesis — not a single
    definition lookup.
  ✓ ANTI-PATTERN: This question does NOT match any of the banned anti-patterns
    in the HARD ANTI-PATTERNS list above (single-consequence, abstract-failure,
    or recall-disguised-as-reasoning).
  ✓ If the question fails the HARD bar → rewrite using one of the 5 templates
    OR downgrade to MEDIUM. Do NOT keep a weak question labelled HARD.

If a question fails ANY check, REWRITE it before emitting. Do not lower the bar —
rewrite until all checks pass or replace with an entirely different question.

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
