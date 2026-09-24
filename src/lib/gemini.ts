import { GoogleGenerativeAI, SchemaType, type ResponseSchema } from "@google/generative-ai";
import { buildQuestionGenerationPrompt } from "./question-prompts";
import { buildTutorSystemPrompt } from "./ai-prompts";
import { validateQuestions, validateDetectedChapters } from "./question-validation";
import { logUsage, geminiUsage, type UsageFeature, type UsageActor } from "./usage-logger";
import { modelIdFor } from "./ai-settings";
import { runTask } from "./ai-routing";

// ─── Types ──────────────────────────────────────────────

export interface GenerateOptions {
  content: string;
  chapterTitle: string;
  subject: string;
  grade: number;
  count?: number;
  difficulty?: "EASY" | "MEDIUM" | "HARD" | "MIXED";
  questionTypes?: ("MCQ" | "TRUE_FALSE" | "FILL_IN_BLANK" | "MATCH_PAIRS" | "ORDERING")[];
  language?: string;
  /** Quiz mode. TIMED / GROUP (battle) suppress heavy multi-step & graph
   *  questions so fast play stays answerable; SOLO/undefined gets the full mix. */
  mode?: "SOLO" | "TIMED" | "GROUP";
  /**
   * Varies which HARD templates the prompt leads with. Batches are independent
   * calls that would otherwise share one prompt and all reach for the same
   * template; pass something that differs per call (the batch index, or the
   * chapter's existing question count for a single-batch call).
   */
  variantSeed?: number;
  /**
   * Question stems this chapter already has (newest first, already trimmed —
   * see lib/question-dedupe). Listed in the prompt so the model writes about
   * something else instead of re-asking them.
   */
  avoidQuestions?: string[];
}

// ─── Chapter Detection Types ────────────────────────────

export interface DetectedChapter {
  chapterNumber: number;
  title: string;
}

export interface DetectChaptersOptions {
  content: string;
  subject: string;
  grade: number;
  language?: string;
}

export interface DetectedChapterWithContent extends DetectedChapter {
  content: string;
}

// ─── Question Generation Types ──────────────────────────

export interface GeneratedQuestion {
  questionText: string;
  type: "MCQ" | "TRUE_FALSE" | "FILL_IN_BLANK" | "MATCH_PAIRS" | "ORDERING";
  options: string[];
  correctAnswer: string;
  difficulty: "EASY" | "MEDIUM" | "HARD";
  explanation: string;
}

// ─── Native Structured Schemas (Strict ResponseSchema) ──

export const QUESTION_GENERATION_SCHEMA: ResponseSchema = {
  type: SchemaType.ARRAY,
  description: "Array of curriculum-aligned exam questions",
  items: {
    type: SchemaType.OBJECT,
    properties: {
      questionText: {
        type: SchemaType.STRING,
        description: "The complete question stem without meta-references.",
      },
      type: {
        type: SchemaType.STRING,
        format: "enum",
        enum: ["MCQ", "TRUE_FALSE", "FILL_IN_BLANK", "MATCH_PAIRS", "ORDERING"],
      },
      options: {
        type: SchemaType.ARRAY,
        items: { type: SchemaType.STRING },
        description: "Options for the question. For MCQ, exactly 4 distinct options.",
      },
      correctAnswer: {
        type: SchemaType.STRING,
        description: "The exact correct answer matching one of the options.",
      },
      difficulty: {
        type: SchemaType.STRING,
        format: "enum",
        enum: ["EASY", "MEDIUM", "HARD"],
      },
      explanation: {
        type: SchemaType.STRING,
        description: "Pedagogical explanation of why the correct answer is right.",
      },
    },
    required: ["questionText", "type", "options", "correctAnswer", "difficulty", "explanation"],
  },
};

export const CHAPTER_DETECTION_SCHEMA: ResponseSchema = {
  type: SchemaType.ARRAY,
  description: "Sequential list of detected chapters or units in the textbook",
  items: {
    type: SchemaType.OBJECT,
    properties: {
      chapterNumber: {
        type: SchemaType.INTEGER,
        description: "Sequential chapter number starting from 1",
      },
      title: {
        type: SchemaType.STRING,
        description: "Exact title of the chapter or unit as found in the textbook",
      },
    },
    required: ["chapterNumber", "title"],
  },
};

// ─── Client ─────────────────────────────────────────────

// Two model tiers, both overridable via env so a model can be switched without
// a code change — e.g. when one loses free-tier quota (the "limit: 0" 429s) or
// reaches its shutdown date.
//
// FLAGSHIP — work whose quality decides whether content ships: question
// generation, chapter detection, the independent verifier, and
// every vision task (graph/equation/solid reading). gemini-3.8-flash is the
// newest stable Flash and is priced identically to 3.6-flash ($0.75/$3.75 per
// 1M through 2026), so there is no reason to sit on the older one.
const GEMINI_MODEL_FALLBACK = process.env.GEMINI_MODEL || "gemini-3.8-flash";
/** Flagship model id: admin setting -> env -> built-in default. */
export function geminiModel(): string {
  return modelIdFor("GEMINI", "chat") ?? GEMINI_MODEL_FALLBACK;
}

