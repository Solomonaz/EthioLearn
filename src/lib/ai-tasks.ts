/**
 * The AI tasks the app routes, and which providers can serve each one.
 *
 * Pure data — no database, no SDKs — so the admin page (a client component) can
 * import it as well as the server-side router in `ai-routing.ts`.
 *
 * Why routing is per task
 * ───────────────────────
 * There used to be ONE provider order shared by everything, which made the
 * obvious configuration impossible: "Nemotron for question generation, Gemini
 * for Bloom tagging". Worse, only some tasks actually followed that order — the
 * tutor, Bloom tagging and quality checks had hard-coded chains — so moving a
 * provider on the admin screen silently did nothing for them. Each task now owns
 * its own ordered chain of provider + model steps.
 *
 * `supported` is not a preference, it is what the code can actually do: a
 * provider is listed only when there is a working implementation of that task
 * for it. Vision is Gemini-only because only the Gemini path sends images.
 *
 * GEMINI_VERTEX (Agent Platform) is listed wherever GEMINI is: it runs the same
 * Gemini code against Google Cloud instead of AI Studio. It sits just ahead of
 * GEMINI in the default chains and is skipped while GEMINI_VERTEX_API_KEY is
 * unset, so a deployment without that key behaves exactly as before.
 */

export type AiProvider = "GEMINI" | "GEMINI_VERTEX" | "GROQ" | "NVIDIA" | "OPENROUTER" | "OLLAMA";

export const AI_PROVIDERS: AiProvider[] = ["GEMINI", "GEMINI_VERTEX", "GROQ", "NVIDIA", "OPENROUTER", "OLLAMA"];

/** Both Gemini backends — they share one implementation (see lib/gemini-backend). */
export function isGeminiProvider(p: AiProvider): boolean {
  return p === "GEMINI" || p === "GEMINI_VERTEX";
}

export const PROVIDER_LABEL: Record<AiProvider, string> = {
  GEMINI: "Google Gemini (AI Studio)",
  GEMINI_VERTEX: "Google Gemini (Agent Platform)",
  GROQ: "Groq",
  NVIDIA: "NVIDIA NIM",
  OPENROUTER: "OpenRouter",
  OLLAMA: "Ollama (local)",
};

export type AiTask =
  | "question-generation"
  | "chapter-detection"
  | "answer-verification"
  | "vision"
  | "bloom-tagging"
  | "quality-check"
  | "factual-tiebreak"
  | "tutor-chat"
  | "query-rewrite"
  | "teacher-assistant"
  | "exam-extraction";

/**
 * One step of a task's chain.
 *
 * `model: null` means "the provider's default model" — exactly what the code
 * used before per-task routing existed, so an unedited chain behaves identically.
 */
export interface RouteStep {
  provider: AiProvider;
  model: string | null;
}

export interface TaskMeta {
  id: AiTask;
  label: string;
  description: string;
  /** Providers with a working implementation of this task. */
  supported: AiProvider[];
  /**
   * Which Gemini default a blank model resolves to. Only Gemini (both
   * backends) has two defaults (flagship / light); every other provider has one.
   */
  geminiSlot: "chat" | "fast";
  /** The chain used until an admin saves one. Mirrors the pre-routing code. */
  defaultChain: RouteStep[];
  /** Shown under the task on the admin page. */
  note?: string;
}

const step = (provider: AiProvider): RouteStep => ({ provider, model: null });

