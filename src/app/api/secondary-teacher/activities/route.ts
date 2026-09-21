import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getCurrentUser } from "@/lib/get-session";
import { rateLimit } from "@/lib/rate-limit";
import { validateCsrfOrigin } from "@/lib/csrf";
import { isSecondaryGrade } from "@/lib/teacher-band";
import { subjectEquals } from "@/lib/subject";
import { sseResponse } from "@/lib/sse";
import { isAiFeatureEnabled } from "@/lib/platform-settings";
import { usageActor } from "@/lib/usage-logger";
import { askTeachingAssistant } from "@/lib/teaching-assistant";
import { isInStudyScope } from "@/lib/grade-scope";
import { replenishQuestionBank, type BankQuestion } from "@/lib/question-bank";
import { splitAnswerKey, looksLikeItContainsAnswers } from "@/lib/answer-key";

/**
 * Teacher-set activities for a grades 9-12 class — homework, classwork, a
 * test, or anything else the teacher labels.
 *
 * The questions are PINNED at creation: the whole class sits the same paper.
 * Generating per student would make "which question did the class fail"
 * unanswerable and would burn AI budget once per student instead of once.
 *
 * Targets are materialised at creation too, so membership is frozen — a
 * student who joins the section next month does not retroactively owe it.
 */

const MAX_QUESTIONS = 50;

/**
 * How many questions one AI request may generate for a teacher-set paper.
 * Higher than the student quiz path's top-up ceiling because this is a
 * deliberate "make me a paper" action, but still bounded: generation and
 * verification are slow, and the teacher is waiting on the response.
 */
const AI_GENERATE_CEILING = 25;

/**
 * Most chapters one paper may draw from. A whole textbook is a legitimate
 * end-of-year revision request, so this is generous — it exists to bound the
 * per-chapter generation loop, not to express a teaching opinion.
 */
const MAX_CHAPTERS_PER_ACTIVITY = 30;

/** Chapter text given to the model when writing workout problems. */
const WORKOUT_CONTENT_BUDGET = 12000;
const VALID_KINDS = ["HOMEWORK", "CLASSWORK", "ASSIGNMENT", "TEST", "PRACTICE"] as const;
type ActivityKind = (typeof VALID_KINDS)[number];

const VALID_DIFFICULTIES = ["EASY", "MEDIUM", "HARD"] as const;

/** Question types a teacher may ask for, matching the QuestionType enum. */
const VALID_QUESTION_TYPES = [
  "MCQ",
  "TRUE_FALSE",
  "FILL_IN_BLANK",
  "MATCH_PAIRS",
  "ORDERING",
] as const;

async function getTeacher() {
  const user = await getCurrentUser();
  if (!user || user.role !== "SECONDARY_TEACHER" || !user.schoolId) return null;
  return user;
}

// ─── POST: set an activity for one class ─────────────────────────────────

type Emit = (info: { message: string; percent: number }) => void;

/**
 * The whole creation flow. Split out from POST so it can run either as a plain
 * request or inside an SSE stream — generating a fresh paper takes long enough
 * that a teacher deserves to see which stage it is on.
 */