// FAST — high-volume or latency-sensitive work where flagship reasoning is not
// what decides the outcome: Bloom tagging (one call per chunk batch across a
// whole book), the post-generation quality checks, and the tutor-chat fallback.
// gemini-3.1-flash-lite is a third of the flagship's input price and 40% of its
// output price, which is what keeps whole-book tagging cheap.
const GEMINI_FAST_MODEL_FALLBACK = process.env.GEMINI_FAST_MODEL || "gemini-3.1-flash-lite";
/** Fast/cheap model id: admin setting -> env -> built-in default. */
export function geminiFastModel(): string {
  return modelIdFor("GEMINI", "fast") ?? GEMINI_FAST_MODEL_FALLBACK;
}

/**
 * Hard cap on how much the model is allowed to "think" before answering.
 *
 * Gemini 3.x Flash reasons before it replies, and those thinking tokens are
 * billed as output AND charged against maxOutputTokens. Measured against the
 * real question-generation prompt (24,886 chars, 5 questions):
 *
 *   no cap, maxOutputTokens 4096  → 3,928 thinking + 161 answer  → MAX_TOKENS,
 *                                    truncated JSON, 3 failed retries
 *   no cap, maxOutputTokens 8192  → 7,860 thinking + 328 answer  → MAX_TOKENS
 *   no cap, maxOutputTokens 16384 → 11,448 thinking + 1,146 answer → parsed
 *   capped, maxOutputTokens 4096  →     0 thinking +   792 answer → parsed
 *
 * Raising the ceiling does not fix it — thinking simply grows to fill whatever
 * it is given, so the JSON stays starved while the bill grows ~14x. Every task
 * here is structured extraction against text we supply, which is exactly the
 * shape that does not need extended reasoning; the quality pipeline is what
 * guards correctness. Set GEMINI_THINKING_BUDGET to raise it if a task ever
 * genuinely needs deliberation.
 */
const THINKING_BUDGET = Number(process.env.GEMINI_THINKING_BUDGET ?? 512);

/**
 * Merge the thinking cap into a generationConfig.
 *
 * The cast is deliberate: `thinkingConfig` is a real REST field that this SDK
 * forwards verbatim, but @google/generative-ai@0.24.1 predates it and does not
 * declare it on GenerationConfig. Verified against the live API — the same call
 * reports thoughtsTokenCount 3,929 without it and 0 with it.
 */
function withThinkingCap<T extends object>(cfg: T, budget = THINKING_BUDGET): T {
  return { ...cfg, thinkingConfig: { thinkingBudget: budget } } as T;
}

function getClient() {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error(
      "GEMINI_API_KEY is not configured. Add it to your .env file."
    );
  }
  return new GoogleGenerativeAI(apiKey);
}

/**
 * Send a prompt to Gemini and return the raw response text (JSON mode).
 *
 * A general-purpose helper mirroring `groqChat` / `nvidiaChat` so any pipeline
 * can use Gemini as its primary provider without rebuilding a client inline.
 * Returns null when GEMINI_API_KEY is missing or the request fails, letting
 * callers fall through to the next provider in their chain.
 */
export async function geminiChat(
  prompt: string,
  opts: {
    system?: string;
    temperature?: number;
    maxTokens?: number;
    model?: string;
    /** Which feature this call serves, for token-usage attribution. Shared
     *  helper, so the feature varies by caller (bloom tagging, quality checks,
     *  answer verification …); defaults to quality-check. */
    feature?: UsageFeature;
    /** Who the call is for, for per-student cost attribution. */
    actor?: UsageActor;
    /** Native Gemini structured output schema */
    responseSchema?: ResponseSchema;
    /**
     * Ask for prose instead of JSON. Long-form answers must NOT be wrapped in
     * JSON: hitting the token cap then truncates the envelope and the whole
     * reply becomes unparseable, losing text that was otherwise fine. Defaults
     * to false so every existing caller keeps JSON mode.
     */
    plainText?: boolean;
    /**
     * Thinking tokens allowed, overriding the global cap. Only for a task that
     * genuinely needs to work something out (the factual tie-break) — give it
     * a maxTokens large enough to hold the thinking AND the answer.
     */
    thinkingBudget?: number;
  } = {}
): Promise<string | null> {
  if (!process.env.GEMINI_API_KEY) return null;
  const modelId = opts.model ?? geminiModel();
  try {
    let model = getClient().getGenerativeModel({
      model: modelId,
      ...(opts.system ? { systemInstruction: opts.system } : {}),
      generationConfig: withThinkingCap({
        ...(opts.plainText
          ? { responseMimeType: "text/plain" }
          : { responseMimeType: "application/json" }),
        ...(opts.responseSchema ? { responseSchema: opts.responseSchema } : {}),
        temperature: opts.temperature ?? 0.2,
        maxOutputTokens: opts.maxTokens ?? 4096,
      }, opts.thinkingBudget),
    });
    let result;
    try {
      result = await model.generateContent(prompt);
    } catch (schemaErr) {
      if (opts.responseSchema) {
        console.warn(
          `[Gemini] Chat request with responseSchema failed, falling back to standard JSON mode: ${schemaErr instanceof Error ? schemaErr.message : String(schemaErr)}`
        );
        model = getClient().getGenerativeModel({
          model: modelId,
          ...(opts.system ? { systemInstruction: opts.system } : {}),
          generationConfig: withThinkingCap({
            responseMimeType: "application/json",
            temperature: opts.temperature ?? 0.2,
            maxOutputTokens: opts.maxTokens ?? 4096,
          }, opts.thinkingBudget),
        });
        result = await model.generateContent(prompt);
      } else {
        throw schemaErr;
      }
    }
    logUsage({
      feature: opts.feature ?? "quality-check",
      provider: "gemini",
      model: modelId,
      usage: geminiUsage(result.response),
      actor: opts.actor,
    });
    return result.response.text() || null;
  } catch (err) {
    console.warn(
      `[Gemini] Chat request failed: ${err instanceof Error ? err.message : String(err)}`
    );
    return null;
  }
}

