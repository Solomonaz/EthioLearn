import { db } from "./db";
import { notifyAchievement, notifyStreak } from "./notifications";

// ─── Achievement definitions ──────────────────────────────

export interface AchievementDef {
  code: string;
  name: string;
  desc: string;
  icon: string;
  category: "quiz" | "accuracy" | "streak" | "battle" | "points" | "social";
}

export const ACHIEVEMENTS: AchievementDef[] = [
  { code: "first_quiz",        name: "First Steps",          icon: "🎯", desc: "Complete your first quiz",                    category: "quiz"     },
  { code: "quiz_10",           name: "Quiz Enthusiast",       icon: "📚", desc: "Complete 10 quizzes",                         category: "quiz"     },
  { code: "quiz_50",           name: "Knowledge Seeker",      icon: "🧠", desc: "Complete 50 quizzes",                         category: "quiz"     },
  { code: "quiz_100",          name: "Quiz Master",           icon: "🏆", desc: "Complete 100 quizzes",                        category: "quiz"     },
  { code: "hard_master",       name: "Difficulty Crusher",    icon: "🔥", desc: "Complete 10 hard-level quizzes",              category: "quiz"     },
  { code: "speed_demon",       name: "Speed Demon",           icon: "⚡", desc: "Finish a 10-question quiz in under 3 minutes", category: "quiz"    },
  { code: "perfect_score",     name: "Perfect Score",         icon: "⭐", desc: "Score 100% on a quiz",                        category: "accuracy" },
  { code: "perfect_5",         name: "Perfectionist",         icon: "🌟", desc: "Score 100% on 5 different quizzes",           category: "accuracy" },
  { code: "subject_champion",  name: "Subject Champion",      icon: "🏅", desc: "Master all chapters in one subject",          category: "accuracy" },
  { code: "streak_3",          name: "Getting Warmed Up",     icon: "🔥", desc: "Study 3 days in a row",                       category: "streak"   },
  { code: "streak_7",          name: "Week Warrior",          icon: "⚡", desc: "Study 7 days in a row",                       category: "streak"   },
  { code: "streak_30",         name: "Iron Student",          icon: "💪", desc: "Study 30 days in a row",                      category: "streak"   },
  { code: "battle_win",        name: "Battle Victor",         icon: "⚔️", desc: "Win your first battle",                       category: "battle"   },
  { code: "battle_5_wins",     name: "Battle Commander",      icon: "🛡️", desc: "Win 5 battles",                               category: "battle"   },
  { code: "social_butterfly",  name: "Social Butterfly",      icon: "🦋", desc: "Play 10 group games",                         category: "social"   },
  { code: "points_500",        name: "Point Collector",       icon: "💰", desc: "Earn 500 total points",                       category: "points"   },
  { code: "points_1000",       name: "Point Hoarder",         icon: "💎", desc: "Earn 1,000 total points",                     category: "points"   },
  { code: "points_3000",       name: "Point Master",          icon: "👑", desc: "Earn 3,000 total points",                     category: "points"   },
];

export function getAchievement(code: string): AchievementDef | undefined {
  return ACHIEVEMENTS.find((a) => a.code === code);
}

// ─── Context passed in from quiz/battle completion ────────

export interface AchievementContext {
  totalQuizzes: number;
  score: number;           // 0–100 for the completed quiz
  streak: number;          // new streak value after today
  totalPoints: number;     // new total AFTER adding earned points
  oldPoints: number;       // total BEFORE adding earned points
  difficulty?: string;     // "EASY" | "MEDIUM" | "HARD"
  totalTimeTakenMs?: number; // total ms for the whole quiz (for Speed Demon)
  questionCount?: number;    // number of questions in the quiz
  mode?: string;             // "SOLO" | "TIMED" | "GROUP"
  chapterId?: string;        // chapter tested in this quiz (for Subject Champion)
}

// ─── Core function ────────────────────────────────────────

/**
 * Check which achievements the user just unlocked and award them.
 * Safe to call fire-and-forget — errors are caught internally.
 */
