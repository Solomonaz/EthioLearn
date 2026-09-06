import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireCompleteProfile } from "@/lib/get-session";
import { getDailyMessage } from "@/lib/motivational-messages";
import { getStudyScope } from "@/lib/grade-scope";

export async function GET() {
  const user = await requireCompleteProfile();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Subjects span the student's whole study scope, not just their enrollment
  // grade — a grade 8 sits an exam drawn from grades 7–8, a grade 12 from
  // grades 9–12 (see lib/grade-scope).
  const studyScope = getStudyScope(user.grade);

  // ── Parallel data fetches ──────────────────────────────────────────────────
  const [recentQuizzes, quizStats, pointsSum, textbooks, quizAnswers] =
    await Promise.all([
      // 1. Recent quizzes
      db.quiz.findMany({
        where: { studentId: user.id, completedAt: { not: null } },
        orderBy: { completedAt: "desc" },
        take: 5,
        select: {
          id: true,
          mode: true,
          score: true,
          totalQuestions: true,
          correctAnswers: true,
          totalPointsEarned: true,
          completedAt: true,
        },
      }),

      // 2. Aggregate stats
      db.quiz.aggregate({
        where: { studentId: user.id, completedAt: { not: null } },
        _count: true,
        _avg: { score: true },
      }),

      // 3. Total points
      db.pointLedger.aggregate({
        where: { userId: user.id },
        _sum: { points: true },
      }),

      // 4. Available subjects
      db.textbook.findMany({
        where: studyScope.length > 0 ? { grade: { in: studyScope } } : {},
        select: {
          id: true,
          title: true,
          subject: true,
          grade: true,
          _count: { select: { chapters: true } },
        },
        orderBy: { subject: "asc" },
      }),

      // 5. All quiz answers for weakest-topics analysis (SRS §4.3.3)
      db.quizAnswer.findMany({
        where: {
          quiz: { studentId: user.id, completedAt: { not: null } },
        },
        select: {
          isCorrect: true,
          question: {
            select: {
              difficulty: true,
              bloomLevel: true,
              type: true,
              chapter: {
                select: {
                  id: true,
                  title: true,
                  topicTags: true,
                  textbook: { select: { subject: true, grade: true } },
                },
              },
            },
          },
          quiz: { select: { score: true, completedAt: true } },
        },
      }),
    ]);

  // ── Weakest Topics & Study Recommendations (SRS §4.3.3) ────────────────────
  // Accumulate per-chapter scores (deduplicate answers from the same quiz) plus
  // per-answer accuracy by difficulty / Bloom level / question type, so we can
  // surface *specific* focus areas — not just an overall percentage.
  type Bucket = { correct: number; total: number };
  type ChapterAccum = {
    id: string;
    title: string;
    subject: string;
    grade: number;
    quizScores: Map<string, number>; // completedAt ISO -> score
    topicTags: string[];
    byDifficulty: Map<string, Bucket>;
    byBloom: Map<string, Bucket>;
    byType: Map<string, Bucket>;
  };

  const chapterMap = new Map<string, ChapterAccum>();

  const bump = (m: Map<string, Bucket>, key: string | null | undefined, correct: boolean) => {
    if (!key) return;
    const b = m.get(key) ?? { correct: 0, total: 0 };
    b.total += 1;
    if (correct) b.correct += 1;
    m.set(key, b);
  };

  for (const answer of quizAnswers) {
    const q = answer.question;
    const chapter = q.chapter;
    const textbook = chapter.textbook;
    const completedAt = answer.quiz.completedAt
      ? answer.quiz.completedAt.toISOString()
      : "unknown";
    const score = answer.quiz.score;

    if (!chapterMap.has(chapter.id)) {
      chapterMap.set(chapter.id, {
        id: chapter.id,
        title: chapter.title,
        subject: textbook.subject,
        grade: textbook.grade,
        quizScores: new Map(),
        topicTags: chapter.topicTags ?? [],
        byDifficulty: new Map(),
        byBloom: new Map(),
        byType: new Map(),
      });
    }

    const accum = chapterMap.get(chapter.id)!;
    if (!accum.quizScores.has(completedAt)) {
      accum.quizScores.set(completedAt, score);
    }
    bump(accum.byDifficulty, q.difficulty, answer.isCorrect);
    bump(accum.byBloom, q.bloomLevel, answer.isCorrect);
    bump(accum.byType, q.type, answer.isCorrect);
  }

  // Helpers for building focus-area bullets from a chapter's accumulated data.
  const TYPE_LABEL: Record<string, string> = {
    MCQ: "multiple-choice",
    TRUE_FALSE: "true/false",
    FILL_IN_BLANK: "fill-in-the-blank",
    MATCH_PAIRS: "matching",
    ORDERING: "ordering",
  };
  const diffLabel = (d: string) => d.charAt(0).toUpperCase() + d.slice(1).toLowerCase();
  const weakestBucket = (m: Map<string, Bucket>, minTotal = 2) => {
    let best: { key: string; acc: number } | null = null;
    for (const [key, b] of m) {
      if (b.total < minTotal) continue;
      const acc = b.correct / b.total;
      if (!best || acc < best.acc) best = { key, acc };
    }
    return best;
  };

  const buildFocusAreas = (accum: ChapterAccum): string[] => {
    const bullets: string[] = [];

    const wd = weakestBucket(accum.byDifficulty);
    if (wd && wd.acc < 0.7) {
      bullets.push(`Practice ${diffLabel(wd.key)} questions — only ${Math.round(wd.acc * 100)}% correct so far`);
    }
    const wb = weakestBucket(accum.byBloom);
    if (wb && wb.acc < 0.7) {
      bullets.push(`Strengthen ${wb.key}-level questions — ${Math.round(wb.acc * 100)}% correct`);
    }
    const wt = weakestBucket(accum.byType);
    if (wt && wt.acc < 0.6) {
      bullets.push(`Work on ${TYPE_LABEL[wt.key] ?? wt.key.toLowerCase()} questions — ${Math.round(wt.acc * 100)}% correct`);
    }
    const tags = [...new Set(accum.topicTags)].filter(Boolean).slice(0, 4);
    if (tags.length > 0) {
      bullets.push(`Review key topics: ${tags.join(", ")}`);
    }
    if (bullets.length === 0) {
      bullets.push("Re-take a quiz on this chapter to reinforce the core concepts");
    }
    return bullets.slice(0, 4);
  };

  // Find chapters where avg score < 60%
  const weakestChapters: {
    id: string;
    title: string;
    subject: string;
    grade: number;
    avgScore: number;
    attemptCount: number;
  }[] = [];

  for (const [, accum] of chapterMap) {
    const scores = Array.from(accum.quizScores.values());
    if (scores.length === 0) continue;
    const avg = Math.round(scores.reduce((s, v) => s + v, 0) / scores.length);
    if (avg < 60) {
      weakestChapters.push({
        id: accum.id,
        title: accum.title,
        subject: accum.subject,
        grade: accum.grade,
        avgScore: avg,
        attemptCount: scores.length,
      });
    }
  }

  // Sort by worst score first, take top 3 for the dashboard widget
  weakestChapters.sort((a, b) => a.avgScore - b.avgScore);
  const topWeakest = weakestChapters.slice(0, 3);

  // Generate study recommendations from weakest topics
  const studyRecommendations = topWeakest.map((c) => {
    const lastAttempts = Math.min(c.attemptCount, 3);
    const avgText =
      lastAttempts > 1
        ? `your last ${lastAttempts} attempts averaged ${c.avgScore}%`
        : `your latest attempt was ${c.avgScore}%`;
    return {
      chapterId: c.id,
      subject: c.subject,
      chapter: c.title,
      avgScore: c.avgScore,
      message: `Review ${c.title} of ${c.subject} \u2014 ${avgText}.`,
      focusAreas: buildFocusAreas(chapterMap.get(c.id)!),
    };
  });

  // ── Daily motivational message (SRS §4.3.1) ───────────────────────────────
  const dailyMessage = getDailyMessage();

  return NextResponse.json({
    user: {
      id: user.id,
      name: user.name,
      grade: user.grade,
      xpLevel: user.xpLevel,
      totalPoints: user.totalPoints,
      streakDays: user.streakDays,
      avatarUrl: user.avatarUrl,
    },
    stats: {
      totalQuizzes: quizStats._count,
      averageScore: Math.round(quizStats._avg.score || 0),
      totalPoints: pointsSum._sum.points || 0,
      streakDays: user.streakDays,
    },
    recentQuizzes,
    availableSubjects: textbooks,
    weakestChapters: topWeakest,
    studyRecommendations,
    dailyMessage,
  });
}
