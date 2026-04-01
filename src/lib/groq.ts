import Groq from "groq-sdk";
import type {
  GenerateOptions,
  GeneratedQuestion,
  DetectChaptersOptions,
  DetectedChapter,
} from "./gemini";

// ─── Client ─────────────────────────────────────────────

function getGroqClient() {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) {
    throw new Error(
      "GROQ_API_KEY is not configured. Add it to your .env file."
    );
  }
  return new Groq({ apiKey });
}

// ─── Prompt builders (reuse same prompts as Gemini) ─────

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

  const typeInstruction = types.includes("TRUE_FALSE")
    ? `Question types: MCQ (4 options) and TRUE_FALSE (2 options: "True", "False"). Mix both types.`
    : `All questions must be MCQ type with exactly 4 options each.`;

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
4. Each question must have exactly one correct answer that appears in the options array.
5. For MCQ, provide exactly 4 plausible options. Make distractors realistic but clearly wrong.
6. For TRUE_FALSE, options must be exactly ["True", "False"].
7. Include a clear, educational explanation for each answer.
8. Questions should test comprehension, application, and analysis — not just recall.
9. Vary question styles: definitions, cause-effect, comparisons, applications, scenarios.
10. Avoid ambiguous or trick questions.

OUTPUT FORMAT: Return ONLY a JSON array of question objects. No markdown, no code fences, no extra text. Each object must have:
- "questionText": string (the question)
- "type": "MCQ" or "TRUE_FALSE"
- "options": string[] (4 items for MCQ, 2 for TRUE_FALSE)
- "correctAnswer": string (must exactly match one of the options)
- "difficulty": "EASY" | "MEDIUM" | "HARD"
- "explanation": string (why the correct answer is right)

CHAPTER CONTENT:
"""
${opts.content.slice(0, 30000)}
"""

Generate exactly ${count} questions now as a JSON array.`;
}

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

OUTPUT FORMAT: Return ONLY a JSON array of objects. No markdown, no code fences, no extra text. Each object must have:
- "chapterNumber": number (sequential, starting from 1)
- "title": string (the chapter/unit title as it appears in the book)

TEXTBOOK CONTENT:
"""
${opts.content.slice(0, 30000)}
"""

Identify all chapters/units now as a JSON array.`;
}

// ─── JSON extraction helper ─────────────────────────────

function extractJson(text: string): unknown {
  // Try direct parse first
  try {
    return JSON.parse(text);
  } catch {
    // Try extracting from markdown code block
    const codeBlockMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (codeBlockMatch) {
      return JSON.parse(codeBlockMatch[1].trim());
    }
    // Try extracting array from text
    const arrayMatch = text.match(/\[[\s\S]*\]/);
    if (arrayMatch) {
      return JSON.parse(arrayMatch[0]);
    }
    throw new Error("Could not extract JSON from Groq response");
  }
}

// ─── Validation (same logic as gemini.ts) ───────────────

function validateQuestions(raw: unknown): GeneratedQuestion[] {
  if (!Array.isArray(raw)) {
    throw new Error("Response is not an array");
  }

  const validated: GeneratedQuestion[] = [];

  for (const item of raw) {
    if (!item || typeof item !== "object") continue;

    const q = item as Record<string, unknown>;

    if (typeof q.questionText !== "string" || !q.questionText.trim()) continue;
    if (typeof q.correctAnswer !== "string" || !q.correctAnswer.trim()) continue;
    if (!Array.isArray(q.options) || q.options.length < 2) continue;

    const type = q.type === "TRUE_FALSE" ? "TRUE_FALSE" : "MCQ";

    const diff = String(q.difficulty || "MEDIUM").toUpperCase();
    const difficulty: "EASY" | "MEDIUM" | "HARD" =
      diff === "EASY" ? "EASY" : diff === "HARD" ? "HARD" : "MEDIUM";

    const options = q.options.map((o: unknown) => String(o));
    if (!options.includes(q.correctAnswer)) {
      const match = options.find(
        (o: string) => o.toLowerCase() === String(q.correctAnswer).toLowerCase()
      );
      if (match) {
        q.correctAnswer = match;
      } else {
        continue;
      }
    }

    validated.push({
      questionText: q.questionText.trim(),
      type,
      options,
      correctAnswer: String(q.correctAnswer),
      difficulty,
      explanation: typeof q.explanation === "string" ? q.explanation.trim() : "",
    });
  }

  return validated;
}

