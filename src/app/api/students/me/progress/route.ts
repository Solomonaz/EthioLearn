import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getCurrentUser } from "@/lib/get-session";

type MasteryLevel = "NOT_STARTED" | "IN_PROGRESS" | "PROFICIENT" | "MASTERED";

function getMasteryLevel(avgScore: number, attemptCount: number): MasteryLevel {
  if (attemptCount === 0) return "NOT_STARTED";
  if (avgScore >= 80) return "MASTERED";
  if (avgScore >= 60) return "PROFICIENT";
  return "IN_PROGRESS";
}

export async function GET() {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Get all answers from completed quizzes with chapter/subject info
  const quizAnswers = await db.quizAnswer.findMany({
    where: {
      quiz: { studentId: user.id, completedAt: { not: null } },
    },
    include: {
      question: {
        include: {
          chapter: {
            include: {
              textbook: { select: { subject: true, grade: true, title: true } },
            },
          },
        },
      },
      quiz: { select: { score: true, completedAt: true } },
    },
    orderBy: { quiz: { completedAt: "desc" } },
  });

  // Accumulate per-chapter stats using a Map
  // Key: chapterId
  // Value: { id, title, subject, grade, quizScores (Set of quizScore per completedAt), attemptScores }
  type ChapterAccum = {
    id: string;
    title: string;
    subject: string;
    grade: number;
    // Map of quiz completedAt ISO string -> score (to deduplicate answers from same quiz)
    quizScores: Map<string, number>;
  };

  const chapterMap = new Map<string, ChapterAccum>();

  for (const answer of quizAnswers) {
    const chapter = answer.question.chapter;
    const textbook = chapter.textbook;
    const quizCompletedAt = answer.quiz.completedAt
      ? answer.quiz.completedAt.toISOString()
      : "unknown";
    const quizScore = answer.quiz.score;

    if (!chapterMap.has(chapter.id)) {
      chapterMap.set(chapter.id, {
        id: chapter.id,
        title: chapter.title,
        subject: textbook.subject,
        grade: textbook.grade,
        quizScores: new Map(),
      });
    }

    const accum = chapterMap.get(chapter.id)!;
    // Only record once per quiz (deduplicate multiple answers from same quiz)
    if (!accum.quizScores.has(quizCompletedAt)) {
      accum.quizScores.set(quizCompletedAt, quizScore);
    }
  }

  // Build chapter results
  type ChapterResult = {
    id: string;
    title: string;
    subject: string;
    grade: number;
    masteryLevel: MasteryLevel;
    avgScore: number;
    attemptCount: number;
  };

  const chapters: ChapterResult[] = [];

  for (const [, accum] of chapterMap) {
    const scores = Array.from(accum.quizScores.values());
    const attemptCount = scores.length;
    const avgScore =
      attemptCount > 0
        ? Math.round(scores.reduce((sum, s) => sum + s, 0) / attemptCount)
        : 0;
    const masteryLevel = getMasteryLevel(avgScore, attemptCount);

    chapters.push({
      id: accum.id,
      title: accum.title,
      subject: accum.subject,
      grade: accum.grade,
      masteryLevel,
      avgScore,
      attemptCount,
    });
  }

  // Build subject-level aggregates
  type SubjectAccum = {
    subject: string;
    grade: number;
    totalScore: number;
    chapterCount: number;
    quizCount: number;
  };

  const subjectMap = new Map<string, SubjectAccum>();

  for (const chapter of chapters) {
    const key = `${chapter.subject}__${chapter.grade}`;
    if (!subjectMap.has(key)) {
      subjectMap.set(key, {
        subject: chapter.subject,
        grade: chapter.grade,
        totalScore: 0,
        chapterCount: 0,
        quizCount: 0,
      });
    }
    const sub = subjectMap.get(key)!;
    sub.totalScore += chapter.avgScore;
    sub.chapterCount += 1;
    sub.quizCount += chapter.attemptCount;
  }

  const subjects = Array.from(subjectMap.values()).map((sub) => ({
    subject: sub.subject,
    grade: sub.grade,
    avgScore:
      sub.chapterCount > 0 ? Math.round(sub.totalScore / sub.chapterCount) : 0,
    quizCount: sub.quizCount,
    chapterCount: sub.chapterCount,
  }));

  // Weakest chapters: avgScore < 60, sorted asc, top 5
  const weakestChapters = chapters
    .filter((c) => c.attemptCount > 0 && c.avgScore < 60)
    .sort((a, b) => a.avgScore - b.avgScore)
    .slice(0, 5);

  // Study recommendations
  const studyRecommendations = weakestChapters.map((c) => {
    const lastAttempts = Math.min(c.attemptCount, 3);
    return `Review ${c.title} in ${c.subject} — your${lastAttempts < c.attemptCount ? ` last ${lastAttempts} attempts` : ""} average score is ${c.avgScore}%`;
  });

  return NextResponse.json({
    subjects,
    chapters,
    weakestChapters,
    studyRecommendations,
  });
}
