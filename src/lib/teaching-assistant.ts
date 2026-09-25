import { geminiChat } from "./gemini";
import { groqChat } from "./groq";
import { nvidiaChat } from "./nvidia";
import { openRouterChat } from "./openrouter";
import { getTaskChain, runStep, type AiProvider } from "./ai-routing";
import type { UsageActor } from "./usage-logger";
import { ASSISTANT_TASKS, type AssistantTask } from "./assistant-tasks";
import { ANSWER_KEY_FENCE } from "./answer-key";

export { ASSISTANT_TASKS };
export type { AssistantTask };

/**
 * AI teaching assistant — open-ended help for a secondary teacher: lesson
 * plans, worksheets, board notes, an explanation to use in class, an exam
 * blueprint, or anything else they type.
 *
 * Output is PLAIN MARKDOWN, never a JSON envelope. The envelope was tried and
 * failed in practice: escaping inflates the payload, and once the token cap is
 * hit the JSON truncates mid-string, so a reply carrying 8000 perfectly good
 * characters parses as nothing at all. Gemini and Groq both failed exactly
 * that way. Plain text degrades gracefully — a capped answer is just shorter.
 *
 * The title is the first Markdown H1, which the prompt asks for.
 *
 * Instructional content stays in English — that is the platform's medium of
 * instruction, and the prompt says so explicitly.
 */

const TASK_BRIEF: Record<AssistantTask, string> = {
  LESSON_PLAN:
    "Write a single-period lesson plan. Include: learning objectives, prior knowledge assumed, a timed sequence of activities, the worked examples the teacher should put on the board, at least two checks for understanding, and a short homework suggestion.",
  WORKSHEET:
    `Write a student worksheet. Number every item. Progress from straightforward to demanding. Then write a line containing exactly ${ANSWER_KEY_FENCE} and nothing else, and AFTER it give the answer key with the working shown, not just the final answers.`,
  // "Workout" means problems worked on paper, not calculations only. Most
  // biology chapters, and some chemistry ones, have nothing to calculate; asked
  // for calculations anyway, the model invented physics dressed as biology
  // (specific heat, Q10, ant walking speeds) for a descriptive chapter.
  WORKOUT: [
    "Write a set of WORKOUT problems: problems the student works through on paper, writing out their working or reasoning in full. A workout problem is NOT necessarily a calculation — match the kind of problem to what the chapter actually teaches:",
    "- Where the textbook excerpts contain calculations (formulas, ratios, worked examples, quantitative methods), write calculation problems using those methods. State the data given and the units expected in the answer.",
    "- Where the chapter is descriptive, write structured written problems instead: explain and justify, compare and contrast (e.g. in a table), apply a concept to a new scenario, interpret given data, a table or a described graph, sequence the stages of a process, draw and label a diagram, or predict an outcome and give the reason.",
    "- A chapter with both gets a mix, in proportion to how much of each it contains. Never force numbers into a descriptive chapter: figures the chapter merely mentions (a litter size, a gestation period, an egg count) are facts to know, not material for an arithmetic problem.",
    "Never bring in a formula, constant or method that is not in the excerpts — in particular never borrow one from another subject (no physics formulas in a biology set). Every problem must need real understanding of this subject; if a problem could be solved by someone who knows only arithmetic, rewrite it. Spread the problems across the chapter's sections and do not reuse the same setup twice.",
    "Number every problem, and give marks for each part. Do NOT write multiple-choice options, do not hint at the answer in the wording (no \"e.g.\" lists of expected points), and do NOT show any answer or working alongside a problem. Progress from straightforward to demanding.",
    `Then write a line containing exactly ${ANSWER_KEY_FENCE} and nothing else. AFTER that line, and only after it, give a full model answer to every problem — worked step by step for calculations, the expected key points for written answers — with a marking guide. Everything before that line is given to students; everything after it is seen only by the teacher, so no answer may appear before it.`,
  ].join("\n"),
  NOTES:
    "Write concise board notes the teacher can copy onto a blackboard or project. Favour short lines, clear headings, and any formulas written out in full. Avoid long paragraphs.",
  EXPLANATION:
    "Explain the concept the way a strong teacher would explain it aloud to this grade. Build from something familiar, give at least two worked examples with the arithmetic shown, and name the mistake students most commonly make.",
  EXAM_BLUEPRINT:
    "Produce an exam blueprint: a table of topics against the number of marks and question types, a difficulty spread, and a note on which topics carry the most weight and why.",
  FREEFORM:
    "Answer the teacher's request directly and practically, in a form they can take straight into a classroom.",
};