export const AI_TASKS: TaskMeta[] = [
  {
    id: "question-generation",
    label: "Question generation",
    description: "Writes quiz and question-bank questions from textbook chapters.",
    supported: ["GEMINI", "GEMINI_VERTEX", "GROQ", "NVIDIA", "OPENROUTER", "OLLAMA"],
    geminiSlot: "chat",
    // GPT-6 Luna first (benchmarked 2026-09-23 against Gemini 3.8-flash on the
    // same batches and judge: every answer key verified, no factual errors,
    // ~6-7x cheaper per usable question, ~10-20s per batch). Named explicitly so
    // it does not depend on whatever OpenRouter's default model is set to.
    // Gemini follows as the fallback when OpenRouter is down or unkeyed.
    defaultChain: [
      { provider: "OPENROUTER", model: "openai/gpt-6-luna" },
      ...["GEMINI_VERTEX", "GEMINI", "GROQ", "NVIDIA", "OLLAMA"].map((p) => step(p as AiProvider)),
    ],
    note: "Groq's free tier can reject large chapter prompts (413).",
  },
  {
    id: "chapter-detection",
    label: "Chapter detection",
    description: "Finds the units and chapters when a textbook is uploaded.",
    supported: ["GEMINI", "GEMINI_VERTEX", "GROQ", "NVIDIA", "OPENROUTER", "OLLAMA"],
    geminiSlot: "chat",
    // NVIDIA last: measured inventing "UNIT 5: ???" … "UNIT 18: ???" for a
    // two-unit book, which corrupts the chapter split.
    defaultChain: ["GEMINI_VERTEX", "GEMINI", "GROQ", "OPENROUTER", "OLLAMA", "NVIDIA"].map((p) => step(p as AiProvider)),
  },
  {
    id: "answer-verification",
    label: "Answer verifier",
    description: "Independently re-solves each generated question to catch wrong answer keys.",
    supported: ["GEMINI", "GEMINI_VERTEX", "GROQ", "NVIDIA", "OPENROUTER", "OLLAMA"],
    geminiSlot: "chat",
    defaultChain: ["GEMINI_VERTEX", "GEMINI", "GROQ", "NVIDIA", "OLLAMA"].map((p) => step(p as AiProvider)),
    note: "The provider that generated the questions is automatically moved to the end, so the check is a second opinion.",
  },
  {
    id: "vision",
    label: "Vision",
    description: "Reads graphs, handwritten equations and 3D-shape sketches from images.",
    supported: ["GEMINI", "GEMINI_VERTEX"],
    geminiSlot: "chat",
    defaultChain: [step("GEMINI_VERTEX"), step("GEMINI")],
    note: "Only Gemini (either backend) can read images here. Add another Gemini step with a different model as a fallback.",
  },
  {
    id: "bloom-tagging",
    label: "Bloom tagging",
    description: "Labels every textbook chunk with its Bloom's taxonomy level during processing.",
    supported: ["GEMINI", "GEMINI_VERTEX", "GROQ", "NVIDIA", "OPENROUTER", "OLLAMA"],
    geminiSlot: "fast",
    defaultChain: ["GEMINI_VERTEX", "GEMINI", "GROQ", "OLLAMA"].map((p) => step(p as AiProvider)),
    note: "If every step fails, a keyword heuristic tags the chunk instead.",
  },
  {
    id: "quality-check",
    label: "Quality checks",
    description: "Checks difficulty, grammar, facts, distractors and scope of generated questions.",
    supported: ["GEMINI", "GEMINI_VERTEX", "GROQ", "NVIDIA", "OPENROUTER", "OLLAMA"],
    geminiSlot: "fast",
    defaultChain: ["GROQ", "GEMINI_VERTEX", "GEMINI", "OLLAMA"].map((p) => step(p as AiProvider)),
  },
  {
    id: "factual-tiebreak",
    label: "Factual tie-break",
    description:
      "Decides when the answer verifier accepts a question but the quality check calls it factually wrong.",
    supported: ["GEMINI", "GEMINI_VERTEX", "GROQ", "NVIDIA", "OPENROUTER"],
    geminiSlot: "chat",
    // DeepSeek first: a third model family (the generator is OpenAI, the
    // verifier Google), so its vote is independent of both — and with
    // reasoning on it costs ~$0.0003 per call. Gemini flagship (with a larger
    // thinking budget) takes over when OpenRouter is down or unkeyed.
    defaultChain: [
      { provider: "OPENROUTER", model: "deepseek/deepseek-v4-flash" },
      step("GEMINI_VERTEX"),
      step("GEMINI"),
      step("GROQ"),
    ],
    note: "Runs only on disagreement, so it is rare. Pick a reasoning-capable model — this is the step that works the maths out.",
  },
  {
    id: "tutor-chat",
    label: "Tutor chat",
    description: "Answers students in the AI tutor, graph and geometry helpers.",
    supported: ["GROQ", "GEMINI", "GEMINI_VERTEX", "NVIDIA"],
    geminiSlot: "fast",
    defaultChain: ["GROQ", "GEMINI_VERTEX", "GEMINI", "NVIDIA"].map((p) => step(p as AiProvider)),
    note: "Student-facing and interactive — put a fast provider first.",
  },
  {
    id: "query-rewrite",
    label: "Tutor search rewrite",
    description: "Turns a follow-up like \"why does that happen?\" into a searchable query before the tutor looks up the textbook.",
    supported: ["GEMINI", "GEMINI_VERTEX", "GROQ"],
    geminiSlot: "fast",
    defaultChain: ["GEMINI_VERTEX", "GEMINI", "GROQ"].map((p) => step(p as AiProvider)),
    note: "Runs on every follow-up message with a 2.5s total budget; on timeout the raw message is used.",
  },
  {
    id: "teacher-assistant",
    label: "Teacher assistant",
    description: "Writes long-form answers and activity content for teachers.",
    supported: ["GEMINI", "GEMINI_VERTEX", "GROQ", "NVIDIA", "OPENROUTER"],
    geminiSlot: "chat",
    // GPT-6 Luna first, as for question generation: the teacher documents are
    // the most expensive calls per request on Gemini 3.8-flash (~$0.008 each).
    // Gemini stays as the fallback when OpenRouter is down or unkeyed.
    defaultChain: [
      { provider: "OPENROUTER", model: "openai/gpt-6-luna" },
      ...["GEMINI_VERTEX", "GEMINI", "GROQ", "NVIDIA"].map((p) => step(p as AiProvider)),
    ],
  },
  {
    id: "exam-extraction",
    label: "National exam extraction",
    description: "Reads uploaded past national exam papers into questions, options and answers for admin review.",
    supported: ["GEMINI", "GEMINI_VERTEX", "OPENROUTER", "GROQ"],
    geminiSlot: "chat",
    // Long, messy input (OCR'd papers): Gemini's long context first.
    defaultChain: [step("GEMINI_VERTEX"), step("GEMINI"), { provider: "OPENROUTER", model: "openai/gpt-6-luna" }, step("GROQ")],
    note: "Runs only when an admin uploads a paper. Every extracted question is reviewed before publishing.",
  },
];

