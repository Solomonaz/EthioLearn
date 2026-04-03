import { db } from "./db";
import { Difficulty } from "@prisma/client";

/**
 * AI Adaptive Learning Engine:
 * Analyzes the last 5 quizzes to determine the ideal difficulty level.
 * Accuracy > 80% (0.8) -> Promotes to HARD or keeps HARD.
 * Accuracy < 50% (0.5) -> Demotes to EASY or keeps EASY.
 * 50-80% -> MEDIUM.
 */
export async function getRecommendedDifficulty(userId: string): Promise<Difficulty> {
  try {
    const lastQuizzes = await db.quiz.findMany({
      where: { 
        studentId: userId,
        completedAt: { not: null }
      },
      orderBy: { completedAt: "desc" },
      take: 5,
      select: {
        score: true,
        totalQuestions: true,
      }
    });

    if (lastQuizzes.length === 0) {
      return "MEDIUM";
    }

    // Calculate overall accuracy across last sessions
    const totalCorrect = lastQuizzes.reduce((acc, q) => acc + (q.score / 10), 0);
    // Wait, let's look at the actual fields in schema:
    // score (Int), totalQuestions (Int), correctAnswers (Int)
    
    // Better calculation using the fields directly
    const actualQuizzes = await db.quiz.findMany({
      where: { 
        studentId: userId,
        completedAt: { not: null }
      },
      orderBy: { completedAt: "desc" },
      take: 5,
    });

    const aggregateCorrect = actualQuizzes.reduce((acc, q) => acc + q.correctAnswers, 0);
    const aggregateTotal = actualQuizzes.reduce((acc, q) => acc + q.totalQuestions, 0);

    if (aggregateTotal === 0) return "MEDIUM";

    const accuracy = aggregateCorrect / aggregateTotal;

    if (accuracy > 0.8) {
      return "HARD";
    } else if (accuracy < 0.5) {
      return "EASY";
    }

    return "MEDIUM";
  } catch (error) {
    console.error("[Adaptive Engine Error]", error);
    return "MEDIUM"; // Safe default
  }
}
