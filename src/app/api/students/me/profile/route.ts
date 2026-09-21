import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireCompleteProfile } from "@/lib/get-session";
import { ACHIEVEMENTS } from "@/lib/achievements";
import { validateCsrfOrigin } from "@/lib/csrf";
import { normalizeSection } from "@/lib/section";

export async function GET() {
  const user = await requireCompleteProfile();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Fetch all completed quizzes with answer->question->chapter->textbook chain
  const quizzes = await db.quiz.findMany({
    where: {
      studentId: user.id,
      completedAt: { not: null },
    },
    orderBy: { completedAt: "desc" },
    select: {
      id: true,
      score: true,
      totalQuestions: true,
      correctAnswers: true,
      totalPointsEarned: true,
      completedAt: true,
      mode: true,
      answers: {
        take: 1,
        select: {
          question: {
            select: {
              chapter: {
                select: {
                  id: true,
                  title: true,
                  chapterNumber: true,
                  textbook: {
                    select: {
                      subject: true,
                      grade: true,
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
  });

  // ── Stats ──────────────────────────────────────────────────────────────────

  const totalQuizzes = quizzes.length;
  const avgScore =
    totalQuizzes > 0
      ? Math.round(
          quizzes.reduce((sum, q) => sum + q.score, 0) / totalQuizzes
        )
      : 0;
  const totalCorrect = quizzes.reduce((sum, q) => sum + q.correctAnswers, 0);
  const totalQuestions = quizzes.reduce((sum, q) => sum + q.totalQuestions, 0);

  // ── Streak calculation ─────────────────────────────────────────────────────

  const quizDates = quizzes
    .filter((q) => q.completedAt !== null)
    .map((q) => q.completedAt!.toISOString().split("T")[0])
    .filter((d, i, arr) => arr.indexOf(d) === i)
    .sort()
    .reverse();

  const today = new Date().toISOString().split("T")[0];

  // Current streak — count consecutive days backwards from today (or yesterday)
  let currentStreak = 0;
  {
    const msPerDay = 86400000;
    const todayMs = new Date(today).getTime();

    // Allow streak to start from today or yesterday
    const startOffset =
      quizDates[0] === today
        ? 0
        : quizDates[0] ===
            new Date(todayMs - msPerDay).toISOString().split("T")[0]
          ? 1
          : null;

    if (startOffset !== null) {
      for (let i = 0; i < quizDates.length; i++) {
        const expected = new Date(todayMs - (i + startOffset) * msPerDay)
          .toISOString()
          .split("T")[0];
        if (quizDates[i] === expected) {
          currentStreak++;
        } else {
          break;
        }
      }
      if (startOffset === 1 && currentStreak > 0) {
        // Streak started yesterday, still valid
      }
    }
  }

  // Longest streak — scan all unique quiz dates
  let longestStreak = 0;
  {
    const sorted = [...quizDates].sort();
    const msPerDay = 86400000;
    let run = sorted.length > 0 ? 1 : 0;
    for (let i = 1; i < sorted.length; i++) {
      const prev = new Date(sorted[i - 1]).getTime();
      const curr = new Date(sorted[i]).getTime();
      if (curr - prev === msPerDay) {
        run++;
      } else {
        if (run > longestStreak) longestStreak = run;
        run = 1;
      }
    }
    if (run > longestStreak) longestStreak = run;
  }

  const joinedDaysAgo = Math.floor(
    (Date.now() - user.createdAt.getTime()) / 86400000
  );

  // ── Subject mastery ────────────────────────────────────────────────────────

  const subjectMap = new Map<
    string,
    { quizzes: number; scoreSum: number; totalPoints: number }
  >();

  for (const quiz of quizzes) {
    const answer = quiz.answers[0];
    const subject = answer?.question?.chapter?.textbook?.subject ?? "Unknown";
    const existing = subjectMap.get(subject) ?? {
      quizzes: 0,
      scoreSum: 0,
      totalPoints: 0,
    };
    existing.quizzes += 1;
    existing.scoreSum += quiz.score;
    existing.totalPoints += quiz.totalPointsEarned;
    subjectMap.set(subject, existing);
  }

  const subjectMastery = Array.from(subjectMap.entries()).map(
    ([subject, data]) => ({
      subject,
      quizzes: data.quizzes,
      avgScore:
        data.quizzes > 0 ? Math.round(data.scoreSum / data.quizzes) : 0,
      totalPoints: data.totalPoints,
    })
  );

  // ── Recent activity (last 10) ──────────────────────────────────────────────

  const recentActivity = quizzes.slice(0, 10).map((q) => {
    const answer = q.answers[0];
    const chapter = answer?.question?.chapter ?? null;
    return {
      id: q.id,
      score: q.score,
      totalQuestions: q.totalQuestions,
      correctAnswers: q.correctAnswers,
      totalPointsEarned: q.totalPointsEarned,
      completedAt: q.completedAt,
      mode: q.mode,
      chapter: chapter
        ? {
            id: chapter.id,
            title: chapter.title,
            chapterNumber: chapter.chapterNumber,
            textbook: chapter.textbook,
          }
        : null,
    };
  });

  // ── Achievements (from UserAchievement table) ───────────────────────────────

  const earnedRecords = await db.userAchievement.findMany({
    where: { userId: user.id },
    select: { code: true },
  });
  const earnedCodes = new Set(earnedRecords.map((r) => r.code));

  const achievements = ACHIEVEMENTS.map((def) => ({
    id: def.code,
    name: def.name,
    desc: def.desc,
    icon: def.icon,
    earned: earnedCodes.has(def.code),
  }));

  // ── Response ───────────────────────────────────────────────────────────────

  return NextResponse.json({
    user: {
      id: user.id,
      name: user.name,
      // Hide internal telegram@ identifiers from the client
      phone: user.phoneNumber?.startsWith("telegram@") ? null : user.phoneNumber,
      grade: user.grade,
      section: user.section,
      totalPoints: user.totalPoints,
      xpLevel: user.xpLevel,
      avatarUrl: user.avatarUrl,
      school: user.school ? { name: user.school.name } : null,
    },
    stats: {
      totalQuizzes,
      avgScore,
      totalCorrect,
      totalQuestions,
      currentStreak,
      longestStreak,
      joinedDaysAgo,
    },
    subjectMastery,
    recentActivity,
    achievements,
  });
}

export async function PATCH(request: Request) {
  if (!validateCsrfOrigin(request)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const user = await requireCompleteProfile();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: { name?: string; grade?: number; section?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { name, grade, section } = body;

  // ── School students do not own their own identity ─────────────────────
  //
  // Name, grade and section are the three fields a teacher recognises a
  // student by. A student who can rewrite them can appear in someone else's
  // class roster, or take another child's name on a leaderboard their
  // classmates read. Neither is hypothetical once a class shares one screen.
  //
  // Grade and section are not cosmetic either: together they decide which
  // teacher's cohort the student lands in and which work they are set. Moving
  // yourself between sections is a way out of work you were given.
  //
  // So for a student enrolled at a school, these are the school admin's to
  // set. An independent student has no admin to ask, so they keep managing
  // their own — locking them would strand them with no way to fix a typo.
  if (user.schoolId) {
    const restricted = (["name", "grade", "section"] as const).filter(
      (f) => body[f] !== undefined,
    );
    if (restricted.length > 0) {
      return NextResponse.json(
        {
          error:
            "Your name, grade and section are managed by your school. Ask your school administrator to change them.",
          fields: restricted,
        },
        { status: 403 },
      );
    }
  }

  // Validate
  if (name !== undefined && (typeof name !== "string" || name.trim().length < 2)) {
    return NextResponse.json({ error: "Name must be at least 2 characters" }, { status: 400 });
  }
  if (grade !== undefined && (!Number.isInteger(grade) || grade < 1 || grade > 12)) {
    return NextResponse.json({ error: "Grade must be an integer between 1 and 12" }, { status: 400 });
  }
  if (section !== undefined && typeof section !== "string") {
    return NextResponse.json({ error: "Invalid section" }, { status: 400 });
  }

  const updateData: Record<string, unknown> = {};
  if (name !== undefined) updateData.name = name.trim();
  if (grade !== undefined) updateData.grade = grade;
  // Normalised like every other writer, so a self-managed student cannot
  // store "b" where the rest of the platform holds "B".
  if (section !== undefined) updateData.section = normalizeSection(section) || null;

  if (Object.keys(updateData).length === 0) {
    return NextResponse.json({ error: "No fields to update" }, { status: 400 });
  }

  const updated = await db.user.update({
    where: { id: user.id },
    data: updateData,
    select: { id: true, name: true, grade: true, section: true },
  });

  return NextResponse.json({ user: updated });
}
