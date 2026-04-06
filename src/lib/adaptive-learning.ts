import { db } from "./db";
import { Difficulty } from "@prisma/client";

// ─── Types ────────────────────────────────────────────────

export interface AdaptiveInsights {
  /** The calibrated difficulty recommendation */
  difficulty: Difficulty;
  /** Number of quizzes used in the analysis */
  quizzesAnalyzed: number;
  /** Weighted accuracy 0–1 (recent quizzes carry more weight) */
  weightedAccuracy: number;
  /** Human-readable explanation of why this difficulty was chosen */
  reasoning: string;
  /** Trend direction based on last 3 vs previous quizzes */
  trend: "improving" | "declining" | "stable";
}

// ─── Core engine ─────────────────────────────────────────

/**
 * Enhanced Adaptive Learning Engine.
 *
 * Analyses up to the last 10 completed quizzes with exponential decay weighting
 * so that recent performance counts more than older quizzes.
 *
 *   weight[i] = DECAY^i   (i=0 is the most recent quiz)
 *   DECAY = 0.80 → each quiz is worth 80% of the one before it
 *
 * Thresholds (weighted accuracy):
 *   ≥ 0.82  → HARD   (consistently high performer, ready to push limits)
 *   ≥ 0.55  → MEDIUM (solid middle ground)
 *   < 0.55  → EASY   (needs consolidation before advancing)
 *
 * Trend detection compares the mean of the 3 newest quizzes vs. the rest.
 */
export async function getAdaptiveDifficultyInsights(
  userId: string
): Promise<AdaptiveInsights> {
  try {
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
          "No quiz history yet. Starting you on Medium to find your baseline.",
        trend: "stable",
      };
    }

    // ── Weighted accuracy (exponential decay) ─────────────
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

    // ── Trend detection ───────────────────────────────────
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

    // ── Difficulty decision ───────────────────────────────
    let difficulty: Difficulty;
    let reasoning: string;

    if (weightedAccuracy >= 0.82) {
      difficulty = "HARD";
      reasoning =
        trend === "improving"
          ? `You're on fire! Your accuracy is ${pct}% and improving — Hard mode unlocked. 🔥`
          : `You're consistently scoring ${pct}%. Time to push further with Hard questions.`;
    } else if (weightedAccuracy >= 0.55) {
      difficulty = "MEDIUM";
      reasoning =
        trend === "improving"
          ? `Great progress! Accuracy ${pct}% and climbing — Medium keeps the momentum going.`
          : trend === "declining"
          ? `Your accuracy is ${pct}% — Medium will help you stabilise before advancing.`
          : `Solid performance at ${pct}%. Medium difficulty is your sweet spot right now.`;
    } else {
      difficulty = "EASY";
      reasoning =
        trend === "improving"
          ? `You're improving (${pct}%) — Easy questions will build your confidence further.`
          : `Your accuracy is ${pct}%. Easy mode will help solidify the fundamentals. Keep going!`;
    }

    return {
      difficulty,
      quizzesAnalyzed: quizzes.length,
      weightedAccuracy,
      reasoning,
      trend,
    };
  } catch (error) {
    console.error("[Adaptive Engine Error]", error);
    return {
      difficulty: "MEDIUM",
      quizzesAnalyzed: 0,
      weightedAccuracy: 0.5,
      reasoning: "Calibration unavailable. Defaulting to Medium difficulty.",
      trend: "stable",
    };
  }
}

/**
 * Simple wrapper — returns just the Difficulty enum value.
 * Kept for backward compatibility with existing callers.
 */
export async function getRecommendedDifficulty(userId: string): Promise<Difficulty> {
  const insights = await getAdaptiveDifficultyInsights(userId);
  return insights.difficulty;
}
