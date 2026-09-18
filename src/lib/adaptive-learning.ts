import { db } from "./db";
import { Difficulty } from "@prisma/client";

// ─── Types ────────────────────────────────────────────────

export interface AdaptiveContext {
  chapterId?: string | null;
  textbookId?: string | null;
  subject?: string | null;
}

export interface AdaptiveInsights {
  /** The calibrated difficulty recommendation */
  difficulty: Difficulty;
  /** Number of quizzes or topic items used in the analysis */
  quizzesAnalyzed: number;
  /** Weighted or topic accuracy 0–1 */
  weightedAccuracy: number;
  /** Human-readable explanation of why this difficulty was chosen */
  reasoning: string;
  /** Trend direction based on recent vs previous performance */
  trend: "improving" | "declining" | "stable";
  /** Granularity scope of the calibration */
  scope?: "chapter" | "subject" | "global" | "baseline";
  /** Estimated latent ability (Item Response Theory theta) */
  theta?: number;
}

// ─── IRT Ability Calculator ──────────────────────────────

interface ItemResponse {
  isCorrect: boolean;
  question: {
    difficulty: Difficulty | string;
    bloomLevel?: string | null;
  } | null;
}

const DIFFICULTY_WEIGHTS: Record<string, number> = {
  EASY: -1.0,
  MEDIUM: 0.0,
  HARD: 1.0,
};

/**
 * Computes Rasch / 1PL IRT latent ability estimate (theta).
 *   theta = ln((correct + 0.5) / (incorrect + 0.5)) + mean(b)
 */
function estimateIrtAbility(items: ItemResponse[]): {
  theta: number;
  accuracy: number;
  difficulty: Difficulty;
  trend: "improving" | "declining" | "stable";
} {
  const n = items.length;
  if (n === 0) {
    return { theta: 0, accuracy: 0.5, difficulty: "MEDIUM", trend: "stable" };
  }

  let correctCount = 0;
  let bSum = 0;

  for (const item of items) {
    if (item.isCorrect) correctCount++;
    const diffKey = String(item.question?.difficulty ?? "MEDIUM").toUpperCase();
    bSum += DIFFICULTY_WEIGHTS[diffKey] ?? 0.0;
  }

  const accuracy = correctCount / n;
  const meanB = bSum / n;
  const incorrectCount = n - correctCount;

  // Empirical logit estimate with Haldane-Anscombe 0.5 smoothing
  const theta = Math.log((correctCount + 0.5) / (incorrectCount + 0.5)) + meanB;

  // Calibrate difficulty based on Zone of Proximal Development (ZPD)
  let difficulty: Difficulty;
  if (theta >= 0.75) {
    difficulty = "HARD";
  } else if (theta <= -0.40) {
    difficulty = "EASY";
  } else {
    difficulty = "MEDIUM";
  }

  // Trend detection: compare newest half (items are ordered desc) vs older half
  let trend: "improving" | "declining" | "stable" = "stable";
  if (n >= 6) {
    const half = Math.floor(n / 2);
    const recentAcc =
      items.slice(0, half).filter((i) => i.isCorrect).length / half;
    const olderAcc =
      items.slice(half).filter((i) => i.isCorrect).length / (n - half);
    const diff = recentAcc - olderAcc;
    if (diff > 0.08) trend = "improving";
    else if (diff < -0.08) trend = "declining";
  }

  return { theta, accuracy, difficulty, trend };
}

// ─── Core Engine ─────────────────────────────────────────

/**
 * Enhanced Topic-Level Adaptive Learning Engine (IRT / BKT) — §4.4.4
 *
 * Evaluates student knowledge hierarchically:
 *   1. Chapter Level: Past question attempts for the specific chapter.
 *   2. Subject Level: Past question attempts across the same subject curriculum.
 *   3. Global Level: Overall quiz history with exponential decay weighting.
 *   4. Baseline: Fallback for new students with no history.
 */