// ─── Vision ─────────────────────────────────────────────
//
// Every image task runs through the "vision" route, so an admin can pick the
// Gemini model and add a second Gemini model as a fallback. Only Gemini is
// supported: this is the only code path that sends image data.

async function runVision(call: () => Promise<string>): Promise<string> {
  const { value } = await runTask("vision", { GEMINI: call });
  return value;
}

/**
 * Explain a graph image for a student. Gemini's flash models are multimodal, so
 * this can look at a photo/screenshot of a curve and describe it. Returns the
 * model's raw reply, expected to be JSON:
 *   { "explanation": string, "equations": string[] }
 * where `equations` are 0–4 functions of x (mathjs syntax), one per curve, the student
 * can then plot. Callers parse it defensively.
 */
export async function explainGraphImage(
  base64: string,
  mimeType: string,
  actor?: UsageActor,
): Promise<string> {
  return runVision(async () => {
    const client = getClient();
    const model = client.getGenerativeModel({
      model: geminiModel(),
      generationConfig: withThinkingCap({}),
    });
    const prompt =
      "You are a friendly math tutor for a school student. The image shows a GRAPH. " +
      "Identify it and describe it clearly.\n" +
      "Prioritise a VISUAL MATCH for the equation: choose the function AND its " +
      "vertical scale so the plotted curve LOOKS LIKE the drawing — the peak/valley " +
      "heights and where it crosses the axes should match what you see, not just the " +
      "roots. It is fine if the equation is approximate.\n" +
      "Respond ONLY as JSON with EXACTLY this shape (plain text values, NO markdown, " +
      "NO asterisks, NO bullet characters):\n" +
      '{"summary": string, "features": [{"label": string, "value": string}], "equations": string[]}\n' +
      "- summary: one or two friendly plain sentences (say 'approximate' if the drawing isn't an exact function).\n" +
      "- features: short label/value pairs for what is visible, e.g. " +
      '{"label":"x-intercepts","value":"x = -5, -1, and 4"}, plus y-intercept, ' +
      "turning points (with coordinates), end behavior, and domain & range.\n" +
      "- equations: ONE equation for EACH distinct curve or line in the image (at most 4), as expressions in " +
      "x using mathjs syntax (^ powers, ln, log(x,10), sqrt, e^x, sin/cos/tan, abs), " +
      "no 'y='. Scale them to visually match the graph. Never list the same function " +
      "two ways (0.1*f and f/10 are identical — give it once).\n" +
      "If the image is not a graph, put a short note in summary, features [], equations [].";
    const result = await model.generateContent([
      { text: prompt },
      { inlineData: { mimeType, data: base64 } },
    ]);
    logUsage({ feature: "vision-graph", provider: "gemini", model: geminiModel(), usage: geminiUsage(result.response), actor });
    return result.response.text();
  });
}

/**
 * Read handwritten/printed equations from an image (e.g. a lasso-selected region
 * of smartboard ink) and return the model's raw reply — a JSON array of
 * plottable x-expressions. Callers parse it with `parseEquations`.
 */
export async function readEquationsFromImage(
  base64: string,
  mimeType: string,
  actor?: UsageActor,
): Promise<string> {
  return runVision(async () => {
    const client = getClient();
    const model = client.getGenerativeModel({
      model: geminiModel(),
      generationConfig: withThinkingCap({}),
    });
    const prompt =
      "Read the handwritten or printed math in this image. Output ONLY a JSON array " +
      "of the equations as plottable expressions in x using mathjs syntax (^ for " +
      "powers, ln(x), log(x,10), sqrt, e^x, sin/cos/tan, abs). Drop any 'y=' or " +
      "'f(x)='. Keep letter coefficients/parameters (A, B, C, k, m, or a spelled-out " +
      "Greek name like theta) as LITERAL symbols — do NOT replace them with numbers — " +
      "so they can become interactive sliders. Always put an explicit '*' between a " +
      "parameter and what follows and write functions with parentheses, e.g. " +
      "'A*sin(x)+B', 'A*x^2+B*x+C', 'x^2+5*cos(theta)'. Use x as the only horizontal " +
      "graph variable. At most 4 functions. No words, no markdown.";
    const result = await model.generateContent([
      { text: prompt },
      { inlineData: { mimeType, data: base64 } },
    ]);
    logUsage({ feature: "vision-equation", provider: "gemini", model: geminiModel(), usage: geminiUsage(result.response), actor });
    return result.response.text();
  });
}

/**
 * Read a sketch/drawing/photo of a 3D shape and name the solid it represents,
 * as a JSON spec the geometry explorer can build. Returns the model's raw reply.
 */
