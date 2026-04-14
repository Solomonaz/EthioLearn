import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getCurrentUser } from "@/lib/get-session";

type PeriodKey = "7d" | "30d" | "90d";

function getDaysBack(period: PeriodKey): number {
  return period === "7d" ? 7 : period === "90d" ? 90 : 30;
}

function formatDay(date: Date): string {
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

type QuizWithDetails = {
  completedAt: Date | null;
  score: number;
  totalPointsEarned: number;
  studentId: string;
  answers: {
    isCorrect: boolean;
    question: {
      difficulty: "EASY" | "MEDIUM" | "HARD";
      chapter: {
        textbook: {
          subject: string;
        };
      };
    };
  }[];
};

function groupByDay(
  quizzes: QuizWithDetails[],
  daysBack: number
): { date: string; quizzes: number; avgScore: number }[] {
  const now = new Date();
  const result: { date: string; quizzes: number; avgScore: number }[] = [];

  for (let i = daysBack - 1; i >= 0; i--) {
    const day = new Date(now);
    day.setDate(day.getDate() - i);
    day.setHours(0, 0, 0, 0);

    const nextDay = new Date(day);
    nextDay.setDate(nextDay.getDate() + 1);

    const dayQuizzes = quizzes.filter((q) => {
      if (!q.completedAt) return false;
      const d = new Date(q.completedAt);
      return d >= day && d < nextDay;
    });

    const avgScore =
      dayQuizzes.length > 0
        ? Math.round(
            dayQuizzes.reduce((sum, q) => sum + q.score, 0) / dayQuizzes.length
          )
        : 0;

    result.push({
      date: formatDay(day),
      quizzes: dayQuizzes.length,
      avgScore,
    });
  }

  return result;
}

function computeSubjectStats(
  quizzes: QuizWithDetails[]
): { subject: string; quizzes: number; avgScore: number; totalPoints: number }[] {
  const subjectMap = new Map<
    string,
    { scores: number[]; totalPoints: number; quizIds: Set<string> }
  >();

  for (const quiz of quizzes) {
    for (const answer of quiz.answers) {
      const subject = answer.question.chapter.textbook.subject;
      if (!subjectMap.has(subject)) {
        subjectMap.set(subject, { scores: [], totalPoints: 0, quizIds: new Set() });
      }
      const entry = subjectMap.get(subject)!;
      if (!entry.quizIds.has(quiz.studentId + "-" + (quiz.completedAt?.toISOString() ?? ""))) {
        entry.quizIds.add(quiz.studentId + "-" + (quiz.completedAt?.toISOString() ?? ""));
        entry.scores.push(quiz.score);
        entry.totalPoints += quiz.totalPointsEarned;
      }
    }
  }

  // Fallback: if no answers have subject info, use the quiz itself
  if (subjectMap.size === 0) {
    return [];
  }

  return Array.from(subjectMap.entries())
    .map(([subject, data]) => ({
      subject,
      quizzes: data.quizIds.size,
      avgScore:
        data.scores.length > 0
          ? Math.round(
              data.scores.reduce((a, b) => a + b, 0) / data.scores.length
            )
          : 0,
      totalPoints: data.totalPoints,
    }))
    .sort((a, b) => b.quizzes - a.quizzes);
}

function computeDifficultyStats(
  quizzes: QuizWithDetails[]
): { difficulty: string; count: number; correct: number; accuracy: number }[] {
  const stats: Record<string, { count: number; correct: number }> = {
    EASY: { count: 0, correct: 0 },
    MEDIUM: { count: 0, correct: 0 },
    HARD: { count: 0, correct: 0 },
  };

  for (const quiz of quizzes) {
    for (const answer of quiz.answers) {
      const d = answer.question.difficulty;
      if (stats[d]) {
        stats[d].count++;
        if (answer.isCorrect) stats[d].correct++;
      }
    }
  }

  return [
    {
      difficulty: "Easy",
      ...stats.EASY,
      accuracy:
        stats.EASY.count > 0
          ? Math.round((stats.EASY.correct / stats.EASY.count) * 100)
          : 0,
    },
    {
      difficulty: "Medium",
      ...stats.MEDIUM,
      accuracy:
        stats.MEDIUM.count > 0
          ? Math.round((stats.MEDIUM.correct / stats.MEDIUM.count) * 100)
          : 0,
    },
    {
      difficulty: "Hard",
      ...stats.HARD,
      accuracy:
        stats.HARD.count > 0
          ? Math.round((stats.HARD.correct / stats.HARD.count) * 100)
          : 0,
    },
  ];
}

function computeSubjectDifficultyMatrix(
  quizzes: QuizWithDetails[]
): { subject: string; easy: number; medium: number; hard: number }[] {
  // subject → difficulty → { count, correct }
  const map = new Map<
    string,
    Record<"EASY" | "MEDIUM" | "HARD", { count: number; correct: number }>
  >();

  for (const quiz of quizzes) {
    for (const answer of quiz.answers) {
      const subject = answer.question.chapter.textbook.subject;
      const diff = answer.question.difficulty;
      if (!map.has(subject)) {
        map.set(subject, {
          EASY: { count: 0, correct: 0 },
          MEDIUM: { count: 0, correct: 0 },
          HARD: { count: 0, correct: 0 },
        });
      }
      const entry = map.get(subject)![diff];
      entry.count++;
      if (answer.isCorrect) entry.correct++;
    }
  }

  return Array.from(map.entries())
    .map(([subject, stats]) => ({
      subject,
      easy:
        stats.EASY.count > 0
          ? Math.round((stats.EASY.correct / stats.EASY.count) * 100)
          : -1, // -1 = no data
      medium:
        stats.MEDIUM.count > 0
          ? Math.round((stats.MEDIUM.correct / stats.MEDIUM.count) * 100)
          : -1,
      hard:
        stats.HARD.count > 0
          ? Math.round((stats.HARD.correct / stats.HARD.count) * 100)
          : -1,
    }))
    .sort((a, b) => a.subject.localeCompare(b.subject));
}

function computeScoreDistribution(
  quizzes: QuizWithDetails[]
): { range: string; count: number }[] {
  const buckets = [
    { range: "0-20%", min: 0, max: 20, count: 0 },
    { range: "20-40%", min: 20, max: 40, count: 0 },
    { range: "40-60%", min: 40, max: 60, count: 0 },
    { range: "60-80%", min: 60, max: 80, count: 0 },
    { range: "80-100%", min: 80, max: 101, count: 0 },
  ];

  for (const quiz of quizzes) {
    const bucket = buckets.find(
      (b) => quiz.score >= b.min && quiz.score < b.max
    );
    if (bucket) bucket.count++;
  }

  return buckets.map(({ range, count }) => ({ range, count }));
}

export async function GET(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user || !["SUPER_ADMIN", "SCHOOL_ADMIN"].includes(user.role)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  }

  const { searchParams } = new URL(req.url);
  const rawPeriod = searchParams.get("period") ?? "30d";
  const period: PeriodKey = ["7d", "30d", "90d"].includes(rawPeriod)
    ? (rawPeriod as PeriodKey)
    : "30d";

  const daysBack = getDaysBack(period);
  const since = new Date(Date.now() - daysBack * 24 * 60 * 60 * 1000);

  const schoolId = user.schoolId ?? undefined;
  const studentFilter = schoolId
    ? { schoolId, role: "STUDENT" as const }
    : { role: "STUDENT" as const };

  // Fetch quizzes with all needed relations for analytics
  const [quizzes, allQuizzesInPeriod, newStudents, gradeStats] =
    await Promise.all([
      db.quiz.findMany({
        where: {
          completedAt: { gte: since, not: null },
          student: studentFilter,
        },
        select: {
          completedAt: true,
          score: true,
          totalPointsEarned: true,
          studentId: true,
          answers: {
            select: {
              isCorrect: true,
              question: {
                select: {
                  difficulty: true,
                  chapter: {
                    select: {
                      textbook: {
                        select: { subject: true },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      }),

      // All quizzes started in period (for completion rate)
      db.quiz.count({
        where: {
          startedAt: { gte: since },
          student: studentFilter,
        },
      }),

      // Students who joined in this period
      db.user.count({
        where: {
          ...studentFilter,
          createdAt: { gte: since },
        },
      }),

      // Grade performance
      db.user.groupBy({
        by: ["grade"],
        where: {
          ...studentFilter,
          grade: { not: null },
        },
        _avg: { totalPoints: true },
        _count: { id: true },
        orderBy: { _avg: { totalPoints: "desc" } },
      }),
    ]);

  // Compute derived analytics
  const activityByDay = groupByDay(quizzes, daysBack);
  const subjectStats = computeSubjectStats(quizzes);
  const difficultyStats = computeDifficultyStats(quizzes);
  const scoreDistribution = computeScoreDistribution(quizzes);
  const subjectDifficultyMatrix = computeSubjectDifficultyMatrix(quizzes);

  const totalQuizzes = quizzes.length;
  const avgScore =
    totalQuizzes > 0
      ? Math.round(
          quizzes.reduce((sum, q) => sum + q.score, 0) / totalQuizzes
        )
      : 0;
  const totalPointsAwarded = quizzes.reduce(
    (sum, q) => sum + q.totalPointsEarned,
    0
  );
  const activeStudents = new Set(quizzes.map((q) => q.studentId)).size;
  const completionRate =
    allQuizzesInPeriod > 0
      ? Math.round((totalQuizzes / allQuizzesInPeriod) * 100)
      : 0;

  const formattedGradeStats = gradeStats
    .filter((g) => g.grade !== null)
    .map((g) => ({
      grade: g.grade!,
      avgPoints: Math.round(g._avg.totalPoints ?? 0),
      studentCount: g._count.id,
    }));

  return NextResponse.json({
    period,
    summary: {
      totalQuizzes,
      avgScore,
      totalPointsAwarded,
      activeStudents,
      newStudents,
      completionRate,
    },
    activityByDay,
    subjectStats,
    difficultyStats,
    scoreDistribution,
    gradeStats: formattedGradeStats,
    subjectDifficultyMatrix,
  });
}