export interface AssistantRequest {
  task: AssistantTask;
  /** The teacher's own words. Required for FREEFORM, optional otherwise. */
  prompt: string;
  subject?: string | null;
  grade?: number | null;
  chapterTitle?: string | null;
  /** Textbook content to ground the answer in, already truncated by the caller. */
  chapterContent?: string | null;
  /**
   * Revise an earlier result instead of writing from scratch: the document as
   * it stands, and the change the teacher asked for ("shorter", "add three
   * harder items"). A one-shot tool made teachers start over for every tweak.
   */
  revise?: { previous: string; instruction: string } | null;
  actor?: UsageActor;
  /**
   * Called as the work passes a real stage. Provider fallback is reported
   * honestly: if Gemini fails, the teacher is told that is why it is still
   * going, rather than watching a bar sit still.
   */
  onProgress?: (info: { message: string; percent: number }) => void;
}

export interface AssistantResult {
  title: string;
  markdown: string;
  provider: "gemini" | "groq" | "nvidia" | "openrouter";
}

/**
 * Why every provider failed. Returned rather than swallowed so the route can
 * log something actionable — "the AI failed" with no reason is unfixable.
 */
export interface AssistantFailure {
  failed: true;
  attempts: string[];
}

// Raised from the old JSON-envelope value: prose carries no escaping overhead,
// and a lesson plan grounded in a chapter genuinely needs the room.
const MAX_TOKENS = 4000;
const MAX_CONTENT_CHARS = 16000;
/** Longest earlier result sent back for a revision. */
const MAX_REVISE_CHARS = 16000;

function buildSystem(task: AssistantTask): string {
  return [
    "You are an experienced Ethiopian secondary-school teacher (grades 9-12) helping a colleague prepare for class.",
    "Write everything in English — English is the medium of instruction at this level. Never answer in Amharic.",
    "Stay aligned to the Ethiopian secondary curriculum and to the textbook content you are given.",
    "Be concrete and immediately usable: real worked examples with real numbers, not placeholders.",
    "The textbook content you are given is a set of EXCERPTS chosen from the chapter, not the whole chapter.",
    "Never tell the teacher that the textbook or chapter does not cover something — you have not seen all of it. Where the excerpts are silent, teach it from the Ethiopian curriculum for this grade.",
    "",
    // Anything a teacher might hand to a class must have its teacher-only
    // parts fenced off: "Give to class" sends everything above the fence to
    // students, and a worksheet once went out with its full answer key.
    `Anything meant ONLY for the teacher — answer keys, worked solutions, marking guides, notes to the teacher — goes after a line containing exactly ${ANSWER_KEY_FENCE}, never before it. Everything before that line must be safe to give to students.`,
    "",
    "Reply in Markdown. Begin with a single H1 line giving a short title, then the answer.",
    "Use headings, lists and tables. Do not wrap the answer in JSON or in code fences.",
    "Keep it tight enough to finish — an answer that stops mid-sentence is worse than a shorter complete one.",
    "",
    "FORMATTING RULES — follow these exactly:",
    "• Never write raw HTML. <br> in particular is not allowed anywhere.",
    "• A Markdown table cell cannot hold a line break. If a cell needs several points, separate them with a semicolon, or move them out of the table into a list.",
    "• Keep table cells short. Prose belongs under the table, not inside it.",
    "• Write mathematics in LaTeX: $...$ inline, $$...$$ on its own line for display.",
    "• Use LaTeX ONLY for real mathematics. Plain numbers, percentages and units are plain text: write 18.0 g, 11.2%, 0.30 m/s — never wrap a bare quantity or a percentage in maths delimiters.",
    "• Be consistent: do not switch between LaTeX and plain text for the same kind of quantity.",
    "• Write temperatures as plain text with the degree sign: 37.0 °C. Never put ^ or \\circ inside \\text{} — that does not render.",
    // Curriculum documents are reused for other teachers of the same subject
    // and grade (lib/teacher-library), so nothing in them may point at one
    // classroom. "Anything else" is never reused and may be personal (a letter
    // to a named parent), so it keeps names.
    ...(task === "FREEFORM"
      ? []
      : [
          "• Never include the name of a teacher, student, school or town, even if the request mentions one — write for any class of this grade.",
        ]),
  ].join("\n");
}