export async function readSolidFromImage(base64: string, mimeType: string, actor?: UsageActor): Promise<string> {
  return runVision(async () => {
    const client = getClient();
    const model = client.getGenerativeModel({
      model: geminiModel(),
      generationConfig: withThinkingCap({}),
    });
    const prompt =
      "This image is a sketch, drawing or photo of a single 3D solid. Identify the solid. " +
      'Output ONLY a JSON object: {"shape": string, "sides": number, "label": string}. ' +
      '"shape" must be exactly one of: cube, cuboid, sphere, cylinder, cone, tetrahedron, octahedron, ' +
      "square-pyramid, triangular-prism, prism, pyramid, antiprism, bipyramid. " +
      'Include "sides" (an integer 3-12) ONLY for prism/pyramid/antiprism/bipyramid, giving how many sides the base ' +
      'polygon has (a hexagonal prism → {"shape":"prism","sides":6}). "label" is a short human name like "Hexagonal prism". ' +
      "No words, no markdown, JSON only.";
    const result = await model.generateContent([
      { text: prompt },
      { inlineData: { mimeType, data: base64 } },
    ]);
    logUsage({ feature: "vision-solid", provider: "gemini", model: geminiModel(), usage: geminiUsage(result.response), actor });
    return result.response.text();
  });
}

/**
 * Answer a student's follow-up question about a graph image they uploaded.
 * Single-turn with optional prior Q&A passed as context. Returns plain text.
 */
export async function askAboutGraph(
  base64: string,
  mimeType: string,
  question: string,
  history: { role: "user" | "assistant"; text: string }[] = [],
  actor?: UsageActor,
): Promise<string> {
  return runVision(async () => {
    const client = getClient();
    const model = client.getGenerativeModel({
      model: geminiModel(),
      generationConfig: withThinkingCap({}),
    });
    const ctx = history.length
      ? "Earlier in this conversation:\n" +
        history
          .map((h) => `${h.role === "user" ? "Student" : "Tutor"}: ${h.text}`)
          .join("\n") +
        "\n\n"
      : "";
    const prompt =
      "You are a friendly, encouraging math tutor. The image shows a GRAPH. Answer " +
      "the student's question about THIS graph clearly and simply, in 1–3 short " +
      "sentences of plain text (no markdown, no asterisks). " +
      ctx +
      "Student question: " +
      question;
    const result = await model.generateContent([
      { text: prompt },
      { inlineData: { mimeType, data: base64 } },
    ]);
    logUsage({ feature: "graph-qa", provider: "gemini", model: geminiModel(), usage: geminiUsage(result.response), actor });
    return result.response.text();
  });
}

// ─── Prompt builder ─────────────────────────────────────

function buildPrompt(opts: GenerateOptions): string {
  // Delegate to the shared prompt builder so every provider uses the same
  // Bloom-aligned rubric, quality rules AND content window (QUESTION_CONTENT_CHARS).
  return buildQuestionGenerationPrompt(opts);
}

// ─── Main function ──────────────────────────────────────

export async function generateQuestionsFromContent(
  opts: GenerateOptions
): Promise<GeneratedQuestion[]> {
  const client = getClient();
  const model = client.getGenerativeModel({
    model: geminiModel(),
    generationConfig: withThinkingCap({
      responseMimeType: "application/json",
      responseSchema: QUESTION_GENERATION_SCHEMA,
      temperature: 0.7,
      maxOutputTokens: 4096,
    }),
  });

  const prompt = buildPrompt(opts);

  const MAX_RETRIES = 3;
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      const result = await model.generateContent(prompt);
      // Log before parsing: a call that returns unparseable JSON still spent
      // tokens, and a retry issues a fresh billable call.
      logUsage({ feature: "question-generation", provider: "gemini", model: geminiModel(), usage: geminiUsage(result.response) });
      const text = result.response.text();
      const parsed = JSON.parse(text);
      const questions = validateQuestions(parsed);

      if (questions.length === 0) {
        if (attempt === 0) continue; // retry
        throw new Error("Gemini returned no valid questions after validation");
      }

      return questions;
    } catch (e) {
      const msg = String(e);
      const isRateLimit = msg.includes("429");

      if (isRateLimit) {
        // Re-throw rate limit errors immediately so ai-provider.ts can handle fallback.
        // Retrying here is pointless when the daily quota is exhausted.
        throw e;
      }

      if (attempt === MAX_RETRIES - 1) {
        throw new Error(
          `Gemini question generation failed after ${MAX_RETRIES} attempts: ${e instanceof Error ? e.message : msg}`
        );
      }
      // Retry parse/validation errors once more
    }
  }

  throw new Error(`Gemini question generation failed after ${MAX_RETRIES} attempts`);
}

// ─── Chapter Detection ─────────────────────────────────

function buildChapterDetectionPrompt(opts: DetectChaptersOptions): string {
  const lang = opts.language ?? "en";

  return `You are an expert at analyzing textbook structure for the Ethiopian curriculum.

TASK: Analyze the following textbook content and identify ALL chapters or units.

SUBJECT: ${opts.subject}
GRADE: Grade ${opts.grade}
LANGUAGE: ${lang === "en" ? "English" : lang}

INSTRUCTIONS:
1. Look for the Table of Contents first — it is the most reliable source for chapter/unit names.
2. If no Table of Contents is found, look for chapter/unit headings throughout the text.
3. Common patterns: "Chapter 1:", "Unit 1:", "CHAPTER ONE", "UNIT ONE", numbered headings like "1.", "1.0", section headers in UPPERCASE, or Amharic equivalents like "ምዕራፍ".
4. Return ONLY main chapters or units — do NOT include sub-sections, sub-topics, or lessons within chapters.
5. Chapter numbers must be sequential starting from 1.
6. Return the exact title as it appears in the textbook.

OUTPUT FORMAT: Return a JSON array of objects. Each object must have:
- "chapterNumber": number (sequential, starting from 1)
- "title": string (the chapter/unit title as it appears in the book)

TEXTBOOK CONTENT:
"""
${opts.content.slice(0, 50000)}
"""

Identify all chapters/units now as a JSON array.`;
}