export const TASK_BY_ID: Record<AiTask, TaskMeta> = Object.fromEntries(
  AI_TASKS.map((t) => [t.id, t])
) as Record<AiTask, TaskMeta>;

export const MAX_CHAIN_STEPS = 8;
export const MAX_MODEL_ID_LENGTH = 200;

/**
 * Normalise an untrusted chain (a DB JSON column or a request body) into valid
 * steps for `task`: known, supported providers only; model trimmed or null;
 * exact duplicates dropped; capped at MAX_CHAIN_STEPS. Never throws.
 */
export function sanitizeChain(task: AiTask, raw: unknown): RouteStep[] {
  if (!Array.isArray(raw)) return [];
  const supported = TASK_BY_ID[task].supported;
  const seen = new Set<string>();
  const out: RouteStep[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const provider = (item as { provider?: unknown }).provider;
    if (typeof provider !== "string" || !supported.includes(provider as AiProvider)) continue;
    const rawModel = (item as { model?: unknown }).model;
    const model =
      typeof rawModel === "string" && rawModel.trim()
        ? rawModel.trim().slice(0, MAX_MODEL_ID_LENGTH)
        : null;
    const key = `${provider}|${model ?? ""}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ provider: provider as AiProvider, model });
    if (out.length >= MAX_CHAIN_STEPS) break;
  }
  return out;
}

/** The provider facts a step's status depends on. */
export interface ProviderState {
  id: AiProvider;
  enabled: boolean;
  hasKey: boolean;
  models: { chat: string | null; fast: string | null };
}

/**
 * Will this step run, and with which model? Shared by the server router and the
 * admin page so the page shows exactly what the server will do.
 *
 * `skip` is a short human reason when the step will be passed over.
 */
export function stepStatus(
  task: AiTask,
  step: RouteStep,
  provider: ProviderState | undefined,
  ollamaEnabled: boolean
): { effectiveModel: string | null; skip: string | null } {
  if (!provider) return { effectiveModel: step.model, skip: "unknown provider" };
  const effectiveModel =
    step.model ??
    (isGeminiProvider(provider.id) && TASK_BY_ID[task].geminiSlot === "fast"
      ? provider.models.fast
      : provider.models.chat);
  let skip: string | null = null;
  if (!TASK_BY_ID[task].supported.includes(step.provider)) skip = "not supported for this task";
  else if (!provider.enabled) skip = "provider disabled";
  else if (!provider.hasKey) skip = "no API key";
  else if (provider.id === "OLLAMA" && !ollamaEnabled) skip = "local only — not enabled here";
  else if (!effectiveModel) skip = "no model set";
  return { effectiveModel, skip };
}

export function isAiTask(v: unknown): v is AiTask {
  return typeof v === "string" && v in TASK_BY_ID;
}