function validateDetectedChapters(raw: unknown): DetectedChapter[] {
  if (!Array.isArray(raw)) {
    throw new Error("Response is not an array");
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

  validated.sort((a, b) => a.chapterNumber - b.chapterNumber);
  validated.forEach((ch, i) => {
    ch.chapterNumber = i + 1;
  });

  return validated;
}

// ─── Question Generation ────────────────────────────────

export async function groqGenerateQuestions(
  opts: GenerateOptions
): Promise<GeneratedQuestion[]> {
  const client = getGroqClient();
  const prompt = buildPrompt(opts);

  for (let attempt = 0; attempt < 2; attempt++) {
    const completion = await client.chat.completions.create({
      model: "llama-3.3-70b-versatile",
      messages: [
        {
          role: "system",
          content:
            "You are an expert educational content creator. Always respond with valid JSON only. No markdown, no explanations outside the JSON.",
        },
        { role: "user", content: prompt },
      ],
      temperature: 0.7,
      max_tokens: 8192,
      response_format: { type: "json_object" },
    });

    const text = completion.choices[0]?.message?.content ?? "";

    try {
      const parsed = extractJson(text);
      // Groq with json_object mode may wrap in an object like { "questions": [...] }
      const arr = Array.isArray(parsed)
        ? parsed
        : (parsed as Record<string, unknown>).questions;
      const questions = validateQuestions(arr);

      if (questions.length === 0) {
        if (attempt === 0) continue;
        throw new Error("Groq returned no valid questions after validation");
      }

      return questions;
    } catch (e) {
      if (attempt === 1) {
        throw new Error(
          `Failed to parse Groq response: ${e instanceof Error ? e.message : String(e)}`
        );
      }
    }
  }

  throw new Error("Groq question generation failed after 2 attempts");
}

// ─── Chapter Detection ──────────────────────────────────

export async function groqDetectChapters(
  opts: DetectChaptersOptions
): Promise<DetectedChapter[]> {
  const client = getGroqClient();
  const prompt = buildChapterDetectionPrompt(opts);

  for (let attempt = 0; attempt < 2; attempt++) {
    const completion = await client.chat.completions.create({
      model: "llama-3.3-70b-versatile",
      messages: [
        {
          role: "system",
          content:
            "You are an expert at analyzing textbook structure. Always respond with valid JSON only. No markdown, no explanations outside the JSON.",
        },
        { role: "user", content: prompt },
      ],
      temperature: 0.3,
      max_tokens: 4096,
      response_format: { type: "json_object" },
    });

    const text = completion.choices[0]?.message?.content ?? "";

    try {
      const parsed = extractJson(text);
      // Groq may wrap in object like { "chapters": [...] }
      const arr = Array.isArray(parsed)
        ? parsed
        : (parsed as Record<string, unknown>).chapters;
      const chapters = validateDetectedChapters(arr);

      if (chapters.length === 0) {
        if (attempt === 0) continue;
        throw new Error(
          "Groq could not detect any chapters in the textbook content"
        );
      }

      return chapters;
    } catch (e) {
      if (attempt === 1) {
        throw new Error(
          `Failed to detect chapters via Groq: ${e instanceof Error ? e.message : String(e)}`
        );
      }
    }
  }

  throw new Error("Groq chapter detection failed after 2 attempts");
}