async function createActivity(req: NextRequest, emit?: Emit): Promise<Response> {
  if (!validateCsrfOrigin(req)) {
    return NextResponse.json({ error: "Invalid request origin" }, { status: 403 });
  }

  const user = await getTeacher();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 403 });

  const rl = rateLimit("secondary-teacher:activity:create:" + user.id, 20, 60_000);
  if (!rl.success) {
    return NextResponse.json(
      { error: "Too many requests. Please slow down." },
      { status: 429, headers: { "Retry-After": String(rl.retryAfter) } },
    );
  }

  let body: {
    teachingAssignmentId?: string;
    kind?: string;
    title?: string;
    instructions?: string;
    /** Legacy single-chapter form; still accepted. */
    chapterId?: string;
    /** Every chapter the paper draws from. */
    chapterIds?: unknown;
    difficulty?: string;
    questionCount?: number;
    dueAt?: string | null;
    studentIds?: unknown;
    /** "AI" generates a fresh paper; anything else draws from the bank. */
    source?: string;
    /** "DOCUMENT" gives the class written work; default is a question paper. */
    format?: string;
    /** Generate a worksheet of calculations for the class to work through. */
    workout?: boolean;
    /** Which question types to draw or generate. Defaults to MCQ. */
    questionTypes?: unknown;
    /** DOCUMENT only: the Markdown students read. */
    documentBody?: string;
    /** DOCUMENT only: students must hand an answer in. */
    requiresSubmission?: boolean;
    /** What the work is marked out of. Null/absent = feedback only. */
    maxMarks?: number | null;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  // ── The class ─────────────────────────────────────────────────────────
  const teachingAssignmentId =
    typeof body.teachingAssignmentId === "string" ? body.teachingAssignmentId : "";
  if (!teachingAssignmentId) {
    return NextResponse.json({ error: "Choose which class this is for." }, { status: 400 });
  }

  // Scoped to the caller, so a teacher cannot set work for someone else's class.
  const klass = await db.teachingAssignment.findFirst({
    where: { id: teachingAssignmentId, teacherId: user.id },
    select: { id: true, subject: true, grade: true, section: true },
  });
  if (!klass) {
    return NextResponse.json({ error: "Class not found" }, { status: 404 });
  }
  if (!isSecondaryGrade(klass.grade)) {
    return NextResponse.json(
      { error: "That class is outside grades 9-12." },
      { status: 400 },
    );
  }
  if (!klass.section) {
    return NextResponse.json(
      { error: "Set a section on that class before assigning work to it." },
      { status: 400 },
    );
  }

  // ── Kind, title, count, difficulty ────────────────────────────────────
  const kind: ActivityKind = VALID_KINDS.includes(body.kind as ActivityKind)
    ? (body.kind as ActivityKind)
    : "HOMEWORK";

  const questionCount = Math.min(
    Math.max(Number(body.questionCount) || 10, 1),
    MAX_QUESTIONS,
  );

  const rawDifficulty = typeof body.difficulty === "string" ? body.difficulty : "";
  // Anything not EASY/MEDIUM/HARD means mixed, which is stored as null.
  const difficulty = VALID_DIFFICULTIES.includes(
    rawDifficulty as (typeof VALID_DIFFICULTIES)[number],
  )
    ? (rawDifficulty as (typeof VALID_DIFFICULTIES)[number])
    : null;

  // Unknown values are dropped rather than rejected, so a future client that
  // sends a type this build does not know about still gets a usable paper.
  const requestedTypes = Array.isArray(body.questionTypes)
    ? (body.questionTypes as unknown[]).filter(
        (t): t is string =>
          typeof t === "string" &&
          VALID_QUESTION_TYPES.includes(t as (typeof VALID_QUESTION_TYPES)[number]),
      )
    : [];
  const questionTypes = requestedTypes.length > 0 ? requestedTypes : ["MCQ"];

  let dueAt: Date | null = null;
  if (typeof body.dueAt === "string" && body.dueAt) {
    const parsed = new Date(body.dueAt);
    if (Number.isNaN(parsed.getTime())) {
      return NextResponse.json({ error: "Invalid due date." }, { status: 400 });
    }
    dueAt = parsed;
  }

  /**
   * Workout problems are calculations a student solves on paper, showing
   * their working. Nothing about that is machine-markable, so a workout
   * activity is a DOCUMENT the teacher marks — not a question paper with an
   * unscoreable question type wedged into it.
   *
   * The difference from ordinary written work is only where the body comes
   * from: the teacher writes that one, and this one is generated here from
   * the chapters they picked.
   */
  const isWorkout = body.workout === true;
  const isDocument = body.format === "DOCUMENT" || isWorkout;

  // ── The chapters ──────────────────────────────────────────────────────
  //
  // A paper may draw from SEVERAL chapters: revision before a test is rarely
  // confined to one, and "all chapters" is how a teacher sets an end-of-unit
  // paper. `chapterIds` is the real input; `chapterId` is still accepted so
  // anything built against the older single-chapter shape keeps working.
  //
  // At least one chapter is required for a question paper — it is what the
  // questions are drawn from. Written work takes them as context only.
  const requestedChapterIds = Array.from(
    new Set(
      [
        ...(Array.isArray(body.chapterIds)
          ? (body.chapterIds as unknown[]).filter(
              (v): v is string => typeof v === "string" && v.length > 0,
            )
          : []),
        ...(typeof body.chapterId === "string" && body.chapterId ? [body.chapterId] : []),
      ],
    ),
  ).slice(0, MAX_CHAPTERS_PER_ACTIVITY);

  if (requestedChapterIds.length === 0 && !isDocument) {
    return NextResponse.json({ error: "Choose at least one chapter." }, { status: 400 });
  }

  const chapters = requestedChapterIds.length
    ? await db.chapter.findMany({
        where: { id: { in: requestedChapterIds } },
        orderBy: { chapterNumber: "asc" },
        select: {
          id: true,
          title: true,
          chapterNumber: true,
          textbookId: true,
          textbook: { select: { subject: true, grade: true } },
        },
      })
    : [];

  if (chapters.length !== requestedChapterIds.length) {
    return NextResponse.json({ error: "Chapter not found" }, { status: 404 });
  }

  // Every chapter is checked, not just the first. Validating one and trusting
  // the rest is how a mixed list becomes a way to reach another subject.
  for (const c of chapters) {
    // A Physics teacher must not be able to set Chemistry content for their
    // class. Compared case-insensitively, the same rule the cohort views use —
    // a stricter test here would block legitimate chapters rather than let
    // foreign ones through, but it would still be wrong.
    if (!subjectEquals(c.textbook?.subject, klass.subject)) {
      return NextResponse.json(
        { error: `"${c.title}" is not ${klass.subject}.` },
        { status: 400 },
      );
    }

    // The chapter's grade must be something this class may study. Cumulative
    // cycles mean a grade 12 class can legitimately be set grade 11 revision.
    if (!isInStudyScope(klass.grade, c.textbook?.grade)) {
      return NextResponse.json(
        { error: `"${c.title}" is outside what this class studies.` },
        { status: 400 },
      );
    }
  }

  // The primary chapter keeps the relation and names the activity.
  const chapter = chapters[0] ?? null;
  const chapterIds = chapters.map((c) => c.id);

  // ── Who it is for ─────────────────────────────────────────────────────
  const roster = await db.user.findMany({
    where: {
      role: "STUDENT",
      isActive: true,
      schoolId: user.schoolId,
      grade: klass.grade,
      section: klass.section,
    },
    select: { id: true },
  });

  let targetIds = roster.map((s) => s.id);

  // A subset turns the same endpoint into a remedial assignment. Intersected
  // with the roster, so ids from outside the class are silently dropped rather
  // than trusted.
  if (Array.isArray(body.studentIds) && body.studentIds.length > 0) {
    const requested = new Set(
      (body.studentIds as unknown[]).filter((v): v is string => typeof v === "string"),
    );
    targetIds = targetIds.filter((id) => requested.has(id));
  }

  if (targetIds.length === 0) {
    return NextResponse.json(
      { error: "No students in that class yet." },
      { status: 400 },
    );
  }

  // ── Written work: no questions, no bank, nothing to auto-mark ─────────
  if (isDocument) {
    let documentBody =
      typeof body.documentBody === "string" ? body.documentBody.trim() : "";
    /** Teacher-only worked solutions, split out of a generated worksheet. */
    let answerKey: string | null = null;
    /** Surfaced at review when the split could not be trusted. */
    let answerKeyNotice: string | null = null;

    // ── Workout problems are written here, from the chosen chapters ─────
    if (isWorkout && !documentBody) {
      if (!chapter) {
        return NextResponse.json(
          { error: "Choose at least one chapter to draw the problems from." },
          { status: 400 },
        );
      }
      if (!(await isAiFeatureEnabled("aiTutor"))) {
        return NextResponse.json(
          { error: "AI features are currently switched off for this platform." },
          { status: 503 },
        );
      }

      emit?.({ message: "Reading the chapters...", percent: 10 });

      // Ground the problems in the actual chapter text, the same budget the
      // assistant uses. Several chapters share it rather than each taking a
      // full slice, so a six-chapter request does not blow the prompt.
      const perChapter = Math.floor(WORKOUT_CONTENT_BUDGET / chapters.length);
      const sources = await db.chapter.findMany({
        where: { id: { in: chapterIds } },
        orderBy: { chapterNumber: "asc" },
        select: { title: true, content: true, textbook: { select: { content: true } } },
      });
      const grounding = sources
        .map(
          (c) =>
            `## ${c.title}\n` +
            (c.content || c.textbook?.content || "").slice(0, perChapter),
        )
        .join("\n\n");

      const problemCount = Math.min(Math.max(questionCount, 1), 30);
      const result = await askTeachingAssistant({
        task: "WORKOUT",
        prompt:
          `Write exactly ${problemCount} workout problems` +
          (difficulty ? ` at ${difficulty.toLowerCase()} difficulty` : "") +
          `, drawn from the chapters below` +
          (typeof body.instructions === "string" && body.instructions.trim()
            ? `. The teacher adds: ${body.instructions.trim().slice(0, 500)}`
            : "."),
        subject: klass.subject,
        grade: klass.grade,
        chapterTitle: chapters.map((c) => c.title).join("; "),
        chapterContent: grounding,
        actor: usageActor(user),
        onProgress: emit,
      });

      if ("failed" in result) {
        return NextResponse.json(
          { error: "The AI could not write those problems just now. Please try again." },
          { status: 502 },
        );
      }

      // The worked solutions are separated HERE, before anything is stored,
      // so the student-facing column never holds them in the first place.
      const split = splitAnswerKey(result.markdown);
      documentBody = split.body;
      answerKey = split.answerKey;
      if (!split.detected) {
        // Either the model wrote no solutions, or it put them somewhere this
        // could not find. The teacher is the one who can tell, and the draft
        // review is where they will.
        answerKeyNotice =
          "No separate answer key was found in what the AI wrote. Check the student view below does not give the answers away before you send it.";
      } else if (looksLikeItContainsAnswers(documentBody)) {
        answerKeyNotice =
          "Part of the student view still looks like it contains answers. Please read it before sending.";
      }
    }

    if (documentBody.length < 10) {
      return NextResponse.json(
        { error: "There is no content to give to the class." },
        { status: 400 },
      );
    }
    if (documentBody.length > 60_000) {
      return NextResponse.json({ error: "That is too long to assign." }, { status: 400 });
    }

    const docTitle =
      typeof body.title === "string" && body.title.trim()
        ? body.title.trim().slice(0, 120)
        : isWorkout
          ? `${klass.subject}: workout problems${chapter ? ` — ${chapter.title}` : ""}`.slice(
              0,
              120,
            )
          : `${klass.subject}: written work`;

    // Workout problems are always handed in — the working IS the answer, and
    // there is nothing to auto-mark, so a teacher who sets them is going to
    // mark them.
    const requiresSubmission = isWorkout || body.requiresSubmission === true;

    // Only meaningful when something is handed in, and bounded so a typo
    // cannot create an activity marked out of a million.
    let maxMarks: number | null = null;
    if (requiresSubmission && body.maxMarks !== null && body.maxMarks !== undefined) {
      const n = Number(body.maxMarks);
      if (!Number.isInteger(n) || n < 1 || n > 1000) {
        return NextResponse.json(
          { error: "Marks must be a whole number between 1 and 1000." },
          { status: 400 },
        );
      }
      maxMarks = n;
    }

    const activity = await db.classActivity.create({
      data: {
        kind,
        format: "DOCUMENT",
        requiresSubmission,
        maxMarks,
        title: docTitle,
        instructions:
          typeof body.instructions === "string" && body.instructions.trim()
            ? body.instructions.trim().slice(0, 2000)
            : null,
        body: documentBody,
        answerKey,
        dueAt,
        teacherId: user.id,
        teachingAssignmentId: klass.id,
        schoolId: user.schoolId,
        subject: klass.subject,
        grade: klass.grade,
        section: klass.section,
        chapterId: chapter?.id ?? null,
        textbookId: chapter?.textbookId ?? null,
        difficulty: null,
        questionCount: 0,
        targets: { create: targetIds.map((studentId) => ({ studentId })) },
      },
      select: {
        id: true,
        kind: true,
        format: true,
        requiresSubmission: true,
        maxMarks: true,
        title: true,
        dueAt: true,
        questionCount: true,
        subject: true,
        grade: true,
        section: true,
        createdAt: true,
        _count: { select: { targets: true } },
      },
    });

    // No notification here. The activity is a DRAFT: nobody has been given
    // anything yet, and telling a class about work they cannot open would be
    // worse than telling them nothing. Notifications go out from the publish
    // route, once a teacher has read it.
    return NextResponse.json(
      { activity, notice: answerKeyNotice, draft: true },
      { status: 201 },
    );
  }

  // ── The paper ─────────────────────────────────────────────────────────
  const where: {
    status: "PUBLISHED";
    chapterId: { in: string[] };
    difficulty?: string;
    type?: { in: string[] };
  } = {
    status: "PUBLISHED",
    chapterId: { in: chapterIds },
  };
  if (difficulty) where.difficulty = difficulty;
  where.type = { in: questionTypes };

  const wantsAi = body.source === "AI";
  let pool: BankQuestion[] = [];
  let notice: string | null = null;

  /**
   * How many questions to generate for each chapter.
   *
   * Spread evenly, remainder to the earliest chapters. A paper set across
   * four chapters should not be three-quarters chapter one just because
   * that is where the loop started.
   */
  function shareAcrossChapters(total: number): number[] {
    const base = Math.floor(total / chapters.length);
    const extra = total % chapters.length;
    return chapters.map((_, i) => base + (i < extra ? 1 : 0));
  }

  // "Generate with AI" writes a fresh set first, so the paper is new rather
  // than whatever the bank happened to hold. The generated rows are persisted
  // like any other, so the next teacher benefits too.
  if (wantsAi) {
    const share = shareAcrossChapters(questionCount);
    for (let i = 0; i < chapters.length; i++) {
      if (share[i] < 1) continue;
      const created = await replenishQuestionBank({
        chapterId: chapters[i].id,
        textbookId: chapters[i].textbookId,
        needed: share[i],
        difficulty: difficulty ?? undefined,
        questionTypes,
        mode: "SOLO",
        maxGenerate: AI_GENERATE_CEILING,
        // Each chapter reports across its own slice of the bar, so a
        // four-chapter paper does not appear to finish four times.
        onProgress: emit
          ? (info) =>
              emit({
                ...info,
                message:
                  chapters.length > 1
                    ? `Chapter ${chapters[i].chapterNumber}: ${info.message}`
                    : info.message,
                percent: Math.round(
                  ((i + info.percent / 100) / chapters.length) * 100,
                ),
              })
          : undefined,
      });
      const seen = new Set(pool.map((q) => q.id));
      pool = pool.concat(created.filter((q) => !seen.has(q.id)));
    }
    if (pool.length === 0) {
      notice =
        "AI could not generate new questions right now, so this was built from the existing question bank.";
    }
  }

  // Top up from the bank — also the whole story for a non-AI request. Newly
  // generated rows are already stored, so this query may return them again;
  // ids are de-duplicated below.
  if (pool.length < questionCount) {
    const banked = (await db.question.findMany({
      where: where as never,
      select: {
        id: true,
        questionText: true,
        options: true,
        type: true,
        difficulty: true,
      },
    })) as BankQuestion[];

    const seen = new Set(pool.map((q) => q.id));
    pool = pool.concat(banked.filter((q) => !seen.has(q.id)));
  }

  // Still short and the teacher did not ask for AI: top up the bank the same
  // way the student quiz path does.
  if (!wantsAi && pool.length < questionCount) {
    const share = shareAcrossChapters(questionCount - pool.length);
    for (let i = 0; i < chapters.length; i++) {
      if (share[i] < 1) continue;
      const created = await replenishQuestionBank({
        chapterId: chapters[i].id,
        textbookId: chapters[i].textbookId,
        needed: share[i],
        difficulty: difficulty ?? undefined,
        questionTypes,
        mode: "SOLO",
      });
      const seen = new Set(pool.map((q) => q.id));
      pool = pool.concat(created.filter((q) => !seen.has(q.id)));
    }
  }

  if (pool.length === 0) {
    return NextResponse.json(
      {
        error:
          chapters.length === 1
            ? "No questions are available for that chapter yet."
            : "No questions are available for those chapters yet.",
      },
      { status: 404 },
    );
  }

  if (pool.length < questionCount && !notice) {
    notice = `Only ${pool.length} question${pool.length === 1 ? "" : "s"} were available, so the activity is shorter than you asked for.`;
  }

  // Fisher-Yates, then take what we can — a short bank gives a shorter paper
  // rather than an error.
  const shuffled = [...pool];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  const selected = shuffled.slice(0, Math.min(questionCount, shuffled.length));

  // A multi-chapter paper is named for the range it covers, because listing
  // six chapter titles makes an unreadable heading.
  const autoTitle =
    chapters.length === 1
      ? `${klass.subject}: ${chapter!.title}`
      : `${klass.subject}: revision across ${chapters.length} chapters`;

  const title =
    typeof body.title === "string" && body.title.trim()
      ? body.title.trim().slice(0, 120)
      : autoTitle;

  const instructions =
    typeof body.instructions === "string" && body.instructions.trim()
      ? body.instructions.trim().slice(0, 2000)
      : null;

  emit?.({ message: "Building the paper...", percent: 95 });

  const activity = await db.classActivity.create({
    data: {
      kind,
      title,
      instructions,
      dueAt,
      teacherId: user.id,
      teachingAssignmentId: klass.id,
      schoolId: user.schoolId,
      subject: klass.subject,
      grade: klass.grade,
      section: klass.section,
      chapterId: chapter!.id,
      chapterIds,
      textbookId: chapter!.textbookId,
      difficulty,
      questionCount: selected.length,
      questions: {
        create: selected.map((q, index) => ({ questionId: q.id, order: index })),
      },
      targets: {
        create: targetIds.map((studentId) => ({ studentId })),
      },
    },
    select: {
      id: true,
      kind: true,
      title: true,
      dueAt: true,
      questionCount: true,
      subject: true,
      grade: true,
      section: true,
      createdAt: true,
      _count: { select: { targets: true } },
    },
  });

  // Nothing is sent yet — see the note in the document branch. A generated
  // paper is exactly the case that needs a teacher's eye before it reaches a
  // class: a confidently wrong question is indistinguishable from a good one
  // until somebody reads it.

  return NextResponse.json({ activity, notice, draft: true }, { status: 201 });
}