export async function detectChaptersFromContent(
  opts: DetectChaptersOptions
): Promise<DetectedChapter[]> {
  const client = getClient();
  const model = client.getGenerativeModel({
    model: geminiModel(),
    generationConfig: withThinkingCap({
      responseMimeType: "application/json",
      responseSchema: CHAPTER_DETECTION_SCHEMA,
      temperature: 0.3,
      maxOutputTokens: 4096,
    }),
  });

  const prompt = buildChapterDetectionPrompt(opts);

  const MAX_RETRIES = 3;
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      const result = await model.generateContent(prompt);
      logUsage({ feature: "chapter-detection", provider: "gemini", model: geminiModel(), usage: geminiUsage(result.response) });
      const text = result.response.text();
      const parsed = JSON.parse(text);
      const chapters = validateDetectedChapters(parsed);

      if (chapters.length === 0) {
        if (attempt === 0) continue;
        throw new Error("Gemini could not detect any chapters in the textbook content");
      }

      return chapters;
    } catch (e) {
      const msg = String(e);
      if (msg.includes("429")) {
        throw e; // propagate immediately — quota exhausted, retrying won't help
      }
      if (attempt === MAX_RETRIES - 1) {
        throw new Error(
          `Chapter detection failed after ${MAX_RETRIES} attempts: ${e instanceof Error ? e.message : msg}`
        );
      }
    }
  }

  throw new Error(`Chapter detection failed after ${MAX_RETRIES} attempts`);
}

// ─── Text Splitting ────────────────────────────────────

/**
 * Split full textbook text into per-chapter content using detected chapter titles.
 * Searches for chapter titles in the text and splits at boundaries.
 */
/** Normalise a string for fuzzy matching: lowercase, collapse whitespace, strip punctuation */
function normaliseForMatch(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^\w\s\u1200-\u137F]/g, " ") // keep Ethiopic & alphanumeric
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Build a normalised version of fullText AND an index map so each position
 * in the normalised string can be translated back to its position in fullText.
 * This is equivalent to normaliseForMatch but without losing position info.
 */
function buildNormWithMap(fullText: string): { normText: string; indexMap: number[] } {
  const indexMap: number[] = [];
  let normText = "";
  let lastWasSpace = true; // treat start as space to skip leading whitespace

  for (let i = 0; i < fullText.length; i++) {
    const ch = fullText[i];
    if (/[\w\u1200-\u137F]/.test(ch)) {
      normText += ch.toLowerCase();
      indexMap.push(i);
      lastWasSpace = false;
    } else {
      // Non-word char → single collapsed space
      if (!lastWasSpace) {
        normText += " ";
        indexMap.push(i);
        lastWasSpace = true;
      }
    }
  }

  // Remove trailing space
  if (normText.endsWith(" ")) {
    normText = normText.slice(0, -1);
    indexMap.pop();
  }

  return { normText, indexMap };
}

/**
 * Locate ALL occurrences of `title` inside `normText`, returned as sorted
 * positions in the ORIGINAL `fullText`.
 *
 * A textbook title typically appears at least twice — once in the Table of
 * Contents (front matter) and again at the real chapter start — so callers
 * need every candidate in order to pick the right one. Candidates are gathered
 * from specific strategies (exact title, prefix-stripped, first-6-words) that
 * are safe to union together; looser strategies (first-3-words, any long word)
 * are used only as a fallback when the specific ones find nothing.
 */
function findAllTitlePositions(
  normText: string,   // normalised version of fullText
  indexMap: number[], // maps normText positions → fullText positions
  title: string
): number[] {
  const translate = (normIdx: number) =>
    normIdx >= 0 && normIdx < indexMap.length ? indexMap[normIdx] : -1;

  const collectAll = (needle: string): number[] => {
    if (!needle || needle.length < 3) return [];
    const out: number[] = [];
    let from = 0;
    for (;;) {
      const idx = normText.indexOf(needle, from);
      if (idx < 0) break;
      const pos = translate(idx);
      if (pos >= 0) out.push(pos);
      from = idx + needle.length;
    }
    return out;
  };

  const normTitle = normaliseForMatch(title);
  const words = normTitle.split(" ").filter((w) => w.length > 2);

  // Specific strategies — low false-positive rate, safe to union.
  const specific = new Set<number>();
  collectAll(normTitle).forEach((p) => specific.add(p));

  const stripped = normTitle
    .replace(/^(chapter|unit|lesson|section|part|ምዕራፍ|ክፍል)\s*[\d\w]*[.:)]\s*/i, "")
    .trim();
  if (stripped.length > 4) collectAll(stripped).forEach((p) => specific.add(p));

  const keyPhrase = words.slice(0, 6).join(" ");
  if (keyPhrase.length > 5) collectAll(keyPhrase).forEach((p) => specific.add(p));

  if (specific.size > 0) return Array.from(specific).sort((a, b) => a - b);

  // Fallback strategies — only when nothing specific matched.
  const shortPhrase = words.slice(0, 3).join(" ");
  if (shortPhrase.length > 4) {
    const hits = collectAll(shortPhrase);
    if (hits.length) return hits.sort((a, b) => a - b);
  }
  const longWords = words.filter((w) => w.length >= 8);
  for (const lw of longWords) {
    const hits = collectAll(lw);
    if (hits.length) return hits.sort((a, b) => a - b);
  }
  return [];
}

