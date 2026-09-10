import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getCurrentUser } from "@/lib/get-session";
import { rateLimit } from "@/lib/rate-limit";
import { generateQuestionsBatched, verifyQuestions, hasBlockingStructuralIssue, generationContentBudget } from "@/lib/ai-provider";
import { QuestionType, Difficulty } from "@prisma/client";
import { normalizeOption, shuffleArray } from "@/lib/utils";
import { getRecommendedDifficulty } from "@/lib/adaptive-learning";
import { getEntitlements, UPGRADE_MESSAGES } from "@/lib/entitlements";
import { isAiFeatureEnabled } from "@/lib/platform-settings";
import { isInStudyScope } from "@/lib/grade-scope";
import { selectGenerationContent } from "@/lib/generation-content";
import { QUESTION_CONTENT_CHARS } from "@/lib/question-prompts";

export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const ent = await getEntitlements(user);
  if (!ent.ai) {
    return NextResponse.json(
      { error: UPGRADE_MESSAGES.ai, code: "UPGRADE_REQUIRED" },
      { status: 403 }
    );
  }
  if (!(await isAiFeatureEnabled("aiQuizGen"))) {
    return NextResponse.json(
      { error: "AI quiz generation is currently turned off.", code: "AI_DISABLED" },
      { status: 503 }
    );
  }

  // Rate limit: 3 AI generations per minute for students (stricter than admins)
  const rl = rateLimit(`ai:student:gen:${user.id}`, 3, 60_000);
  if (!rl.success) {
    return NextResponse.json(
      { error: "Too many AI generation requests. Please wait a moment." },
      { status: 429, headers: { "Retry-After": String(rl.retryAfter) } }
    );
  }

  try {
    const body = await request.json();
    let { textbookId, chapterId, difficulty = "MIXED", questionCount = 10, mode = "SOLO", isDailyChallenge = false } = body;

    if (!textbookId) {
      return NextResponse.json({ error: "Textbook ID is required" }, { status: 400 });
    }

    // Resolve Adaptive Difficulty — honour the platform switch. When adaptive is
    // turned off, fall back to a fixed difficulty instead of calibrating.
    if (difficulty === "ADAPTIVE") {
      if (await isAiFeatureEnabled("aiAdaptive")) {
        difficulty = await getRecommendedDifficulty(user.id);
        console.log(`[Adaptive AI] Calibrated difficulty to: ${difficulty}`);
      } else {
        difficulty = "MEDIUM";
      }
    }

    // 1. Fetch Textbook & Content
    const textbook = await db.textbook.findUnique({
      where: { id: textbookId },
      select: { title: true, subject: true, grade: true, content: true },
    });

    if (!textbook) {
      return NextResponse.json({ error: "Textbook not found" }, { status: 404 });
    }

    // Grade scoping — same rule as the bank route: a student may only generate
    // from a grade inside their study scope (see lib/grade-scope).
    if (user.role === "STUDENT" && !isInStudyScope(user.grade, textbook.grade)) {
      return NextResponse.json(
        { error: "That grade isn't part of your study scope.", code: "GRADE_OUT_OF_SCOPE" },
        { status: 403 }
      );
    }

    // Also seeds HARD template rotation, so regenerating a chapter varies the
    // question SHAPES as well as the source text it draws from.
    let priorQuestions = 0;
    let finalContent = "";
    let finalTitle = "";
    let targetChapterId: string | null = null;

    // 2. Resolve Content (Chapter or All)
    if (chapterId === "all") {
      const chapters = await db.chapter.findMany({
        where: { textbookId },
        orderBy: { chapterNumber: "asc" },
        select: { id: true, title: true, content: true, chapterNumber: true },
      });

      if (chapters.length === 0) {
        return NextResponse.json({ error: "No chapters found" }, { status: 400 });
      }

      finalTitle = `All Chapters of ${textbook.title}`;
      finalContent = chapters
        .map((c) => `CHAPTER ${c.chapterNumber}: ${c.title}\n${c.content || ""}`)
        .join("\n\n")
        .slice(0, 80000);
      
      // Use the first chapter as a placeholder for DB linkage if needed, 
      // or we can handle null chapterId if our schema allows (it doesn't).
      // For "All", we'll just pick the first chapter for now.
      targetChapterId = chapters[0].id;
    } else {
      const chapter = await db.chapter.findFirst({
        where: { id: chapterId, textbookId },
        select: { id: true, title: true, content: true },
      });

      if (!chapter) {
        return NextResponse.json({ error: "Chapter not found" }, { status: 404 });
      }
      finalTitle = chapter.title;
      finalContent = chapter.content || textbook.content || "";
      targetChapterId = chapter.id;

      // Spend the prompt's character budget across the WHOLE chapter instead of
      // its opening 30k. Rotation advances with the chapter's existing question
      // count so repeated generation sweeps new material each time.
      priorQuestions = await db.question.count({
        where: { chapterId: chapter.id },
      });
      const selected = await selectGenerationContent({
        chapterId: chapter.id,
        fallbackContent: finalContent,
        // Budget by how many calls will carry it, so a small chapter is sent whole
      // instead of being sampled down to one prompt's worth. See ai-provider.
      budgetChars: generationContentBudget(Math.min(Math.max(Number(questionCount) || 10, 1), 20) + 3),
        rotation: priorQuestions,
      });
      finalContent = selected.content;
      console.log(
        `[Generate AI] Content strategy: ${selected.strategy} ` +
        `(${selected.chunksUsed}/${selected.chunksAvailable} chunks, rotation ${priorQuestions})`
      );
    }

    if (!finalContent || finalContent.length < 100) {
      return NextResponse.json({ error: "Not enough book content to generate questions." }, { status: 400 });
    }

    // 3. AI Generation
    const count = Math.min(Math.max(Number(questionCount) || 10, 1), 20);
    // Generate a small surplus so enough questions survive verification.
    //
    // The surplus used to be clamped to the same ceiling as `count`
    // (`Math.min(count + 3, 20)`), which silently cancelled it at exactly the
    // value a student is most likely to pick: asking for 20 generated 20, so a
    // single question rejected by the solver below came back as a 19-question
    // quiz. The clamp was guarding against one oversized provider call, but
    // `generateQuestionsBatched` already splits the request into batches of
    // five and sends them sequentially — 23 is five small calls instead of
    // four, not one big one.
    const genCount = count + 3;
    const validTypes = ["MCQ", "TRUE_FALSE", "FILL_IN_BLANK", "MATCH_PAIRS", "ORDERING"];
    const questionTypes = Array.isArray(body.questionTypes) && body.questionTypes.length > 0
      ? (body.questionTypes.filter((t: string) => validTypes.includes(t)) as ("MCQ" | "TRUE_FALSE" | "FILL_IN_BLANK" | "MATCH_PAIRS" | "ORDERING")[])
      : ["MCQ" as const];

    const { questions: rawQuestions, provider } = await generateQuestionsBatched({
      content: finalContent,
      chapterTitle: finalTitle,
      subject: textbook.subject,
      grade: textbook.grade,
      count: genCount,
      difficulty: difficulty as any,
      questionTypes: questionTypes as any,
      mode: (mode === "TIMED" || mode === "GROUP" ? mode : "SOLO") as "SOLO" | "TIMED" | "GROUP",
      variantSeed: priorQuestions,
    });

    // 3b. Independent-solver verification. Students take the test immediately and
    // cannot vet questions themselves, so they are served ONLY verified ones — a
    // second model re-solves each question blind and must agree with the answer
    // key. Rejected/unverified questions are dropped (fail-closed), never served.
    const verdicts = await verifyQuestions(
      rawQuestions,
      textbook.subject,
      textbook.grade,
      { avoidProvider: provider }
    );
    const aiQuestions = rawQuestions
      .filter(
        (q, i) =>
          verdicts[i]?.verdict === "verified" && !hasBlockingStructuralIssue(q)
      )
      .slice(0, count);

    if (aiQuestions.length === 0) {
      // Two very different failures used to share one message.
      //
      //   UNVERIFIED — the independent solver could not be reached at all
      //                (rate limit / exhausted quota). Nothing is wrong with
      //                the questions; the check simply never ran. Transient.
      //   rejected   — the solver ran and DISAGREED with the answer key, or
      //                the chapter is too thin to build sound questions from.
      //                Retrying changes nothing.
      //
      // Telling the student "try again" when the content is the problem sends
      // them into a loop, and blaming the content when a provider was merely
      // busy is simply wrong.
      const unverifiable = verdicts.filter((v) => v?.flag === "UNVERIFIED").length;
      const providersUnavailable = unverifiable > rawQuestions.length / 2;

      console.warn(
        `[Generate AI] 0 of ${rawQuestions.length} questions served — ` +
        `${unverifiable} unverifiable (provider unreachable), ` +
        `${rawQuestions.length - unverifiable} rejected by the solver.`
      );

      return providersUnavailable
        ? NextResponse.json(
            {
              error:
                "The AI is busy right now and couldn't double-check the questions. Please try again in a minute.",
              code: "VERIFIER_UNAVAILABLE",
              retryable: true,
            },
            { status: 503, headers: { "Retry-After": "60" } }
          )
        : NextResponse.json(
            {
              error:
                "Couldn't build questions that passed our accuracy check for this chapter. " +
                "It may have too little content — try another chapter, or a different question type.",
              code: "NO_QUESTIONS_PASSED_REVIEW",
              retryable: false,
            },
            { status: 502 }
          );
    }

    // 4. Save to DB (Filtered by Deduplication)
    // We fetch existing questions for this chapter to avoid duplicates
    const questionTexts = aiQuestions.map((q) => q.questionText);
    const existingQuestions = await db.question.findMany({
      where: {
        chapterId: targetChapterId!,
        questionText: { in: questionTexts },
      },
    });

    // Separate New vs. existing (Exact Text Match)
    const existingTexts = new Set(existingQuestions.map((q) => q.questionText));
    const newQuestionsData = aiQuestions.filter((q) => !existingTexts.has(q.questionText));

    const newlyCreatedQuestions = await Promise.all(
      newQuestionsData.map((q) =>
        db.question.create({
          data: {
            chapterId: targetChapterId!,
            questionText: q.questionText,
            type: q.type as any,
            difficulty: q.difficulty as any,
            options: q.options,
            correctAnswer: q.correctAnswer,
            explanation: q.explanation,
            status: "PUBLISHED",
          },
        })
      )
    );

    // Combine for final quiz (maintaining original AI order if possible, or just concat)
    const allQuizQuestions = [...existingQuestions, ...newlyCreatedQuestions];

    // 5. Create Quiz Session
    const quiz = await db.quiz.create({
      data: {
        studentId: user.id,
        mode: mode as any,
        isDailyChallenge,
        totalQuestions: allQuizQuestions.length,
      } as any,
    });

    return NextResponse.json({
      quizId: quiz.id,
      questions: allQuizQuestions.map((q) => {
        const options = (q.options as any[]).map(normalizeOption);
        return {
          id: q.id,
          questionText: q.questionText,
          // Randomise MCQ order (grading is by text — display order is safe).
          options: q.type === "MCQ" ? shuffleArray(options) : options,
          type: q.type,
          difficulty: q.difficulty,
        };
      }),
      adaptiveCalibrated: body.difficulty === "ADAPTIVE" ? difficulty : undefined,
      // A quiz can legitimately come back shorter than requested: questions the
      // independent solver rejected are dropped rather than served. Reporting
      // the shortfall stops a 3-question quiz looking like a silent bug, and
      // tells the student why without exposing the rejected questions.
      requestedQuestions: count,
      deliveredQuestions: allQuizQuestions.length,
      shortfallReason:
        allQuizQuestions.length < count
          ? "Some generated questions didn't pass our accuracy check and were left out."
          : undefined,
    });
  } catch (error) {
    console.error("[Student AI Generation Error]", error);
    return NextResponse.json({ error: "Failed to generate practice quiz" }, { status: 500 });
  }
}