function buildPrompt(req: AssistantRequest): string {
  const parts: string[] = [];

  const context: string[] = [];
  if (req.subject) context.push(`Subject: ${req.subject}`);
  if (req.grade) context.push(`Grade: ${req.grade}`);
  if (req.chapterTitle) context.push(`Chapter: ${req.chapterTitle}`);
  if (context.length > 0) parts.push(context.join("\n"));

  parts.push(`TASK\n${TASK_BRIEF[req.task]}`);

  if (req.prompt.trim()) {
    parts.push(`WHAT THE TEACHER ASKED FOR\n${req.prompt.trim()}`);
  }

  if (req.chapterContent && req.chapterContent.trim().length >= 100) {
    parts.push(
      `TEXTBOOK EXCERPTS (ground your answer in these)\n${req.chapterContent.slice(0, MAX_CONTENT_CHARS)}`,
    );
  }

  if (req.revise) {
    parts.push(
      `CURRENT DOCUMENT\n${req.revise.previous.slice(0, MAX_REVISE_CHARS)}`,
      `CHANGE REQUESTED\n${req.revise.instruction}\n\n` +
        "Rewrite the WHOLE document with that change applied. Keep everything the teacher did not ask to change, " +
        "keep the same title line unless the change is to the title, and keep the answer-key fence rule.",
    );
  }

  return parts.join("\n\n");
}

/** Shortest reply worth showing; below this the generation clearly failed. */
const MIN_USEFUL_CHARS = 40;

/**
 * Split the leading H1 off as the title and keep the rest as the body. A reply
 * with no H1 is still perfectly usable — it just gets a fallback title. Nothing
 * here can fail on a truncated answer, which is the whole point.
 */
function parseReply(raw: string | null): { title: string; markdown: string } | null {
  if (!raw) return null;

  // Some models still fence prose despite being asked not to.
  let text = raw.trim();
  const fenced = text.match(/^```(?:markdown|md)?\s*\n([\s\S]*?)```\s*$/);
  if (fenced) text = fenced[1].trim();

  if (text.length < MIN_USEFUL_CHARS) return null;

  const lines = text.split("\n");
  const firstNonEmpty = lines.findIndex((l) => l.trim().length > 0);
  let title = "";
  if (firstNonEmpty !== -1) {
    const heading = lines[firstNonEmpty].trim().match(/^#\s+(.+)$/);
    if (heading) {
      title = heading[1].trim().slice(0, 120);
      lines.splice(0, firstNonEmpty + 1);
      text = lines.join("\n").trim();
    }
  }

  return { title: title || "Your answer", markdown: text };
}

/**
 * Provider order and models come from the "teacher-assistant" route (Admin ->
 * AI Models). Default Gemini → Groq → NVIDIA: Gemini leads because this is long-form written work
 * where quality matters more than the latency the tutor optimises for, and the
 * teacher is already waiting on a deliberate action. Every provider falls
 * through on any error or unusable reply.
 */
export async function askTeachingAssistant(
  req: AssistantRequest,
): Promise<AssistantResult | AssistantFailure> {
  const system = buildSystem(req.task);
  const prompt = buildPrompt(req);
  const opts = {
    system,
    temperature: 0.6,
    maxTokens: MAX_TOKENS,
    feature: "teacher-assistant" as const,
    actor: req.actor,
  };

  // Each provider is asked for PROSE, not JSON — see the note at the top of
  // this file for why that distinction is load-bearing here.
  const impl: Partial<Record<AiProvider, () => Promise<string | null>>> = {
    GEMINI: () => geminiChat(prompt, { ...opts, plainText: true }),
    GROQ: () => groqChat(prompt, { ...opts, responseFormat: { type: "text" } }),
    NVIDIA: () => nvidiaChat(prompt, { ...opts, jsonMode: false }),
    OPENROUTER: () => openRouterChat(prompt, { ...opts, jsonMode: false }),
  };
  const providers = (await getTaskChain("teacher-assistant"))
    .filter((s) => impl[s.provider])
    .map((s) => ({
      name: s.name as AssistantResult["provider"],
      call: () => runStep(s, impl[s.provider]!),
    }));

  const attempts: string[] = [];
  const report = req.onProgress ?? (() => {});

  // The first provider gets the widest slice of the bar, because it is the one
  // that usually answers. A fallback then advances rather than restarting, so
  // the bar only ever moves forward.
  const PROVIDER_AT = [25, 50, 70];

  for (let i = 0; i < providers.length; i++) {
    const provider = providers[i];
    report({
      message:
        i === 0
          ? "Writing with AI..."
          : `${providers[i - 1].name} did not answer — trying ${provider.name}...`,
      percent: PROVIDER_AT[i] ?? 70,
    });

    try {
      const raw = await provider.call();
      if (raw === null) {
        // A null means that provider is simply not configured.
        attempts.push(`${provider.name}: no key or request rejected`);
        continue;
      }
      report({ message: "Formatting the document...", percent: 88 });
      const parsed = parseReply(raw);
      if (parsed) return { ...parsed, provider: provider.name };
      attempts.push(`${provider.name}: reply too short to use (${raw.length} chars)`);
    } catch (err) {
      attempts.push(
        `${provider.name}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  console.warn("[Teaching Assistant] all providers failed:", attempts.join(" | "));
  return { failed: true, attempts };
}