/**
 * Locate every occurrence of a title in `fullText`, sharing one normalised
 * index over many lookups.
 *
 * Exported so chapter DETECTION and chapter SPLITTING agree on where a title
 * sits. They used to disagree: detection ordered chapters with a raw
 * `indexOf` on the unnormalised text, which cannot match a title the PDF broke
 * across a line ("Polynomial \nfunctions"), while splitting used this
 * normalised search, which can. A title located in two different places by the
 * two passes produces chapter numbers that contradict the boundaries.
 */
export function createTitleLocator(fullText: string): (title: string) => number[] {
  const { normText, indexMap } = buildNormWithMap(fullText);
  return (title: string) => findAllTitlePositions(normText, indexMap, title);
}

// A contents page is typeset with dot leaders ("Circles ........ 280"). They
// cluster densely there and essentially nowhere else, which makes them a far
// sharper front-matter signal than the positions of the titles themselves.
const TOC_MIN_LEADERS = 5;          // fewer than this is not a contents page
const TOC_LEADER_GAP = 3_000;       // chars; larger gaps end the cluster
const TOC_MAX_SHARE = 0.2;          // a contents page lives near the front

/**
 * Detect where a Table-of-Contents / front-matter region ends, from the text
 * alone — no chapter list needed.
 *
 * The previous title-cluster heuristic could not work on a real textbook: it
 * grew a cluster from each title's FIRST occurrence and stopped at the first
 * large gap, so it ended at whichever title happened to come last in the
 * preface sentence and left the rest of the contents page live. Worse, the
 * contents page and the first chapter are ADJACENT — in a measured Grade 10
 * Mathematics textbook only 593 characters apart — so no gap-based rule can
 * separate them.
 *
 * Dot leaders can. In that same book, 53 of the document's 57 dot-leader runs
 * fall between characters 4,900 and 8,557, the next is 223,000 characters
 * later, and Unit 1 starts at 8,604 — a clean boundary.
 *
 * Returns 0 when there is no such cluster (a document with no contents page,
 * or one typeset without leaders), leaving callers to fall back on position.
 */
export function detectFrontMatterEnd(fullText: string): number {
  const leaders: { start: number; end: number }[] = [];
  const re = /[.·]{4,}|(?:\.\s){4,}|…+/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(fullText)) !== null) {
    leaders.push({ start: m.index, end: m.index + m[0].length });
    // A contents page is at the front; no need to scan the whole book.
    if (m.index > fullText.length * TOC_MAX_SHARE) break;
  }
  if (leaders.length < TOC_MIN_LEADERS) return 0;

  // Take only the FIRST cluster — later dot-leader runs are body text.
  let end = leaders[0].end;
  let count = 1;
  for (let i = 1; i < leaders.length; i++) {
    if (leaders[i].start - end > TOC_LEADER_GAP) break;
    end = leaders[i].end;
    count++;
  }

  if (count < TOC_MIN_LEADERS) return 0;
  if (end > fullText.length * TOC_MAX_SHARE) return 0;
  return end;
}

/**
 * Fall back to the old title-cluster rule when there are no dot leaders: if
 * several chapter titles are bunched into a span far smaller than one
 * chapter's worth of text near the start, that span is a contents page.
 */
function findTitleClusterCutoff(
  candidatesPerChapter: number[][],
  textLen: number,
  chapterCount: number
): number {
  const firsts = candidatesPerChapter
    .filter((c) => c.length > 0)
    .map((c) => c[0])
    .sort((a, b) => a - b);
  if (firsts.length < 3) return 0;

  const avgChapterSize = textLen / Math.max(1, chapterCount);
  const gapThreshold = avgChapterSize * 0.25;

  let clusterEnd = firsts[0];
  let count = 1;
  for (let i = 1; i < firsts.length; i++) {
    if (firsts[i] - clusterEnd <= gapThreshold) {
      clusterEnd = firsts[i];
      count++;
    } else {
      break;
    }
  }

  // Only treat it as front matter when several titles are bunched together
  // near the start — otherwise these are genuine, well-spaced chapter starts.
  if (count >= 3 && clusterEnd < avgChapterSize) return clusterEnd;
  return 0;
}

// Cost of leaving a chapter unplaced. Large enough that the search only drops
// a chapter when no strictly-increasing chain can include it.
const UNPLACED_PENALTY = 1_000;
// A segment shorter than this share of the average chapter is a sliver, not a
// chapter — the signature of a boundary landing on a contents-page line.
const SLIVER_FLOOR_SHARE = 0.25;
// How many repeats of a title inside one chapter's worth of text count as a
// fully-supported chapter opening (running page headers).
const FULL_SUPPORT_REPEATS = 5;

/**
 * Score for one chapter's span. Zero for any healthy length, increasingly
 * negative below the sliver floor.
 *
 * Rewarding length outright — scoring every segment by log(length) — looks
 * reasonable and is wrong: it makes EVEN chapters beat CORRECT ones. Measured
 * on the Grade 10 Mathematics textbook it slid the Unit 2/3 boundary 11,550
 * characters late purely to trade size from the book's largest unit to its
 * smallest neighbour. Real textbook units are not equal, so the objective must
 * be flat across the normal range and only bite near zero.
 */
function spanScore(length: number, floor: number): number {
  if (length >= floor) return 0;
  return -UNPLACED_PENALTY * (1 - Math.max(0, length) / floor);
}

