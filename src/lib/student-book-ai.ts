/**
 * AI question generation for student-uploaded books.
 * Uses a lighter-touch prompt (faster, fewer quality checks) compared
 * to the admin textbook pipeline. (SRS §4.8.2)
 *
 * Falls back through: Gemini → Groq
 */

import { generateQuestionsFromContent } from "./gemini";
import { groqGenerateQuestions } from "./groq";

export interface StudentBookQuestion {
  question: string;
  options: string[];
  correctAnswer: string;
  explanation: string;
  difficulty: "EASY" | "MEDIUM" | "HARD";
  type: string;
}

interface GenerateFromTextOptions {
  text: string;
  title: string;
  difficulty: "EASY" | "MEDIUM" | "HARD";
  questionCount: number;
  questionType: string;
}

/**
 * Generate quiz questions from plain extracted text of a student book.
 * Trims the text to the first ~8000 characters to keep prompts efficient.
 */
export async function generateQuestionsFromText(
  opts: GenerateFromTextOptions
): Promise<StudentBookQuestion[]> {
  const { text, title, difficulty, questionCount, questionType } = opts;

  // Use first 8000 chars — enough for a single meaningful quiz
  const contentSnippet = text.slice(0, 8000);

  const genOptions = {
    content: contentSnippet,
    chapterTitle: title,
    subject: "Personal Study Book",
    grade: 0, // unknown grade for personal books
    count: questionCount,
    difficulty: difficulty as "EASY" | "MEDIUM" | "HARD",
    questionTypes: ["MCQ"] as ("MCQ")[],
    language: "en",
  };

  try {
    // Primary: Gemini
    const raw = await generateQuestionsFromContent(genOptions);
    return raw.map((q) => ({
      question: q.questionText,
      options: Array.isArray(q.options)
        ? (q.options as unknown[]).map((o) =>
            typeof o === "string" ? o : (o as { text: string }).text ?? String(o)
          )
        : [],
      correctAnswer: typeof q.correctAnswer === "string"
        ? q.correctAnswer
        : (q.correctAnswer as { text: string })?.text ?? String(q.correctAnswer),
      explanation: q.explanation ?? "",
      difficulty: q.difficulty ?? difficulty,
      type: q.type ?? questionType,
    }));
  } catch (primaryErr) {
    console.warn("[student-book-ai] Gemini failed, trying Groq:", primaryErr);
    try {
      // Fallback: Groq
      const raw = await groqGenerateQuestions(genOptions);
      return raw.map((q) => ({
        question: q.questionText,
        options: Array.isArray(q.options)
          ? (q.options as unknown[]).map((o) =>
              typeof o === "string" ? o : (o as { text: string }).text ?? String(o)
            )
          : [],
        correctAnswer: typeof q.correctAnswer === "string"
          ? q.correctAnswer
          : (q.correctAnswer as { text: string })?.text ?? String(q.correctAnswer),
        explanation: q.explanation ?? "",
        difficulty: q.difficulty ?? difficulty,
        type: q.type ?? questionType,
      }));
    } catch (fallbackErr) {
      console.error("[student-book-ai] All AI providers failed:", fallbackErr);
      throw new Error("AI question generation failed for this book.");
    }
  }
}
