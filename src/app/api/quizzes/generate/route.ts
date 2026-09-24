import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getCurrentUser } from "@/lib/get-session";
import { rateLimit } from "@/lib/rate-limit";
import { normalizeOption, shuffleArray } from "@/lib/utils";
import { bankPoolsFor } from "@/lib/quiz-selection";
import { getAdaptiveDifficultyInsights, AdaptiveInsights } from "@/lib/adaptive-learning";
import { getEntitlements, UPGRADE_MESSAGES } from "@/lib/entitlements";
import { isAiFeatureEnabled } from "@/lib/platform-settings";
import { isInStudyScope } from "@/lib/grade-scope";

export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // 30 quiz generations per minute per user
  const rl = rateLimit(`quiz:gen:${user.id}`, 30, 60 * 1000);
  if (!rl.success) {
    return NextResponse.json(
      { error: "Slow down! Too many quiz requests." },
      { status: 429, headers: { "Retry-After": String(rl.retryAfter) } }
    );
  }

  try {
    const body = await request.json();
    let { textbookId, chapterId, difficulty, questionCount = 10, mode = "SOLO", questionTypes, isDailyChallenge = false } = body;

    if (!chapterId) {
      return NextResponse.json(
        { error: "Chapter ID is required" },
        { status: 400 }
      );
    }

    // Resolve Adaptive Difficulty — AI Adaptive is an AI feature; gate it.
    let adaptiveCalibrated: string | undefined = undefined;
    let adaptiveInsights: AdaptiveInsights | undefined = undefined;
    if (difficulty === "ADAPTIVE") {
      const ent = await getEntitlements(user);
      if (!ent.ai) {
        return NextResponse.json(
          { error: UPGRADE_MESSAGES.ai, code: "UPGRADE_REQUIRED" },
          { status: 403 }
        );
      }
      // Honour the platform Adaptive-Difficulty switch; fall back to a fixed
      // difficulty when it's turned off.
      if (await isAiFeatureEnabled("aiAdaptive")) {
        adaptiveInsights = await getAdaptiveDifficultyInsights(user.id, {
          chapterId: chapterId === "all" ? null : chapterId,
          textbookId,
        });
        difficulty = adaptiveInsights.difficulty;
        adaptiveCalibrated = difficulty;
        console.log(`[Adaptive Engine] Calibrated to ${difficulty} (accuracy=${Math.round(adaptiveInsights.weightedAccuracy * 100)}%, trend=${adaptiveInsights.trend})`);
      } else {
        difficulty = "MEDIUM";
      }
    }

    // Validate question count (1–50)
    const count = Math.min(Math.max(Number(questionCount) || 10, 1), 50);

    // Validate difficulty enum
    if (difficulty && !["EASY", "MEDIUM", "HARD", "MIXED"].includes(difficulty)) {
      return NextResponse.json(
        { error: "difficulty must be EASY, MEDIUM, HARD, MIXED, or ADAPTIVE" },
        { status: 400 }
      );
    }

    // Validate mode enum
    if (mode && !["SOLO", "TIMED", "GROUP"].includes(mode)) {
      return NextResponse.json(
        { error: "mode must be SOLO, TIMED, or GROUP" },
        { status: 400 }
      );
    }

    // Build query filter — only PUBLISHED questions (not DRAFT AI-generated ones)
    const where: any = { status: "PUBLISHED" };

    // ── Grade scoping (see lib/grade-scope) ────────────────────────────────
    // The client sends a chapter/textbook id, so the grade must be resolved
    // server-side and checked against the student's study scope — otherwise a
    // crafted request could pull questions from any grade on the platform.
    // Staff (non-students) have no study scope and are not restricted.
    const enforceScope = user.role === "STUDENT";

    if (chapterId === "all") {
      if (!textbookId) {
        return NextResponse.json(
          { error: "Textbook ID is required for cumulative quizzes" },
          { status: 400 }
        );
      }
      const textbook = await db.textbook.findUnique({
        where: { id: textbookId },
        select: { grade: true },
      });
      if (!textbook) {
        return NextResponse.json({ error: "Textbook not found" }, { status: 404 });
      }
      if (enforceScope && !isInStudyScope(user.grade, textbook.grade)) {
        return NextResponse.json(
          { error: "That grade isn't part of your study scope.", code: "GRADE_OUT_OF_SCOPE" },
          { status: 403 }
        );
      }
      // Get all chapter IDs for this textbook
      const chapters = await db.chapter.findMany({
        where: { textbookId },
        select: { id: true },
      });
      where.chapterId = { in: chapters.map((c) => c.id) };
    } else {
      // Verify chapter exists — and resolve its grade for the scope check
      const chapterExists = await db.chapter.findUnique({
        where: { id: chapterId },
        select: { id: true, textbook: { select: { grade: true } } },
      });
      if (!chapterExists) {
        return NextResponse.json(
          { error: "Chapter not found" },
          { status: 404 }
        );
      }
      if (enforceScope && !isInStudyScope(user.grade, chapterExists.textbook?.grade)) {
        return NextResponse.json(
          { error: "That grade isn't part of your study scope.", code: "GRADE_OUT_OF_SCOPE" },
          { status: 403 }
        );
      }
      where.chapterId = chapterId;
    }

    if (Array.isArray(questionTypes) && questionTypes.length > 0) {
      where.type = { in: questionTypes };
    }

    if (difficulty && difficulty !== "MIXED") {
      where.difficulty = difficulty;
    }

    // Unseen first, then what this student answered longest ago — the same
    // rule as the AI source (see lib/quiz-selection). Previously a random
    // draw, which re-served answered questions while unseen ones waited.
    //
    // NEVER generates. This is the free source: it serves only what the bank
    // already holds, so a short bank means a shorter quiz, not an AI bill.
    // (It used to top a short bank up with AI via replenishQuestionBank.)
    const pools = await bankPoolsFor(user.id, where);

    if (pools.unseen.length + pools.seen.length === 0) {
      return NextResponse.json(
        {
          error:
            "No questions in the bank for this selection yet. Try another chapter, difficulty or question type.",
          code: "BANK_EMPTY",
        },
        { status: 404 }
      );
    }

    // Pick in priority order, then shuffle so recycled and unseen questions mix.
    const selected = shuffleArray([...pools.unseen, ...pools.seen].slice(0, count));

    // Create quiz record
    const quiz = await db.quiz.create({
      data: {
        studentId: user.id,
        mode,
        isDailyChallenge,
        totalQuestions: selected.length,
      } as any,
    });

    // Return questions WITHOUT correctAnswer (security)
    return NextResponse.json({
      quizId: quiz.id,
      mode: quiz.mode,
      totalQuestions: selected.length,
      requestedQuestions: count,
      deliveredQuestions: selected.length,
      shortfallReason:
        selected.length < count
          ? `The question bank has only ${selected.length} question${selected.length === 1 ? "" : "s"} for this selection.`
          : undefined,
      questions: selected.map((q) => {
        const options = (q.options as unknown[]).map(normalizeOption);
        return {
          id: q.id,
          questionText: q.questionText,
          // Randomise MCQ answer order so the correct choice isn't always slot A.
          // Grading matches by text (see submit route), so display order is safe
          // to change. Other types keep their order (positional meaning).
          options: q.type === "MCQ" ? shuffleArray(options) : options,
          type: q.type,
          difficulty: q.difficulty,
        };
      }),
      adaptiveCalibrated,
      adaptiveInsights: adaptiveInsights
        ? {
            difficulty: adaptiveInsights.difficulty,
            weightedAccuracy: Math.round(adaptiveInsights.weightedAccuracy * 100),
            quizzesAnalyzed: adaptiveInsights.quizzesAnalyzed,
            reasoning: adaptiveInsights.reasoning,
            trend: adaptiveInsights.trend,
          }
        : undefined,
    });
  } catch (error) {
    console.error("Quiz generation error:", error);
    return NextResponse.json(
      { error: "Failed to generate quiz" },
      { status: 500 }
    );
  }
}
