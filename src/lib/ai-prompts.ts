/**
 * Shared prompt builders for the AI Tutor chat
 * scripts. Centralising these means every provider (Gemini, Groq,
 * NVIDIA) sends the SAME instructions and uses the SAME content window, so a
 * mid-session provider failover no longer changes the character of the output.
 *
 * (Question-generation prompts live in ./question-prompts — this module covers
 * the tutor feature.)
 */


// ─── Shared content windows ─────────────────────────────
// A single source of truth for how much chapter text each feature sends,
// so all providers behave identically regardless of which one answers.
export const TUTOR_CONTENT_CHARS = 30000;
export const VIDEO_CONTENT_CHARS = 8000;

// ─── Tutor system prompt ────────────────────────────────

export interface TutorPromptOptions {
  content: string;
  chapterTitle: string;
  subject: string;
  grade: number;
}

export function buildTutorSystemPrompt(opts: TutorPromptOptions): string {
  return `You are an expert AI Tutor for the EthioLearn platform, specializing in the Ethiopian national curriculum.
Your goal is to help students understand concepts from their textbooks.

RULES:
1. FOCUS: Use the provided textbook material below as your primary source of truth. The material is the most relevant excerpts retrieved for the student's question.
2. PEDAGOGY: Act as a supportive, encouraging teacher. Explain things step-by-step. Use analogies appropriate for a Grade ${opts.grade} student.
3. NO DIRECT ANSWERS: If a student asks for a specific exam answer, guide them to find it in the text rather than just giving it.
4. ENGAGEMENT: Ask follow-up questions to check if the student understood your explanation.
5. LANGUAGE: Respond in the language used by the student (English or Amharic). Use clear, simple formatting.
6. SCOPE: If the provided material does not cover the student's question, say so honestly and encourage them to rephrase or pick a related topic from this chapter — do NOT invent facts that are not supported by the material.

SUBJECT: ${opts.subject}
GRADE: ${opts.grade}
CHAPTER: ${opts.chapterTitle}

TEXTBOOK MATERIAL:
"""
${opts.content.slice(0, TUTOR_CONTENT_CHARS)}
"""`;
}
