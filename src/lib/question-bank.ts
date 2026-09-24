import { db } from "./db";
import { isAiFeatureEnabled } from "./platform-settings";
import { selectGenerationContent } from "./generation-content";
import {
  avoidList,
  generationRunIndex,
  recentChapterQuestions,
} from "./question-dedupe";
import { markChapterSaturated, roundShowsSaturation } from "./quiz-selection";

/**
 * Question bank replenishment.
 *
 * Generates new questions for a chapter, runs them through the full quality
 * pipeline (the same one student AI quizzes and admin generation use), and
 * persists the ones that pass so later requests serve them from Postgres.
 *
 * Used by teacher activities when the teacher picks "Brand-new questions".
 * The student "Question Bank" source no longer calls this — it is the free
 * source and never generates.
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
    // OpenRouter included: it serves the default question generator.
    process.env.OPENROUTER_API_KEY ||
      process.env.GEMINI_API_KEY ||
      process.env.GROQ_API_KEY ||
      process.env.NVIDIA_API_KEY,
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

    // ~20% buffer over the shortfall, as the student flow uses — review drops
    // some, and over-generating burns budget for no gain.
    const neededCount = Math.min(needed + Math.max(1, Math.ceil(needed * 0.2)), maxGenerate);

    const {
      generateQuestionsBatched,
      runQualityPipeline,
      passesAutoServe,
      generationContentBudget,
    } = await import("@/lib/ai-provider");

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

    // Read a different part of the chapter on each top-up (it used to send
    // the same opening 30,000 characters every time), and tell the model what
    // the chapter already has. See lib/question-dedupe.
    const [runIndex, chapterBank] = await Promise.all([
      generationRunIndex(replenishChapterId),
      recentChapterQuestions(replenishChapterId),
    ]);
    const selected = await selectGenerationContent({
      chapterId: replenishChapterId,
      fallbackContent: replenishContent,
      budgetChars: generationContentBudget(neededCount, replenishContent.length),
      rotation: runIndex,
    });

    // The SAME full pipeline as student AI quizzes and admin generation —
    // blind verifier, quality checks (facts, distractors, scope, wording),
    // factual tie-break, duplicate and relevance checks — and the same rule
    // for what may reach students unreviewed (passesAutoServe). This path used
    // to run only the verifier and a near-duplicate check, so a question with
    // a giveaway distractor or an out-of-chapter formula went straight onto a
    // teacher's paper.
    type Gen = Awaited<ReturnType<typeof generateQuestionsBatched>>["questions"][number];
    const accepted: { q: Gen; score: number }[] = [];
    const droppedTexts: string[] = [];
    const MAX_ROUNDS = 2; // first attempt + one refill
    const genDifficulty =
      difficulty === "ADAPTIVE" || !difficulty || difficulty === "MIXED" ? "MEDIUM" : (difficulty as never);
    const genTypes =
      Array.isArray(questionTypes) && questionTypes.length > 0 ? (questionTypes as never) : (["MCQ"] as never);

    for (let round = 0; round < MAX_ROUNDS && accepted.length < needed; round++) {
      const ask =
        round === 0 ? neededCount : Math.min(needed - accepted.length + 2, maxGenerate);
      onProgress?.({
        message:
          round === 0
            ? "Drafting Bloom-aligned questions with AI..."
            : "Replacing questions that failed the quality checks...",
        percent: round === 0 ? 35 : 80,
      });

      const { questions: rawGen, provider, model } = await generateQuestionsBatched({
        avoidQuestions: avoidList([
          ...accepted.map((a) => a.q.questionText).reverse(),
          ...droppedTexts.slice().reverse(),
          ...chapterBank.map((q) => q.questionText),
        ]),
        content: selected.content,
        chapterTitle: replenishTitle,
        subject: textbookMeta.subject,
        grade: textbookMeta.grade,
        count: ask,
        difficulty: genDifficulty,
        questionTypes: genTypes,
        mode: mode === "TIMED" || mode === "GROUP" ? (mode as never) : ("SOLO" as never),
        variantSeed: runIndex + round * 7,
        refill: round > 0,
      });

      onProgress?.({
        message: "Checking every question: blind re-solve, facts, difficulty and scope...",
        percent: round === 0 ? 65 : 85,
      });

      const { results } = await runQualityPipeline(
        rawGen,
        selected.content,
        textbookMeta.subject,
        textbookMeta.grade,
        provider,
        // Accepted this run + the chapter's bank, so repeats of either are caught.
        [
          ...accepted.map((a) => a.q).reverse(),
          ...chapterBank.map((b) => ({ questionText: b.questionText, correctAnswer: b.correctAnswer })),
        ],
        model,
      );

      rawGen.forEach((q, i) => {
        if (passesAutoServe(q, results[i])) {
          if (accepted.length < needed) accepted.push({ q, score: results[i].qualityScore });
        } else {
          droppedTexts.push(q.questionText);
        }
      });
      console.log(
        `[Question Bank] Round ${round + 1}: ${rawGen.length} generated, ${accepted.length}/${needed} passed every check.`,
      );

      // Mostly repeats of the bank: this chapter has run out of new material.
      const repeats = results.filter((r) => r.flags.includes("DUPLICATE_EXISTING")).length;
      if (chapterId !== "all" && roundShowsSaturation(rawGen.length, repeats)) {
        await markChapterSaturated(replenishChapterId);
        console.log(`[Question Bank] Chapter saturated — ${repeats}/${rawGen.length} repeated the bank.`);
        break;
      }
    }

    const toInsert = accepted.map((a) => a.q);
    const scoreByText = new Map(accepted.map((a) => [a.q.questionText, a.score]));
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
            // The pipeline's own score, not a blanket 1.0.
            qualityScore: scoreByText.get(q.questionText) ?? 1.0,
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
