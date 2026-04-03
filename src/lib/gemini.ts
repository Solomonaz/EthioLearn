import { GoogleGenerativeAI } from "@google/generative-ai";

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

// ─── Client ─────────────────────────────────────────────

function getClient() {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error(
      "GEMINI_API_KEY is not configured. Add it to your .env file."
    );
  }
  return new GoogleGenerativeAI(apiKey);
}

// ─── Prompt builder ─────────────────────────────────────

function buildPrompt(opts: GenerateOptions): string {
  const count = opts.count ?? 10;
  const types = opts.questionTypes ?? ["MCQ"];
  const lang = opts.language ?? "en";

  let difficultyInstruction: string;
  if (opts.difficulty && opts.difficulty !== "MIXED") {
    difficultyInstruction = `All questions must be ${opts.difficulty} difficulty.`;
  } else {
    difficultyInstruction = `Mix difficulties: roughly 30% EASY, 40% MEDIUM, 30% HARD.`;
  }

  const typeInstruction = `Generate a mix of the following types as requested: ${types.join(", ")}.
SPECIFIC FORMATTING RULES:
1. MCQ: questionText (the question), options (4 items), correctAnswer (one of the options).
2. TRUE_FALSE: questionText (the statement), options (["True", "False"]), correctAnswer (either "True" or "False").
3. FILL_IN_BLANK: questionText must contain exactly one "_______" (at least 7 underscores). correctAnswer must be the exact missing word/phrase. options can be empty [].
4. MATCH_PAIRS: questionText asks to match items. options must contain all items for Column A followed by all corresponding items for Column B (e.g. [A1, A2, B1, B2]). DO NOT shuffle these in the JSON; the UI will handle shuffling Column B. "correctAnswer" must be a string of pairs separated by pipe, items in pair separated by colon (e.g., "A1:B1|A2:B2").
5. ORDERING: questionText asks to arrange in sequence. options must contain all items in random order. correctAnswer must be the items in correct order separated by pipe (e.g., "Event A|Event B|Event C").`;

  return `You are an expert educational content creator specializing in the Ethiopian curriculum.

TASK: Generate exactly ${count} exam questions based on the textbook chapter content provided below.

SUBJECT: ${opts.subject}
GRADE: Grade ${opts.grade}
CHAPTER: ${opts.chapterTitle}
LANGUAGE: ${lang === "en" ? "English" : lang}

RULES:
1. ${difficultyInstruction}
2. ${typeInstruction}
3. Every question MUST be directly based on the chapter content provided — do NOT invent facts.
4. For all types, the "correctAnswer" property must be formatted exactly as requested.
5. Include a clear, educational explanation for each answer.
6. Questions should test comprehension, application, and analysis — not just recall.
7. Use Bloom's Taxonomy: mix questions that test Remembering, Understanding, Applying, and Analyzing.
8. Avoid ambiguous or trick questions.

OUTPUT FORMAT: Return a JSON object with a single key "questions" containing an array of exactly ${count} question objects.
Each object must have:
- "questionText": string
- "type": "MCQ" | "TRUE_FALSE" | "FILL_IN_BLANK" | "MATCH_PAIRS" | "ORDERING"
- "options": string[]
- "correctAnswer": string (Exactly as formatted in specific rules!)
- "difficulty": "EASY" | "MEDIUM" | "HARD"
- "explanation": string

CHAPTER CONTENT:
"""
${opts.content.slice(0, 50000)}
"""

Generate exactly ${count} questions now as a JSON object with a "questions" array.`;
}

// ─── Validation ─────────────────────────────────────────

