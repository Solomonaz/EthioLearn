/**
 * Shared prompt builders for the AI Tutor chat and animated video-tutorial
 * scripts. Centralising these means every provider (Gemini, Groq,
 * NVIDIA) sends the SAME instructions and uses the SAME content window, so a
 * mid-session provider failover no longer changes the character of the output.
 *
 * (Question-generation prompts live in ./question-prompts — this module covers
 * the tutor + video features.)
 */

import type { VideoScript } from "./gemini";

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

// ─── Video-tutorial script prompt ───────────────────────

export interface VideoPromptOptions {
  content: string;
  chapterTitle: string;
  subject: string;
  grade: number;
  topic?: string;
}

export function buildVideoScriptPrompt(opts: VideoPromptOptions): string {
  return `You are an expert educational video script writer for the Ethiopian national curriculum.
Create a richly animated video tutorial script for a Grade ${opts.grade} student.

Subject: ${opts.subject}
Chapter: ${opts.chapterTitle}
${opts.topic ? `Focus topic: ${opts.topic}` : ""}

Chapter content (use ONLY this as your source — do NOT invent facts):
"""
${opts.content.slice(0, VIDEO_CONTENT_CHARS)}
"""

TASK: Generate the RIGHT NUMBER of slides for this specific topic.
- Simple concept (1-2 ideas): 3-4 slides
- Medium concept (3-5 ideas): 5-7 slides
- Complex concept (many ideas/steps): 8-12 slides
Always start with an introduction slide and end with a summary/recap slide.

RULES:
1. Each slide narration: 40-60 words of friendly, spoken English — like an enthusiastic teacher.
2. keyPoints: 2-4 short bullets shown on screen (5-12 words each).
3. teacherEmotion: pick the most appropriate for the content:
   - "explaining" → general teaching, definitions
   - "pointing"   → directing attention to diagram/process
   - "excited"    → introducing big idea, conclusion, breakthrough
   - "thinking"   → posing a question, showing cause-effect
   - "writing"    → introducing formula, writing down rules
4. visualType + visualData: choose the BEST visual for each slide's content:
   - "process"    → visualData.steps: 2-5 sequential steps (for how-things-work, cause-effect chains)
   - "comparison" → visualData.leftLabel, leftItems[], rightLabel, rightItems[] (for vs/differences)
   - "formula"    → visualData.text (the formula/equation), visualData.subtext (what it means)
   - "timeline"   → visualData.events[]: [{period, event}] (for historical events, sequences in time)
   - "highlight"  → visualData.text (big key concept/word), visualData.subtext (brief definition)
   - "diagram"    → visualData.steps[]: node labels (for systems, cycles, relationships — shown as connected boxes)
   - "list"       → no visualData needed — keyPoints ARE the visual (for lists of facts/rules)

Return ONLY valid JSON, no markdown fences:
{
  "title": "Tutorial title",
  "estimatedMinutes": 5,
  "slides": [
    {
      "heading": "Slide heading (3-7 words)",
      "narration": "Natural spoken text, 40-60 words.",
      "keyPoints": ["Short bullet 1", "Short bullet 2"],
      "teacherEmotion": "explaining",
      "visualType": "highlight",
      "visualData": { "text": "Big Concept", "subtext": "One-line definition" }
    }
  ]
}`;
}

/**
 * Parse and validate a video-script JSON response from any provider.
 * Tolerates markdown code fences and surrounding prose by extracting the
 * outermost JSON object before parsing.
 */
export function parseVideoScript(rawText: string): VideoScript {
  const text = (rawText ?? "").trim();

  // Strip markdown fences, then fall back to extracting the outermost {...}.
  let candidate = text.replace(/^```json\s*/i, "").replace(/^```\s*/i, "").replace(/\s*```$/i, "").trim();
  if (!candidate.startsWith("{")) {
    const match = candidate.match(/\{[\s\S]*\}/);
    if (!match) throw new Error("AI returned no valid JSON for video script");
    candidate = match[0];
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(candidate);
  } catch {
    throw new Error("AI returned invalid JSON for video script");
  }

  const script = parsed as VideoScript;
  if (!script.slides || !Array.isArray(script.slides) || script.slides.length === 0) {
    throw new Error("Invalid video script structure returned by AI");
  }

  return script;
}