/**
 * POST — create an activity.
 *
 * `?stream=1` returns Server-Sent Events carrying live progress, then a final
 * `done` (or `error`) event. Without it the response is the plain JSON it has
 * always been, so nothing that already calls this route has to change.
 */
export async function POST(req: NextRequest) {
  if (req.nextUrl.searchParams.get("stream") !== "1") {
    return createActivity(req);
  }

  return sseResponse(async (emit) => {
    const res = await createActivity(req, emit.progress);
    const body = await res.json().catch(() => ({}));
    if (res.ok) emit.done(body);
    else emit.error(body?.error ?? "Could not set that activity");
  }, "Could not set that activity");
}

// ─── GET: the teacher's activities, with completion ──────────────────────

export async function GET(req: NextRequest) {
  const user = await getTeacher();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 403 });

  const { searchParams } = req.nextUrl;
  const classId = searchParams.get("classId")?.trim() || "";
  const limit = Math.min(100, Math.max(1, parseInt(searchParams.get("limit") || "50", 10)));

  const activities = await db.classActivity.findMany({
    where: {
      teacherId: user.id,
      ...(classId ? { teachingAssignmentId: classId } : {}),
    },
    orderBy: { createdAt: "desc" },
    take: limit,
    select: {
      id: true,
      kind: true,
      format: true,
      status: true,
      title: true,
      dueAt: true,
      subject: true,
      grade: true,
      section: true,
      questionCount: true,
      createdAt: true,
      _count: { select: { targets: true } },
    },
  });

  if (activities.length === 0) {
    return NextResponse.json({ activities: [] });
  }

  // Completion derives from the quizzes themselves rather than a cached
  // counter, so it cannot drift out of step with what students actually did.
  const ids = activities.map((a) => a.id);
  const completed = await db.quiz.groupBy({
    by: ["activityId"],
    where: { activityId: { in: ids }, completedAt: { not: null } },
    _count: { _all: true },
    _avg: { score: true },
  });
  const started = await db.quiz.groupBy({
    by: ["activityId"],
    where: { activityId: { in: ids } },
    _count: { _all: true },
  });

  const completedBy = new Map(completed.map((c) => [c.activityId, c]));
  const startedBy = new Map(started.map((s) => [s.activityId, s]));

  // Written work has no quiz, so its completion is the student saying "done"
  // on the target row instead.
  const docDone = await db.classActivityTarget.groupBy({
    by: ["activityId"],
    where: { activityId: { in: ids }, completedAt: { not: null } },
    _count: { _all: true },
  });
  const docDoneBy = new Map(docDone.map((d) => [d.activityId, d._count._all]));

  // Handed in but not yet marked. This is the only number on this screen a
  // teacher can act on today, so the list surfaces it rather than making them
  // open each activity to find out.
  const awaiting = await db.classActivityTarget.groupBy({
    by: ["activityId"],
    where: { activityId: { in: ids }, submittedAt: { not: null }, markedAt: null },
    _count: { _all: true },
  });
  const awaitingBy = new Map(awaiting.map((a) => [a.activityId, a._count._all]));

  return NextResponse.json({
    activities: activities.map((a) => {
      const isDoc = a.format === "DOCUMENT";
      const c = completedBy.get(a.id);
      const done = isDoc ? (docDoneBy.get(a.id) ?? 0) : (c?._count._all ?? 0);
      return {
        ...a,
        assignedCount: a._count.targets,
        startedCount: isDoc ? done : (startedBy.get(a.id)?._count._all ?? 0),
        completedCount: done,
        awaitingMarking: isDoc ? (awaitingBy.get(a.id) ?? 0) : 0,
        // Written work is not auto-marked, so there is no average to report.
        averageScore: isDoc ? null : (c?._avg.score ?? null),
      };
    }),
  });
}