function validateQuestions(raw: unknown): GeneratedQuestion[] {
  if (!Array.isArray(raw)) {
    throw new Error("Gemini response is not an array");
  }

  const validated: GeneratedQuestion[] = [];
  const validTypes = ["MCQ", "TRUE_FALSE", "FILL_IN_BLANK", "MATCH_PAIRS", "ORDERING"];

  for (const item of raw) {
    if (!item || typeof item !== "object") continue;

    const q = item as Record<string, unknown>;

    // Required fields
    if (typeof q.questionText !== "string" || !q.questionText.trim()) continue;
    if (typeof q.correctAnswer !== "string" || !q.correctAnswer.trim()) continue;
    if (!Array.isArray(q.options)) continue;

    // Normalize type
    let type = String(q.type).toUpperCase();
    if (!validTypes.includes(type)) type = "MCQ";

    // Normalize difficulty
    const diff = String(q.difficulty || "MEDIUM").toUpperCase();
    const difficulty: "EASY" | "MEDIUM" | "HARD" =
      diff === "EASY" ? "EASY" : diff === "HARD" ? "HARD" : "MEDIUM";

    const options = q.options.map((o: unknown) => String(o));
    const correctAnswer = String(q.correctAnswer).trim();

    // Type-specific validation
    if (type === "MCQ") {
      if (options.length < 2) continue;
      if (!options.includes(correctAnswer)) {
        const match = options.find(o => o.toLowerCase() === correctAnswer.toLowerCase());
        if (!match) continue;
      }
    } else if (type === "TRUE_FALSE") {
      if (!["True", "False"].includes(correctAnswer)) continue;
    } else if (type === "MATCH_PAIRS") {
      const numPairs = correctAnswer.split("|").filter(Boolean).length;
      if (options.length !== numPairs * 2 || options.length < 2) continue;
      if (!correctAnswer.includes(":") || !correctAnswer.includes("|")) continue;
    } else if (type === "ORDERING") {
      if (options.length < 2) continue;
      if (!correctAnswer.includes("|")) continue;
    }

    validated.push({
      questionText: q.questionText.trim(),
      type: type as any,
      options,
      correctAnswer,
      difficulty,
      explanation: typeof q.explanation === "string" ? q.explanation.trim() : "",
    });
  }

  return validated;
}

// ─── Main function ──────────────────────────────────────

