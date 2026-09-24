import { db } from "./db";
import { subjectFilter } from "./subject";
import { generateEmbeddings, cosineSimilarity } from "./embeddings";
import type { UsageActor } from "./usage-logger";

/**
 * Teachers' AI material: every result is stored, and — invisibly — reused.
 *
 * The same bank-first rule as student quizzes (lib/quiz-selection): before
 * paying for a new document, look for one another teacher of the same subject
 * and grade (any school, any section — the national textbook is the same
 * everywhere) already generated for the same request, which THIS teacher has
 * not had. If there is one, it is served as theirs, instantly and for free;
 * only when there is none is the AI called, and the new document joins the
 * bank for the next teacher. Teachers never see any of this: their Materials
 * holds only what they received, as their own.
 *
 * A match must be exact on the request (task, chapter(s), and for workout
 * activities the problem count and difficulty) AND close on the teacher's own
 * instructions — by meaning and by topic words. A missed match only costs
 * money; a wrong one hands a teacher the wrong material, so ties go to
 * generating fresh.
 *
 * Never reused: "Anything else" (it can be personal — a letter to a parent),
 * revised documents (tailored to their author), and served copies (the
 * original is the one in the bank).
 */

export type ResourceSource = "ASSISTANT" | "WORKOUT_ACTIVITY";

/**
 * Meaning similarity a pair of instructions must reach. Calibrated on Gemini
 * embeddings (2026-09-25): same requests scored 0.907-0.956, different ones
 * 0.823-0.894 — except named siblings ("Boyle's law" / "Charles's law" 0.922),
 * which is what the topic-word check below is for.
 */
const MIN_SIMILARITY = 0.9;
/** Share of the smaller instruction's topic words the other must contain. */
const MIN_TOPIC_OVERLAP = 0.6;
/** Candidates examined per request — one chapter's worth of one task. */
const MAX_CANDIDATES = 200;

/** Whether a task's results may be reused at all. */
export function isReusableTask(task: string): boolean {
  return task !== "FREEFORM";
}

// ── Topic words ─────────────────────────────────────────────────────────

/** Words that say what KIND of thing is wanted, not what it is about. */
const GENERIC = new Set([
  "a", "an", "the", "and", "or", "of", "on", "in", "to", "for", "with", "about", "at", "by", "from",
  "is", "are", "be", "it", "its", "that", "this", "these", "those", "my", "our", "their", "some", "each",
  "please", "make", "write", "create", "give", "include", "use", "using", "add", "want", "need",
  "worksheet", "lesson", "plan", "question", "item", "problem", "exercise", "activity", "note", "board",
  "task", "set", "paper", "list", "short", "brief", "briefly", "compare", "comparison", "focus",
  "student", "class", "grade", "teacher", "unit", "chapter", "topic",
]);