/**
 * Choose ONE position per chapter, strictly increasing.
 *
 * Picking each title's first or last occurrence independently cannot work,
 * because both are systematically wrong in opposite directions:
 *
 *   first → the Table-of-Contents entry, so a chapter gets the handful of
 *           characters between two contents lines (measured: "Circles" was
 *           assigned 73 characters — literally its contents-page line);
 *   last  → the final running page header of that unit, which sits at the
 *           unit's END, so the chapter starts where it should stop.
 *
 * Scoring whole assignments removes both. The objective is lexicographic:
 *
 *   1. avoid slivers — no chapter is left with a few dozen characters while
 *      its neighbour holds a hundred thousand;
 *   2. among assignments that are equally healthy, prefer positions with
 *      SUPPORT: a real chapter opening is followed by that title repeating as
 *      a running page header on every page of the unit, whereas a passing
 *      cross-reference in another chapter stands alone;
 *   3. failing that, prefer the earliest position — a chapter starts at its
 *      first body heading, not at a later repeat of it.
 *
 * Chapters with no candidate, or that no increasing chain can place, come back
 * as null for the caller's neighbour-inference path.
 */
function chooseChapterPositions(
  candidatesPerChapter: number[][],
  textLen: number
): (number | null)[] {
  const n = candidatesPerChapter.length;
  const chosen: (number | null)[] = new Array(n).fill(null);

  const active = candidatesPerChapter
    .map((list, i) => ({ i, list }))
    .filter((e) => e.list.length > 0);
  if (active.length === 0) return chosen;

  const floor = (textLen / Math.max(1, n)) * SLIVER_FLOOR_SHARE;

  // Tie-break value of each candidate, in [-0.5, 1]: how strongly the document
  // supports it as a chapter opening, less a nudge towards earlier positions.
  const prefer = active.map(({ list }) =>
    list.map((pos) => {
      const repeats = list.filter((p) => p >= pos && p < pos + floor).length;
      const support = Math.min(1, repeats / FULL_SUPPORT_REPEATS);
      return support - 0.5 * (pos / textLen);
    })
  );

  // Lexicographic comparison: health first, then preference.
  const EPS = 1e-9;
  const better = (aH: number, aP: number, bH: number, bP: number) =>
    aH > bH + EPS || (Math.abs(aH - bH) <= EPS && aP > bP);

  // health[k][j] / pref[k][j] = best suffix score with active[k] at candidate j.
  const health: number[][] = active.map((e) => new Array(e.list.length).fill(-Infinity));
  const pref: number[][] = active.map((e) => new Array(e.list.length).fill(-Infinity));
  // Reconstruction pointers: which chapter the chain resumes at, and which
  // of that chapter's candidates it takes. -1 means the chain ends here.
  const nextK: number[][] = active.map((e) => new Array(e.list.length).fill(-1));
  const nextJ: number[][] = active.map((e) => new Array(e.list.length).fill(-1));
  // How far ahead a skip may look for the chapter that closes the open segment.
  const maxSkip = active.length;

  for (let k = active.length - 1; k >= 0; k--) {
    const list = active[k].list;
    for (let j = 0; j < list.length; j++) {
      const pos = list[j];
      const ownPref = prefer[k][j];

      if (k === active.length - 1) {
        health[k][j] = spanScore(textLen - pos, floor);
        pref[k][j] = ownPref;
        continue;
      }

      let bestH = -Infinity;
      let bestP = -Infinity;
      let bestK = -1;
      let bestJ = -1;

      // Place some later chapter next; every chapter skipped over costs
      // UNPLACED_PENALTY, so the chain stays as complete as it can be.
      for (let k2 = k + 1; k2 < Math.min(active.length, k + 1 + maxSkip); k2++) {
        const skipped = k2 - k - 1;
        const list2 = active[k2].list;
        for (let j2 = 0; j2 < list2.length; j2++) {
          if (list2[j2] <= pos) continue;
          const h =
            spanScore(list2[j2] - pos, floor) +
            health[k2][j2] -
            skipped * UNPLACED_PENALTY;
          const p = ownPref + pref[k2][j2];
          if (better(h, p, bestH, bestP)) {
            bestH = h;
            bestP = p;
            bestK = k2;
            bestJ = j2;
          }
        }
      }

      // Or end the chain here, leaving every later chapter unplaced.
      const tailH =
        spanScore(textLen - pos, floor) -
        (active.length - k - 1) * UNPLACED_PENALTY;
      if (better(tailH, ownPref, bestH, bestP)) {
        bestH = tailH;
        bestP = ownPref;
        bestK = -1;
        bestJ = -1;
      }

      health[k][j] = bestH;
      pref[k][j] = bestP;
      nextK[k][j] = bestK;
      nextJ[k][j] = bestJ;
    }
  }

  // Best opening chapter — anything before it is unplaced and costs the same
  // penalty, so compare on the full score.
  let startK = -1;
  let startJ = -1;
  let bestH = -Infinity;
  let bestP = -Infinity;
  for (let k = 0; k < active.length; k++) {
    for (let j = 0; j < active[k].list.length; j++) {
      const h = health[k][j] - k * UNPLACED_PENALTY;
      if (better(h, pref[k][j], bestH, bestP)) {
        bestH = h;
        bestP = pref[k][j];
        startK = k;
        startJ = j;
      }
    }
  }
  if (startJ === -1) return chosen;

  let k = startK;
  let j = startJ;
  for (;;) {
    chosen[active[k].i] = active[k].list[j];
    const k2 = nextK[k][j];
    const j2 = nextJ[k][j];
    if (k2 < 0 || j2 < 0) break;
    k = k2;
    j = j2;
  }

  return chosen;
}