export async function generateQuestionsFromContent(
  opts: GenerateOptions
): Promise<GeneratedQuestion[]> {
  const client = getClient();
  const model = client.getGenerativeModel({
    model: "gemini-2.0-flash",
    generationConfig: {
      responseMimeType: "application/json",
      temperature: 0.7,
      maxOutputTokens: 8192,
    },
  });

  const prompt = buildPrompt(opts);

  // Attempt generation with one retry on parse failure
  for (let attempt = 0; attempt < 2; attempt++) {
    const result = await model.generateContent(prompt);
    const text = result.response.text();

    try {
      const parsed = JSON.parse(text);
      const questions = validateQuestions(parsed);

      if (questions.length === 0) {
        if (attempt === 0) continue; // retry
        throw new Error("Gemini returned no valid questions after validation");
      }

      return questions;
    } catch (e) {
      if (attempt === 1) {
        throw new Error(
          `Failed to parse Gemini response: ${e instanceof Error ? e.message : String(e)}`
        );
      }
      // Retry on first attempt
    }
  }

  throw new Error("Gemini question generation failed after 2 attempts");
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

function validateDetectedChapters(raw: unknown): DetectedChapter[] {
  if (!Array.isArray(raw)) {
    throw new Error("Gemini response is not an array");
  }

  const validated: DetectedChapter[] = [];

  for (const item of raw) {
    if (!item || typeof item !== "object") continue;

    const ch = item as Record<string, unknown>;

    const chapterNumber = Number(ch.chapterNumber);
    if (!chapterNumber || chapterNumber < 1 || chapterNumber > 50) continue;

    if (typeof ch.title !== "string" || !ch.title.trim()) continue;

    validated.push({
      chapterNumber,
      title: ch.title.trim(),
    });
  }

  // Sort by chapter number and re-number sequentially
  validated.sort((a, b) => a.chapterNumber - b.chapterNumber);
  validated.forEach((ch, i) => {
    ch.chapterNumber = i + 1;
  });

  return validated;
}

export async function detectChaptersFromContent(
  opts: DetectChaptersOptions
): Promise<DetectedChapter[]> {
  const client = getClient();
  const model = client.getGenerativeModel({
    model: "gemini-2.0-flash",
    generationConfig: {
      responseMimeType: "application/json",
      temperature: 0.3,
      maxOutputTokens: 4096,
    },
  });

  const prompt = buildChapterDetectionPrompt(opts);

  for (let attempt = 0; attempt < 2; attempt++) {
    const result = await model.generateContent(prompt);
    const text = result.response.text();

    try {
      const parsed = JSON.parse(text);
      const chapters = validateDetectedChapters(parsed);

      if (chapters.length === 0) {
        if (attempt === 0) continue;
        throw new Error("Gemini could not detect any chapters in the textbook content");
      }

      return chapters;
    } catch (e) {
      if (attempt === 1) {
        throw new Error(
          `Failed to detect chapters: ${e instanceof Error ? e.message : String(e)}`
        );
      }
    }
  }

  throw new Error("Chapter detection failed after 2 attempts");
}

// ─── Text Splitting ────────────────────────────────────

/**
 * Split full textbook text into per-chapter content using detected chapter titles.
 * Searches for chapter titles in the text and splits at boundaries.
 */
export function splitTextByChapters(
  fullText: string,
  chapters: DetectedChapter[]
): DetectedChapterWithContent[] {
  if (chapters.length === 0) return [];

  const textLower = fullText.toLowerCase();

  // Find the position of each chapter title in the text
  interface ChapterPosition {
    chapter: DetectedChapter;
    position: number;
  }

  const positions: ChapterPosition[] = [];

  for (const ch of chapters) {
    const titleLower = ch.title.toLowerCase();

    // Try exact match first
    let pos = textLower.indexOf(titleLower);

    // If not found, try with common prefixes removed
    if (pos === -1) {
      const stripped = titleLower
        .replace(/^(chapter|unit|lesson|ምዕራፍ)\s*\d*[.:]\s*/i, "")
        .trim();
      if (stripped.length > 5) {
        pos = textLower.indexOf(stripped);
      }
    }

    positions.push({ chapter: ch, position: pos >= 0 ? pos : -1 });
  }

  // Sort found positions by their location in text
  const found = positions
    .filter((p) => p.position >= 0)
    .sort((a, b) => a.position - b.position);

  const notFound = positions.filter((p) => p.position < 0);

  const result: DetectedChapterWithContent[] = [];

  // Assign content to chapters with found positions
  for (let i = 0; i < found.length; i++) {
    const start = found[i].position;
    const end = i + 1 < found.length ? found[i + 1].position : fullText.length;
    const content = fullText.slice(start, end).trim();

    result.push({
      ...found[i].chapter,
      content,
    });
  }

  // Chapters not found in text get empty content
  for (const p of notFound) {
    result.push({
      ...p.chapter,
      content: "",
    });
  }

  // Re-sort by chapter number
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
}): Promise<string> {
  const client = getClient();
  const model = client.getGenerativeModel({
    model: "gemini-2.0-flash",
    systemInstruction: `You are an expert AI Tutor for the EthioLearn platform, specializing in the Ethiopian national curriculum.
Your goal is to help students understand concepts from their textbooks.

RULES:
1. FOCUS: Use ONLY the provided textbook chapter content as your primary source of truth.
2. PEDAGOGY: Act as a supportive, encouraging teacher. Explain things step-by-step. Use analogies appropriate for a Grade ${opts.grade} student.
3. NO DIRECT ANSWERS: If a student asks for a specific exam answer, guide them to find it in the text rather than just giving it.
4. ENGAGEMENT: Ask follow-up questions to check if the student understood your explanation.
5. LANGUAGE: Respond in the language used by the student (English or Amharic). Use clear, simple formatting.
6. SCOPE: If the student asks about something outside the provided chapter context, politely redirect them to focus on the current topic.

SUBJECT: ${opts.subject}
GRADE: ${opts.grade}
CHAPTER: ${opts.chapterTitle}

CHAPTER CONTENT:
"""
${opts.content.slice(0, 50000)}
"""`,
  });

  const chat = model.startChat({
    history: opts.history,
    generationConfig: {
      temperature: 0.7,
      maxOutputTokens: 2048,
    },
  });

  const result = await chat.sendMessage(opts.message);
  return result.response.text();
}