export async function checkAndAwardAchievements(
  userId: string,
  ctx: AchievementContext
): Promise<void> {
  try {
    // Fetch all already-earned codes in one query
    const earned = await db.userAchievement.findMany({
      where: { userId },
      select: { code: true },
    });
    const earnedCodes = new Set(earned.map((e) => e.code));

    // Helper: award a single achievement if not already earned
    async function award(code: string): Promise<void> {
      if (earnedCodes.has(code)) return;
      const def = getAchievement(code);
      if (!def) return;
      try {
        await db.userAchievement.create({ data: { userId, code } });
        earnedCodes.add(code); // prevent double-award in same call
        await notifyAchievement(userId, def.name);
      } catch {
        // Race condition — another request already created it (unique constraint)
      }
    }

    // ── Quiz count milestones ─────────────────────────────
    if (ctx.totalQuizzes >= 1)   await award("first_quiz");
    if (ctx.totalQuizzes >= 10)  await award("quiz_10");
    if (ctx.totalQuizzes >= 50)  await award("quiz_50");
    if (ctx.totalQuizzes >= 100) await award("quiz_100");

    // ── Perfect score ─────────────────────────────────────
    if (ctx.score === 100) {
      await award("perfect_score");

      // Count total perfect quizzes for the user
      if (!earnedCodes.has("perfect_5")) {
        const perfectCount = await db.quiz.count({
          where: { studentId: userId, score: 100, completedAt: { not: null } },
        });
        if (perfectCount >= 5) await award("perfect_5");
      }
    }

    // ── Hard quizzes ──────────────────────────────────────
    if (ctx.difficulty === "HARD" && !earnedCodes.has("hard_master")) {
      const hardCount = await db.quiz.count({
        where: {
          studentId: userId,
          completedAt: { not: null },
          answers: { some: { question: { difficulty: "HARD" } } },
        },
      });
      if (hardCount >= 10) await award("hard_master");
    }

    // ── Speed Demon (10-question quiz in under 3 minutes) ─
    if (
      !earnedCodes.has("speed_demon") &&
      ctx.questionCount === 10 &&
      ctx.totalTimeTakenMs !== undefined &&
      ctx.totalTimeTakenMs < 180_000
    ) {
      await award("speed_demon");
    }

    // ── Social Butterfly (10 group games) ─────────────────
    if (!earnedCodes.has("social_butterfly") && ctx.mode === "GROUP") {
      const groupCount = await db.quiz.count({
        where: { studentId: userId, mode: "GROUP", completedAt: { not: null } },
      });
      if (groupCount >= 10) await award("social_butterfly");
    }

    // ── Streak milestones ─────────────────────────────────
    if (ctx.streak >= 3)  await award("streak_3");
    if (ctx.streak >= 7)  await award("streak_7");
    if (ctx.streak >= 30) await award("streak_30");

    // Also fire streak notification (always, for bell display)
    if ([3, 7, 14, 30].includes(ctx.streak)) {
      // Only notify if we haven't already today — use a best-effort approach
      await notifyStreak(userId, ctx.streak).catch(() => {});
    }

    // ── Subject Champion (master all chapters in one subject) ──
    // Only check when the student scored well (potential mastery) and we know the chapter
    if (!earnedCodes.has("subject_champion") && ctx.score >= 80 && ctx.chapterId) {
      try {
        // 1. Find which textbook/subject this chapter belongs to
        const chapter = await db.chapter.findUnique({
          where: { id: ctx.chapterId },
          select: { textbookId: true, textbook: { select: { subject: true, grade: true } } },
        });

        if (chapter) {
          // 2. Get all chapters for this subject+grade
          const allChapters = await db.chapter.findMany({
            where: { textbook: { subject: chapter.textbook.subject, grade: chapter.textbook.grade } },
            select: { id: true },
          });

          if (allChapters.length > 0) {
            // 3. For each chapter, check if student has avg score >= 80
            let allMastered = true;
            for (const ch of allChapters) {
              const answers = await db.quizAnswer.findMany({
                where: {
                  quiz: { studentId: userId, completedAt: { not: null } },
                  question: { chapterId: ch.id },
                },
                select: { quiz: { select: { score: true, completedAt: true } } },
              });

              // Deduplicate by quiz completion time
              const uniqueQuizScores = new Map<string, number>();
              for (const a of answers) {
                if (a.quiz.completedAt) {
                  const key = a.quiz.completedAt.toISOString();
                  if (!uniqueQuizScores.has(key)) {
                    uniqueQuizScores.set(key, a.quiz.score);
                  }
                }
              }

              const scores = Array.from(uniqueQuizScores.values());
              if (scores.length === 0) {
                allMastered = false;
                break;
              }
              const avg = scores.reduce((s, v) => s + v, 0) / scores.length;
              if (avg < 80) {
                allMastered = false;
                break;
              }
            }

            if (allMastered) {
              await award("subject_champion");
            }
          }
        }
      } catch {
        // Non-fatal — skip Subject Champion check if queries fail
      }
    }

    // ── Points milestones ─────────────────────────────────
    if (ctx.oldPoints < 500  && ctx.totalPoints >= 500)  await award("points_500");
    if (ctx.oldPoints < 1000 && ctx.totalPoints >= 1000) await award("points_1000");
    if (ctx.oldPoints < 3000 && ctx.totalPoints >= 3000) await award("points_3000");

  } catch (err) {
    console.error("[achievements] checkAndAwardAchievements error:", err);
  }
}

/**
 * Award a battle-win achievement. Call after confirming rank === 1.
 */
export async function checkBattleAchievements(userId: string): Promise<void> {
  try {
    const earned = await db.userAchievement.findMany({
      where: { userId },
      select: { code: true },
    });
    const earnedCodes = new Set(earned.map((e) => e.code));

    async function award(code: string): Promise<void> {
      if (earnedCodes.has(code)) return;
      const def = getAchievement(code);
      if (!def) return;
      try {
        await db.userAchievement.create({ data: { userId, code } });
        await notifyAchievement(userId, def.name);
      } catch { /* unique constraint race */ }
    }

    // Count total wins (rank 1)
    const winCount = await db.gamePlayer.count({
      where: { userId, rank: 1 },
    });
    if (winCount >= 1) await award("battle_win");
    if (winCount >= 5) await award("battle_5_wins");

  } catch (err) {
    console.error("[achievements] checkBattleAchievements error:", err);
  }
}