export async function getAdaptiveDifficultyInsights(
  userId: string,
  context?: AdaptiveContext
): Promise<AdaptiveInsights> {
  try {
    const chapterId = context?.chapterId && context.chapterId !== "all" ? context.chapterId : null;

    // ── 1. Chapter-Level Knowledge Tracing ─────────────────
    if (chapterId) {
      const [chapterInfo, chapterAnswers] = await Promise.all([
        db.chapter.findUnique({
          where: { id: chapterId },
          select: {
            title: true,
            textbook: { select: { subject: true, grade: true } },
          },
        }),
        db.quizAnswer.findMany({
          where: {
            quiz: { studentId: userId, completedAt: { not: null } },
            question: { chapterId },
          },
          select: {
            isCorrect: true,
            question: {
              select: {
                difficulty: true,
                bloomLevel: true,
              },
            },
          },
          orderBy: { quiz: { completedAt: "desc" } },
          take: 30,
        }),
      ]);

      if (chapterAnswers.length >= 4) {
        const { theta, accuracy, difficulty, trend } =
          estimateIrtAbility(chapterAnswers);
        const pct = Math.round(accuracy * 100);
        const chapterTitle = chapterInfo?.title || "this chapter";

        let reasoning: string;
        if (difficulty === "HARD") {
          reasoning =
            trend === "improving"
              ? `You have demonstrated mastery in "${chapterTitle}" (${pct}% accuracy, trending up)! Hard mode unlocked to challenge you further. 🔥`
              : `Strong foundation in "${chapterTitle}" with ${pct}% accuracy. Delivering Hard questions to test higher-order thinking.`;
        } else if (difficulty === "MEDIUM") {
          reasoning =
            trend === "improving"
              ? `Solid progress in "${chapterTitle}" (${pct}% accuracy). Medium difficulty keeps your learning curve steady.`
              : `Your chapter accuracy is ${pct}%. Medium questions will help you reinforce core concepts.`;
        } else {
          reasoning =
            trend === "improving"
              ? `Accuracy in "${chapterTitle}" is ${pct}% and improving. Easy questions will build your confidence on fundamentals.`
              : `You scored ${pct}% in "${chapterTitle}". Easy mode selected to strengthen fundamental knowledge before advancing.`;
        }

        return {
          difficulty,
          quizzesAnalyzed: chapterAnswers.length,
          weightedAccuracy: accuracy,
          reasoning,
          trend,
          scope: "chapter",
          theta,
        };
      }
    }

    // ── 2. Subject-Level Knowledge Tracing ─────────────────
    const textbookId = context?.textbookId;
    let subjectName = context?.subject;

    if (!subjectName && textbookId) {
      const tb = await db.textbook.findUnique({
        where: { id: textbookId },
        select: { subject: true },
      });
      if (tb) subjectName = tb.subject;
    }

    if (subjectName || textbookId) {
      const whereQuestion: any = {};
      if (textbookId) {
        whereQuestion.chapter = { textbookId };
      } else if (subjectName) {
        whereQuestion.chapter = { textbook: { subject: subjectName } };
      }

      const subjectAnswers = await db.quizAnswer.findMany({
        where: {
          quiz: { studentId: userId, completedAt: { not: null } },
          question: whereQuestion,
        },
        select: {
          isCorrect: true,
          question: {
            select: {
              difficulty: true,
              bloomLevel: true,
            },
          },
        },
        orderBy: { quiz: { completedAt: "desc" } },
        take: 40,
      });

      if (subjectAnswers.length >= 5) {
        const { theta, accuracy, difficulty, trend } =
          estimateIrtAbility(subjectAnswers);
        const pct = Math.round(accuracy * 100);
        const subjectLabel = subjectName || "this subject";

        const reasoning =
          difficulty === "HARD"
            ? `Your overall performance in ${subjectLabel} is strong (${pct}% accuracy across ${subjectAnswers.length} questions). Calibrated to Hard.`
            : difficulty === "MEDIUM"
            ? `Based on your ${subjectLabel} track record (${pct}% accuracy), Medium difficulty is your current Zone of Proximal Development.`
            : `Your ${subjectLabel} accuracy is ${pct}%. Easy mode will help solidify key concepts for this new chapter.`;

        return {
          difficulty,
          quizzesAnalyzed: subjectAnswers.length,
          weightedAccuracy: accuracy,
          reasoning,
          trend,
          scope: "subject",
          theta,
        };
      }
    }

    // ── 3. Global Quiz History (Exponential Decay) ────────
    const quizzes = await db.quiz.findMany({
      where: {
        studentId: userId,
        completedAt: { not: null },
        totalQuestions: { gt: 0 },
      },
      orderBy: { completedAt: "desc" },
      take: 10,
      select: {
        correctAnswers: true,
        totalQuestions: true,
      },
    });

    if (quizzes.length === 0) {
      return {
        difficulty: "MEDIUM",
        quizzesAnalyzed: 0,
        weightedAccuracy: 0.5,
        reasoning:
          "No quiz history yet for this topic. Starting you on Medium to calibrate your baseline.",
        trend: "stable",
        scope: "baseline",
      };
    }

    const DECAY = 0.8;
    let weightedSum = 0;
    let weightTotal = 0;

    for (let i = 0; i < quizzes.length; i++) {
      const accuracy = quizzes[i].correctAnswers / quizzes[i].totalQuestions;
      const weight = Math.pow(DECAY, i);
      weightedSum += accuracy * weight;
      weightTotal += weight;
    }

    const weightedAccuracy = weightTotal > 0 ? weightedSum / weightTotal : 0.5;
    const pct = Math.round(weightedAccuracy * 100);

    const recentScores = quizzes
      .slice(0, 3)
      .map((q) => q.correctAnswers / q.totalQuestions);
    const olderScores = quizzes
      .slice(3)
      .map((q) => q.correctAnswers / q.totalQuestions);

    let trend: AdaptiveInsights["trend"] = "stable";
    if (recentScores.length > 0 && olderScores.length > 0) {
      const recentMean =
        recentScores.reduce((a, b) => a + b, 0) / recentScores.length;
      const olderMean =
        olderScores.reduce((a, b) => a + b, 0) / olderScores.length;
      const delta = recentMean - olderMean;
      if (delta > 0.06) trend = "improving";
      else if (delta < -0.06) trend = "declining";
    }

    let difficulty: Difficulty;
    let reasoning: string;

    if (weightedAccuracy >= 0.82) {
      difficulty = "HARD";
      reasoning =
        trend === "improving"
          ? `Overall accuracy is ${pct}% and improving. Hard mode unlocked. 🔥`
          : `Consistently scoring ${pct}% across your study sessions. Calibrated to Hard.`;
    } else if (weightedAccuracy >= 0.55) {
      difficulty = "MEDIUM";
      reasoning =
        trend === "improving"
          ? `Great general progress (${pct}% accuracy). Medium keeps the momentum going.`
          : `Solid overall performance at ${pct}%. Medium difficulty is your current baseline.`;
    } else {
      difficulty = "EASY";
      reasoning = `Overall accuracy is ${pct}%. Easy mode will help solidify fundamentals before stepping up.`;
    }

    return {
      difficulty,
      quizzesAnalyzed: quizzes.length,
      weightedAccuracy,
      reasoning,
      trend,
      scope: "global",
    };
  } catch (error) {
    console.error("[Adaptive Engine Error]", error);
    return {
      difficulty: "MEDIUM",
      quizzesAnalyzed: 0,
      weightedAccuracy: 0.5,
      reasoning: "Calibration unavailable. Defaulting to Medium difficulty.",
      trend: "stable",
      scope: "baseline",
    };
  }
}

/**
 * Returns the recommended Difficulty enum value with optional topic context.
 */
export async function getRecommendedDifficulty(
  userId: string,
  context?: AdaptiveContext
): Promise<Difficulty> {
  const insights = await getAdaptiveDifficultyInsights(userId, context);
  return insights.difficulty;
}
