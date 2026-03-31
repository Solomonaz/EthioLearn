import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getCurrentUser } from "@/lib/get-session";

export async function GET(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = req.nextUrl;
  const page = Math.max(1, parseInt(searchParams.get("page") || "1", 10));
  const limit = Math.min(50, Math.max(1, parseInt(searchParams.get("limit") || "10", 10)));
  const subject = searchParams.get("subject") || undefined;
  const sortBy = searchParams.get("sortBy") || "date";

  // Build where clause
  const where: Record<string, unknown> = {
    studentId: user.id,
    completedAt: { not: null },
  };

  // If subject filter is provided, filter quizzes that have answers linked to that subject
  if (subject) {
    where.answers = {
      some: {
        question: {
          chapter: {
            textbook: { subject },
          },
        },
      },
    };
  }

  // Determine ordering
  const orderBy =
    sortBy === "score"
      ? { score: "desc" as const }
      : sortBy === "points"
        ? { totalPointsEarned: "desc" as const }
        : { completedAt: "desc" as const };

  // Fetch quizzes and total count in parallel
  const [quizzes, total, statsAgg, bestScoreAgg] = await Promise.all([
    db.quiz.findMany({
      where,
      orderBy,
      skip: (page - 1) * limit,
      take: limit,
      include: {
        answers: {
          take: 1,
          include: {
            question: {
              include: {
                chapter: {
                  include: {
                    textbook: {
                      select: { subject: true, title: true },
                    },
                  },
                },
              },
            },
          },
        },
      },
    }),
    db.quiz.count({ where }),
    db.quiz.aggregate({
      where: { studentId: user.id, completedAt: { not: null } },
      _count: true,
      _avg: { score: true },
      _sum: { totalPointsEarned: true },
    }),
    db.quiz.aggregate({
      where: { studentId: user.id, completedAt: { not: null } },
      _max: { score: true },
    }),
  ]);

  // Map quizzes to include subject info from the answer chain
  const mappedQuizzes = quizzes.map((quiz) => {
    const firstAnswer = quiz.answers[0];
    const textbook = firstAnswer?.question?.chapter?.textbook;
    const chapter = firstAnswer?.question?.chapter;

    return {
      id: quiz.id,
      mode: quiz.mode,
      score: quiz.score,
      totalPointsEarned: quiz.totalPointsEarned,
      totalQuestions: quiz.totalQuestions,
      correctAnswers: quiz.correctAnswers,
      completedAt: quiz.completedAt,
      startedAt: quiz.startedAt,
      subject: textbook?.subject ?? null,
      textbookTitle: textbook?.title ?? null,
      chapterTitle: chapter?.title ?? null,
      chapterNumber: chapter?.chapterNumber ?? null,
    };
  });

  const totalPages = Math.ceil(total / limit);

  return NextResponse.json({
    quizzes: mappedQuizzes,
    total,
    page,
    totalPages,
    stats: {
      totalQuizzes: statsAgg._count,
      avgScore: Math.round(statsAgg._avg.score || 0),
      totalPoints: statsAgg._sum.totalPointsEarned || 0,
      bestScore: bestScoreAgg._max.score || 0,
    },
  });
}