export function splitTextByChapters(
  fullText: string,
  chapters: DetectedChapter[]
): DetectedChapterWithContent[] {
  if (chapters.length === 0) return [];

  // Single chapter (incl. the "Full Textbook Content" fallback): the whole
  // document is its content — never depend on the title appearing in the text.
  if (chapters.length === 1) {
    return [{ ...chapters[0], content: fullText.trim() }];
  }

  const { normText, indexMap } = buildNormWithMap(fullText);

  // Work in chapter-number order so boundaries follow the book's sequence.
  const ordered = [...chapters].sort((a, b) => a.chapterNumber - b.chapterNumber);

  // 1. Gather EVERY candidate position for each chapter title, then discard
  //    Table-of-Contents occurrences so we match real body headings. Chapters
  //    left with no body occurrence fall through to neighbour inference below.
  const rawCandidates = ordered.map((ch) =>
    findAllTitlePositions(normText, indexMap, ch.title)
  );
  // Dot leaders pin the contents page precisely; the title-cluster rule is the
  // fallback for documents typeset without them.
  const frontCutoff =
    detectFrontMatterEnd(fullText) ||
    findTitleClusterCutoff(rawCandidates, fullText.length, ordered.length);
  // Never let the cutoff strip a chapter's ONLY occurrence — a book whose
  // contents page is its only mention of a unit would otherwise lose it.
  const candidates = rawCandidates.map((list) => {
    if (frontCutoff <= 0) return list;
    const after = list.filter((p) => p > frontCutoff);
    return after.length > 0 ? after : list;
  });

  // 2. Choose one position per chapter as a whole assignment — strictly
  //    increasing, and scored so that no chapter is left with a sliver of
  //    text while its neighbour holds the rest. Picking each title's first
  //    occurrence lands on the contents page; picking its last lands on the
  //    unit's final running page header. Scoring the chain avoids both.
  const chosen = chooseChapterPositions(candidates, fullText.length);

  const found = ordered
    .map((chapter, i) => ({ chapter, position: chosen[i] }))
    .filter((p): p is { chapter: DetectedChapter; position: number } => p.position !== null)
    .sort((a, b) => a.position - b.position);

  // Safety net: no title matched anywhere — put everything in the first
  // chapter rather than silently dropping the entire document.
  if (found.length === 0) {
    return ordered.map((ch, i) => ({
      ...ch,
      content: i === 0 ? fullText.trim() : "",
    }));
  }

  const notFoundChapters = ordered.filter((_, i) => chosen[i] === null);

  const result: DetectedChapterWithContent[] = [];

  // 3. Slice text between consecutive chosen positions.
  for (let i = 0; i < found.length; i++) {
    const start = found[i].position;
    const end = i + 1 < found.length ? found[i + 1].position : fullText.length;
    result.push({ ...found[i].chapter, content: fullText.slice(start, end).trim() });
  }

  // 4. For chapters whose titles weren't found, try to infer position from
  //    chapter number and distribute content from the surrounding found chapters.
  if (notFoundChapters.length > 0) {
    // Build a sorted result array by chapter number so we can insert
    result.sort((a, b) => a.chapterNumber - b.chapterNumber);

    for (const ch of notFoundChapters) {
      // Find the predecessor and successor in the already-found set
      const prev = result
        .filter((r) => r.chapterNumber < ch.chapterNumber && r.content.length > 0)
        .at(-1);
      const next = result
        .filter((r) => r.chapterNumber > ch.chapterNumber && r.content.length > 0)
        .at(0);

      let inferredContent = "";

      if (prev && next) {
        // Steal the second half of the predecessor's content
        const mid = Math.floor(prev.content.length / 2);
        inferredContent = prev.content.slice(mid).trim();
        // Shrink the predecessor so it doesn't double-count
        const prevEntry = result.find((r) => r.chapterNumber === prev.chapterNumber);
        if (prevEntry) prevEntry.content = prev.content.slice(0, mid).trim();
      } else if (prev && prev.content.length > 200) {
        // No successor found – take the tail of the predecessor
        const mid = Math.floor(prev.content.length * 0.6);
        inferredContent = prev.content.slice(mid).trim();
        const prevEntry = result.find((r) => r.chapterNumber === prev.chapterNumber);
        if (prevEntry) prevEntry.content = prev.content.slice(0, mid).trim();
      }
      // else leave as empty — genuinely missing content

      result.push({ ...ch, content: inferredContent });
    }
  }

  // 5. Re-sort by chapter number for clean output
  result.sort((a, b) => a.chapterNumber - b.chapterNumber);
  return result;
}
export async function tutorResponseFromContent(opts: {
  message: string;
  history: { role: "user" | "model"; parts: { text: string }[] }[];
  content: string;
  chapterTitle: string;
  subject: string;
  grade: number;
  actor?: UsageActor;
}): Promise<string> {
  const client = getClient();
  const model = client.getGenerativeModel({
    model: geminiFastModel(),
    systemInstruction: buildTutorSystemPrompt(opts),
  });

  const chat = model.startChat({
    history: opts.history,
    generationConfig: withThinkingCap({
      temperature: 0.7,
      maxOutputTokens: 2048,
    }),
  });

  const result = await chat.sendMessage(opts.message);
  logUsage({ feature: "tutor-chat", provider: "gemini", model: geminiFastModel(), usage: geminiUsage(result.response), actor: opts.actor });
  return result.response.text();
}