function stem(word: string): string {
  let w = word.replace(/'s$/, "");
  for (const suffix of ["ations", "ation", "ings", "ing", "ies", "es", "s", "ed"]) {
    if (w.endsWith(suffix) && w.length - suffix.length >= 3) {
      w = w.slice(0, -suffix.length);
      break;
    }
  }
  return w;
}

/** The words that say what the request is ABOUT. */
export function topicWords(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .replace(/[^\p{L}\p{N}'\s]/gu, " ")
      .split(/\s+/)
      .filter(Boolean)
      .map(stem)
      .filter((w) => !GENERIC.has(w) && w.length > 1),
  );
}

/** Share of the smaller set found in the larger; 1 when both are empty. */
function topicOverlap(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 1;
  if (a.size === 0 || b.size === 0) return 0;
  const [small, large] = a.size <= b.size ? [a, b] : [b, a];
  let hit = 0;
  for (const w of small) if (large.has(w)) hit++;
  return hit / small.size;
}

/** Normalised instructions: trimmed, whitespace collapsed; "" when none. */
export function normaliseInstructions(text: string | null | undefined): string {
  return (text ?? "").trim().replace(/\s+/g, " ").slice(0, 2000);
}

// ── Embedding ───────────────────────────────────────────────────────────

export interface InstructionVector {
  vector: number[];
  model: string;
}

/** Embed a request's instructions — null when there are none or it fails. */
export async function embedInstructions(
  instructions: string,
  actor?: UsageActor,
): Promise<InstructionVector | null> {
  if (!instructions) return null;
  try {
    const [r] = await generateEmbeddings([instructions], "RETRIEVAL_DOCUMENT", {
      feature: "embedding-query",
      actor,
    });
    return r ? { vector: r.embedding, model: r.provider } : null;
  } catch {
    return null;
  }
}

// ── Find ────────────────────────────────────────────────────────────────

export interface ReuseRequest {
  teacherId: string;
  task: string;
  subject: string | null;
  grade: number | null;
  requestKey: string;
  instructions: string;
  /** Pre-computed, so the same vector is stored with a fresh result. */
  embedding: InstructionVector | null;
}

/**
 * A stored original matching this request that this teacher has not had, or
 * null. Among matches: kept-by-author first (its author read it and chose to
 * keep it), then the closest instructions, then the newest.
 */
export async function findReusable(
  req: ReuseRequest,
): Promise<{ id: string; title: string; body: string } | null> {
  if (!isReusableTask(req.task) || !req.subject || req.grade === null) return null;

  const candidates = await db.teacherResource.findMany({
    where: {
      reusable: true,
      originId: null,
      teacherId: { not: req.teacherId },
      task: req.task,
      grade: req.grade,
      subject: subjectFilter(req.subject),
      requestKey: req.requestKey,
    },
    orderBy: { createdAt: "desc" },
    take: MAX_CANDIDATES,
    select: {
      id: true,
      title: true,
      body: true,
      kept: true,
      instructions: true,
      instructionsEmbedding: true,
      embeddingModel: true,
    },
  });
  if (candidates.length === 0) return null;

  // Never the same document twice: drop what this teacher already received.
  const received = await db.teacherResource.findMany({
    where: { teacherId: req.teacherId, originId: { in: candidates.map((c) => c.id) } },
    select: { originId: true },
  });
  const had = new Set(received.map((r) => r.originId));
  const unseen = candidates.filter((c) => !had.has(c.id));
  if (unseen.length === 0) return null;

  const words = topicWords(req.instructions);
  const scored = unseen
    .map((c) => {
      const theirs = c.instructions ?? "";
      // No instructions on either side: the request IS the task + chapter.
      if (!req.instructions || !theirs) {
        return { c, score: !req.instructions && !theirs ? 1 : -1 };
      }
      if (topicOverlap(words, topicWords(theirs)) < MIN_TOPIC_OVERLAP) return { c, score: -1 };
      // Vectors from different models, or of different sizes, can't be compared.
      if (
        !req.embedding ||
        c.embeddingModel !== req.embedding.model ||
        c.instructionsEmbedding.length !== req.embedding.vector.length
      ) {
        return { c, score: normaliseInstructions(theirs).toLowerCase() === req.instructions.toLowerCase() ? 1 : -1 };
      }
      return { c, score: cosineSimilarity(req.embedding.vector, c.instructionsEmbedding) };
    })
    .filter((s) => s.score >= MIN_SIMILARITY);
  if (scored.length === 0) return null;

  scored.sort((a, b) => Number(b.c.kept) - Number(a.c.kept) || b.score - a.score);
  const best = scored[0].c;
  return { id: best.id, title: best.title, body: best.body };
}

// ── Store ───────────────────────────────────────────────────────────────

/** Store a result. Never throws: losing the copy must not fail the request. */
export async function storeResource(data: {
  teacherId: string;
  task: string;
  title: string;
  body: string;
  subject: string | null;
  grade: number | null;
  chapterTitle: string | null;
  source: ResourceSource;
  requestKey: string | null;
  instructions: string;
  embedding: InstructionVector | null;
  /** Set when this is a copy served from the bank. */
  originId?: string | null;
}): Promise<string | null> {
  try {
    const isCopy = Boolean(data.originId);
    const row = await db.teacherResource.create({
      data: {
        teacherId: data.teacherId,
        task: data.task,
        title: data.title.slice(0, 160),
        body: data.body,
        subject: data.subject,
        grade: data.grade,
        chapterTitle: data.chapterTitle?.slice(0, 200) ?? null,
        source: data.source,
        requestKey: data.requestKey,
        instructions: data.instructions || null,
        instructionsEmbedding: data.embedding?.vector ?? [],
        embeddingModel: data.embedding?.model ?? null,
        originId: data.originId ?? null,
        // Only originals of curriculum work, with an audience, join the bank.
        reusable:
          !isCopy &&
          isReusableTask(data.task) &&
          Boolean(data.subject) &&
          data.grade !== null &&
          Boolean(data.requestKey),
      },
      select: { id: true },
    });
    return row.id;
  } catch (err) {
    console.warn("[Teacher library] Could not store a result:", err instanceof Error ? err.message : err);
    return null;
  }
}

/**
 * Serve a request from the bank when possible. Returns the teacher's own copy
 * of a matching original (stored in their Materials like anything else), or
 * null when the AI has to write it.
 */
export async function serveFromBank(
  req: ReuseRequest & { chapterTitle: string | null; source: ResourceSource },
): Promise<{ title: string; body: string; resourceId: string | null } | null> {
  try {
    const match = await findReusable(req);
    if (!match) return null;
    const resourceId = await storeResource({
      teacherId: req.teacherId,
      task: req.task,
      title: match.title,
      body: match.body,
      subject: req.subject,
      grade: req.grade,
      chapterTitle: req.chapterTitle,
      source: req.source,
      requestKey: req.requestKey,
      instructions: req.instructions,
      embedding: req.embedding,
      originId: match.id,
    });
    console.log(`[Teacher library] Served ${req.task} from the bank (${match.id}) — no AI call.`);
    return { title: match.title, body: match.body, resourceId };
  } catch (err) {
    // A failed lookup must never block the teacher: fall through to the AI.
    console.warn("[Teacher library] Bank lookup failed:", err instanceof Error ? err.message : err);
    return null;
  }
}
