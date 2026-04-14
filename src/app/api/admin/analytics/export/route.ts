import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getCurrentUser } from "@/lib/get-session";

type PeriodKey = "7d" | "30d" | "90d";

function getDaysBack(period: PeriodKey): number {
  return period === "7d" ? 7 : period === "90d" ? 90 : 30;
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
      const key = quiz.studentId + "-" + (quiz.completedAt?.toISOString() ?? "");
      if (!entry.quizIds.has(key)) {
        entry.quizIds.add(key);
        entry.scores.push(quiz.score);
        entry.totalPoints += quiz.totalPointsEarned;
      }
    }
  }

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

/** Escape a value for CSV: wrap in double-quotes if it contains a comma, double-quote, or newline. */
function csvEscape(value: string | number): string {
  const str = String(value);
  if (str.includes(",") || str.includes('"') || str.includes("\n")) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

function csvRow(...values: (string | number)[]): string {
  return values.map(csvEscape).join(",");
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

      db.quiz.count({
        where: {
          startedAt: { gte: since },
          student: studentFilter,
        },
      }),

      db.user.count({
        where: {
          ...studentFilter,
          createdAt: { gte: since },
        },
      }),

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

  const subjectStats = computeSubjectStats(quizzes);
  const difficultyStats = computeDifficultyStats(quizzes);
  const scoreDistribution = computeScoreDistribution(quizzes);

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

  // Build CSV
  const lines: string[] = [];

  // Section 1: Summary
  lines.push("Summary");
  lines.push(csvRow("Metric", "Value"));
  lines.push(csvRow("Total Quizzes", totalQuizzes));
  lines.push(csvRow("Avg Score", `${avgScore}%`));
  lines.push(csvRow("Total Points Awarded", totalPointsAwarded));
  lines.push(csvRow("Active Students", activeStudents));
  lines.push(csvRow("New Students", newStudents));
  lines.push(csvRow("Completion Rate", `${completionRate}%`));
  lines.push("");

  // Section 2: Subject Performance
  lines.push("Subject Performance");
  lines.push(csvRow("Subject", "Quizzes", "Avg Score (%)", "Total Points"));
  for (const s of subjectStats) {
    lines.push(csvRow(s.subject, s.quizzes, s.avgScore, s.totalPoints));
  }
  lines.push("");

  // Section 3: Difficulty Breakdown
  lines.push("Difficulty Breakdown");
  lines.push(csvRow("Difficulty", "Total Questions", "Correct", "Accuracy (%)"));
  for (const d of difficultyStats) {
    lines.push(csvRow(d.difficulty, d.count, d.correct, d.accuracy));
  }
  lines.push("");

  // Section 4: Score Distribution
  lines.push("Score Distribution");
  lines.push(csvRow("Score Range", "Count"));
  for (const s of scoreDistribution) {
    lines.push(csvRow(s.range, s.count));
  }
  lines.push("");

  // Section 5: Grade Performance
  lines.push("Grade Performance");
  lines.push(csvRow("Grade", "Students", "Avg Points"));
  for (const g of formattedGradeStats) {
    lines.push(csvRow(g.grade, g.studentCount, g.avgPoints));
  }

  const csv = lines.join("\r\n");
  const dateStr = new Date().toISOString().slice(0, 10);
  const filename = `analytics-${period}-${dateStr}.csv`;

  return new NextResponse(csv, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}
