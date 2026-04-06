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

  const typeInstruction = `Generate a mix of the following types as requested: ${types.join(", ")}.
SPECIFIC FORMATTING RULES:
1. MCQ: questionText (the question), options (4 items), correctAnswer (one of the options).
2. TRUE_FALSE: questionText (the statement), options (["True", "False"]), correctAnswer (either "True" or "False").
3. FILL_IN_BLANK: questionText must contain exactly one "_______" (at least 7 underscores). correctAnswer must be the exact missing word/phrase. options can be empty [].
4. MATCH_PAIRS: questionText asks to match items. options must contain all items for Column A followed by all corresponding items for Column B (e.g. [A1, A2, B1, B2]). DO NOT shuffle these in the JSON; the UI will handle shuffling Column B for the student. "correctAnswer" must be a string of pairs separated by pipe, items in pair separated by colon (e.g., "A1:B1|A2:B2").
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
${opts.content.slice(0, 30000)}
"""

Generate exactly ${count} questions now as a JSON object with a "questions" array. No preamble or markdown.`;
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
      temperature: 0.5,
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
export async function groqTutorChatResponse(opts: {
  message: string;
  history: { role: "user" | "assistant"; content: string }[];
  content: string;
  chapterTitle: string;
  subject: string;
  grade: number;
}): Promise<string> {
  const client = getGroqClient();

  const systemPrompt = `You are an expert AI Tutor for the EthioLearn platform, specializing in the Ethiopian national curriculum.
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
${opts.content.slice(0, 30000)}
"""`;

  const completion = await client.chat.completions.create({
    model: "llama-3.3-70b-versatile",
    messages: [
      { role: "system", content: systemPrompt },
      ...opts.history,
      { role: "user", content: opts.message },
    ],
    temperature: 0.7,
    max_tokens: 2048,
  });

  return completion.choices[0]?.message?.content ?? "I apologize, but I'm having trouble responding right now.";
}

// ─── Video Tutorial Script (Groq fallback) ──────────────

import type { VideoScript } from "./gemini";

export async function groqGenerateVideoScript(opts: {
  content: string;
  chapterTitle: string;
  subject: string;
  grade: number;
  topic?: string;
}): Promise<VideoScript> {
  const client = getGroqClient();

  const prompt = `You are an expert educational video script writer for the Ethiopian national curriculum.
Create a richly animated video tutorial script for a Grade ${opts.grade} student.

Subject: ${opts.subject}
Chapter: ${opts.chapterTitle}
${opts.topic ? `Focus topic: ${opts.topic}` : ""}

Chapter content:
"""
${opts.content.slice(0, 6000)}
"""

Generate the RIGHT NUMBER of slides for this topic:
- Simple concept (1-2 ideas): 3-4 slides
- Medium concept (3-5 ideas): 5-7 slides
- Complex concept (many steps): 8-12 slides
Always start with an introduction slide and end with a summary slide.

Each slide needs: heading, narration (40-60 words spoken English), keyPoints (2-4 bullets),
teacherEmotion (one of: "explaining","pointing","excited","thinking","writing"),
visualType (one of: "process","comparison","formula","timeline","highlight","diagram","list"),
and visualData matching the visualType:
- "process": {"steps":["step1","step2",...]}
- "comparison": {"leftLabel":"A","leftItems":["..."],"rightLabel":"B","rightItems":["..."]}
- "formula": {"text":"F=ma","subtext":"Force equals mass times acceleration"}
- "timeline": {"events":[{"period":"1900","event":"Discovery of X"},...]}
- "highlight": {"text":"KEY CONCEPT","subtext":"Brief definition"}
- "diagram": {"steps":["Node1","Node2","Node3"]}
- "list": {} (no visualData needed — keyPoints are the visual)

Return ONLY valid JSON, no markdown fences:
{
  "title": "Tutorial title",
  "estimatedMinutes": 5,
  "slides": [
    {
      "heading": "Heading",
      "narration": "Spoken text 40-60 words.",
      "keyPoints": ["Bullet 1", "Bullet 2"],
      "teacherEmotion": "explaining",
      "visualType": "highlight",
      "visualData": {"text": "Concept", "subtext": "Definition"}
    }
  ]
}`;

  const completion = await client.chat.completions.create({
    model: "llama-3.3-70b-versatile",
    messages: [{ role: "user", content: prompt }],
    temperature: 0.6,
    max_tokens: 3000,
  });

  const text = (completion.choices[0]?.message?.content ?? "").trim();

  // Extract JSON from response
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error("Groq returned no valid JSON for video script");

  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonMatch[0]);
  } catch {
    throw new Error("Groq returned invalid JSON for video script");
  }

  const script = parsed as VideoScript;
  if (!script.slides || !Array.isArray(script.slides) || script.slides.length === 0) {
    throw new Error("Invalid video script structure returned by Groq");
  }

  return script;
}
