/**
 * Teaching-assistant task list — the client-safe half.
 *
 * Kept apart from `lib/teaching-assistant`, which imports the Gemini, Groq and
 * NVIDIA SDKs and must never reach the browser bundle. The page needs only
 * these labels, so they live here and the server module imports them back.
 */

export type AssistantTask =
  | "LESSON_PLAN"
  | "WORKSHEET"
  | "WORKOUT"
  | "NOTES"
  | "EXPLANATION"
  | "EXAM_BLUEPRINT"
  | "FREEFORM";

export const ASSISTANT_TASKS: { value: AssistantTask; label: string; hint: string }[] = [
  {
    value: "LESSON_PLAN",
    label: "Lesson plan",
    hint: "Objectives, sequence, timing, checks for understanding",
  },
  {
    value: "WORKSHEET",
    label: "Worksheet",
    hint: "Practice items with an answer key",
  },
  {
    value: "WORKOUT",
    label: "Workout problems",
    hint: "Calculations to solve with full working shown",
  },
  {
    value: "NOTES",
    label: "Board notes",
    hint: "Concise notes to write up or project",
  },
  {
    value: "EXPLANATION",
    label: "Explain a concept",
    hint: "A clear classroom explanation with examples",
  },
  {
    value: "EXAM_BLUEPRINT",
    label: "Exam blueprint",
    hint: "Topic weighting and question spread",
  },
  {
    value: "FREEFORM",
    label: "Anything else",
    hint: "Describe what you need",
  },
];
