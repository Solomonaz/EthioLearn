import { db } from "./db";
import { isAiFeatureEnabled } from "./platform-settings";

/**
 * Question bank replenishment.
 *
 * When a chapter's bank cannot cover a requested quiz, generate the shortfall
 * with AI, verify it, dedupe it against what is already stored, and persist it
 * so later quizzes on that chapter serve instantly from Postgres (SRS §4.5.3).
 *
 * Lifted verbatim out of /api/quizzes/generate so teacher-set activities can
 * reuse it. Both callers must share this: two copies of the verify + dedupe
 * rules would drift, and the duplicate threshold is calibrated.
 *
 * Never throws — a replenish failure degrades to "serve what the bank has",
 * exactly as the inline version did.
 */

/** The shape both callers select questions in. */
export interface BankQuestion {
  id: string;
  questionText: string;
  options: unknown;
  type: string;
  difficulty: string;
}

export interface ReplenishOptions {
  /** A chapter id, or "all" for a whole-textbook (cumulative) request. */
  chapterId: string;
  /** Required when chapterId is "all"; otherwise resolved from the chapter. */
  textbookId?: string | null;
  /** How many more questions are needed beyond what the bank holds. */
  needed: number;
  /** EASY | MEDIUM | HARD | MIXED | ADAPTIVE, or undefined. */
  difficulty?: string;
  questionTypes?: string[];
  /** SOLO | TIMED | GROUP. */
  mode?: string;
  /**
   * Ceiling on how many questions one call may generate. Defaults to 15, which
   * is what the student quiz path has always used — a top-up, not a batch.
   * A teacher generating a fresh paper on demand raises it deliberately.
   */
  maxGenerate?: number;
  /**
   * Called as each real stage of the pipeline begins, so a caller can report
   * honest progress. The percentages match the stage markers the shared
   * progress card renders.
   */
  onProgress?: (info: { message: string; percent: number }) => void;
}

/** Default ceiling — unchanged from the inline version this was lifted from. */
const DEFAULT_MAX_GENERATE = 15;

/** Whether any AI provider is configured at all. */
function hasProviderKey(): boolean {
  return Boolean(
    process.env.GEMINI_API_KEY || process.env.GROQ_API_KEY || process.env.NVIDIA_API_KEY,
  );
}

export async function replenishQuestionBank(
  opts: ReplenishOptions,
): Promise<BankQuestion[]> {
  const {
    chapterId,
    textbookId,
    needed,
    difficulty,
    questionTypes,
    mode,
    maxGenerate = DEFAULT_MAX_GENERATE,
    onProgress,
  } = opts;

  if (needed <= 0) return [];

  const canGenerate = (await isAiFeatureEnabled("aiQuizGen")) && hasProviderKey();
  if (!canGenerate) return [];

  try {
    let replenishContent = "";
    let replenishTitle = "";
    let replenishChapterId = typeof chapterId === "string" ? chapterId : "";

    if (chapterId === "all") {
      const firstChapter = await db.chapter.findFirst({
        where: { textbookId: textbookId ?? undefined },
        orderBy: { chapterNumber: "asc" },
        select: { id: true, title: true, content: true },
      });
      if (firstChapter) {
        replenishChapterId = firstChapter.id;
        replenishTitle = firstChapter.title;
        replenishContent = firstChapter.content || "";
      }
    } else {
      const ch = await db.chapter.findUnique({
        where: { id: replenishChapterId },
        select: {
          id: true,
          title: true,
          content: true,
          textbook: { select: { content: true } },
        },
      });
      if (ch) {
        replenishChapterId = ch.id;
        replenishTitle = ch.title;
        replenishContent = ch.content || ch.textbook.content || "";
      }
    }

    if (!replenishContent || replenishContent.length < 100) return [];

    onProgress?.({ message: "Reading the chapter content...", percent: 10 });

    // Ask for a small buffer over the shortfall, capped — verification rejects
    // some, and over-generating burns budget for no gain.
    const neededCount = Math.min(needed + 2, maxGenerate);

    const { generateQuestionsBatched, verifyQuestions, hasBlockingStructuralIssue } =
      await import("@/lib/ai-provider");

    const resolvedTextbookId =
      textbookId ??
      (
        await db.chapter.findUnique({
          where: { id: replenishChapterId },
          select: { textbookId: true },
        })
      )?.textbookId;

    const textbookMeta = resolvedTextbookId
      ? await db.textbook.findUnique({
          where: { id: resolvedTextbookId },
          select: { subject: true, grade: true },
        })
      : null;

    if (!textbookMeta) return [];

    onProgress?.({ message: "Drafting Bloom-aligned questions with AI...", percent: 35 });

    const { questions: rawGen, provider } = await generateQuestionsBatched({
      content: replenishContent.slice(0, 30000),
      chapterTitle: replenishTitle,
      subject: textbookMeta.subject,
      grade: textbookMeta.grade,
      count: neededCount,
      difficulty:
        difficulty === "ADAPTIVE" || !difficulty || difficulty === "MIXED"
          ? "MEDIUM"
          : (difficulty as never),
      questionTypes:
        Array.isArray(questionTypes) && questionTypes.length > 0
          ? (questionTypes as never)
          : (["MCQ"] as never),
      mode: mode === "TIMED" || mode === "GROUP" ? (mode as never) : ("SOLO" as never),
    });

    onProgress?.({
      message: "Cross-checking each question with a second AI solver...",
      percent: 75,
    });

    const verdicts = await verifyQuestions(rawGen, textbookMeta.subject, textbookMeta.grade, {
      avoidProvider: provider,
    });
    const verifiedNew = rawGen.filter(
      (q, idx) => verdicts[idx]?.verdict === "verified" && !hasBlockingStructuralIssue(q),
    );

    if (verifiedNew.length === 0) return [];

    // Cross-generation dedupe against what this chapter already holds.
    const genTexts = verifiedNew.map((q) => q.questionText);
    const existing = await db.question.findMany({
      where: { chapterId: replenishChapterId, questionText: { in: genTexts } },
      select: { questionText: true },
    });
    const existingSet = new Set(existing.map((e) => e.questionText));
    const toInsert = verifiedNew.filter((q) => !existingSet.has(q.questionText));

    if (toInsert.length === 0) return [];

    onProgress?.({ message: "Saving the verified questions...", percent: 90 });

    const created = await Promise.all(
      toInsert.map((q) =>
        db.question.create({
          data: {
            chapterId: replenishChapterId,
            questionText: q.questionText,
            type: q.type as never,
            difficulty: q.difficulty as never,
            options: q.options,
            correctAnswer: q.correctAnswer,
            explanation: q.explanation,
            bloomLevel: (q as { bloomLevel?: string | null }).bloomLevel ?? null,
            qualityScore: 1.0,
            status: "PUBLISHED",
          },
          select: {
            id: true,
            questionText: true,
            options: true,
            type: true,
            difficulty: true,
          },
        }),
      ),
    );

    // Keep the chapter counter in step so daily challenge and chapter badges
    // stay accurate.
    const totalCount = await db.question.count({
      where: { chapterId: replenishChapterId, status: "PUBLISHED" },
    });
    await db.chapter.update({
      where: { id: replenishChapterId },
      data: { questionCount: totalCount },
    });

    return created as BankQuestion[];
  } catch (replenishErr) {
    console.warn("[Question Bank Replenish Error]", replenishErr);
    return [];
  }
}
