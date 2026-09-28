import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getCurrentUser } from "@/lib/get-session";
import { rateLimit } from "@/lib/rate-limit";
import { isFullClass, isSecondaryGrade } from "@/lib/teacher-band";
import { subjectFilter } from "@/lib/subject";
import { INSIGHT_WINDOW_DAYS } from "@/lib/class-insights";

/**
 * GET /api/secondary-teacher/classes
 *
 * Cohort insights for a grades 9-12 teacher: one entry per class they teach —
 * a (subject, grade, section) triple — never a merged view. A grade 9 Maths
 * section and a grade 10 Physics section share no students and no topics, so a
 * single blended average across them would be meaningless.
 *
 * Scoping rules — all four must hold for a student's answer to be counted:
 *   1. the student belongs to the teacher's own school;
 *   2. the student's ENROLMENT grade equals the class's grade;
 *   3. the student is in the class's SECTION;
 *   4. the answered question came from a textbook in the class's subject.
 *
 * This is an OR over exact (subject, grade, section) triples, never a product
 * of {grades} x {subjects} x {sections}: a teacher holding Maths/G9/A and
 * Physics/G10/C must not see Physics/G9/A or Maths/G10/C. Building each
 * class's cohort separately is what guarantees that.
 *
 * A row with a null section means "every section of that grade" — that is
 * what the rows written before sections existed mean, and they are honoured
 * rather than silently dropped.
 *
 * Subject is matched case-insensitively against `Textbook.subject`. Both are
 * free text with no foreign key between them, so a textbook filed as
 * "Biology" against a class recorded as "biology" used to yield an empty
 * cohort with nothing to show the teacher why.
 */

/** How far back a cohort view looks — shared with the student page. */
const WINDOW_DAYS = INSIGHT_WINDOW_DAYS;

/** Hard ceiling on answers scanned per pair, newest first. */
const MAX_ANSWERS_PER_CLASS = 5000;

/** A chapter needs at least this many answers before it can be called weak. */
const MIN_ANSWERS_FOR_CHAPTER = 10;

interface ChapterStat {
  id: string;
  title: string;
  chapterNumber: number;
  answered: number;
  correct: number;
}

interface StudentStat {
  answered: number;
  correct: number;
}

export async function GET(req: Request) {
  const user = await getCurrentUser();
  if (!user || user.role !== "SECONDARY_TEACHER") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  }
  if (!user.schoolId) {
    return NextResponse.json(
      { error: "Your account is not linked to a school yet." },
      { status: 403 },
    );
  }

  const rl = rateLimit("secondary-teacher:classes:" + user.id, 60, 60_000);
  if (!rl.success) {
    return NextResponse.json(
      { error: "Too many requests. Please slow down." },
      { status: 429, headers: { "Retry-After": String(rl.retryAfter) } },
    );
  }

  const assignments = await db.teachingAssignment.findMany({
    where: { teacherId: user.id },
    orderBy: [{ grade: "asc" }, { subject: "asc" }, { section: "asc" }],
    select: { id: true, subject: true, grade: true, section: true },
  });

  // Defence in depth: the write path already restricts this role to grades
  // 9-12, so anything outside that band is stale data and is ignored rather
  // than silently widening what this teacher can read.
  const inBand = assignments.filter(isFullClass).filter((a) => isSecondaryGrade(a.grade));

  if (inBand.length === 0) {
    return NextResponse.json({
      school: { id: user.schoolId },
      classes: [],
      windowDays: WINDOW_DAYS,
    });
  }

  const since = new Date(Date.now() - WINDOW_DAYS * 24 * 60 * 60 * 1000);

  // `?lite=1` — just the class list and head counts, for pickers (assistant,
  // "give to class"). Those used to call this route in full, computing every
  // class's answer analytics only to fill a dropdown.
  const lite = new URL(req.url).searchParams.get("lite") === "1";

  // One roster query for every grade this teacher touches, then split per pair.
  const grades = Array.from(new Set(inBand.map((a) => a.grade)));
  const roster = await db.user.findMany({
    where: {
      role: "STUDENT",
      isActive: true,
      schoolId: user.schoolId,
      grade: { in: grades },
    },
    select: {
      id: true,
      name: true,
      grade: true,
      section: true,
      lastActiveAt: true,
    },
    orderBy: { name: "asc" },
  });

  const byGrade = new Map<number, typeof roster>();
  for (const student of roster) {
    if (student.grade === null) continue;
    const list = byGrade.get(student.grade);
    if (list) list.push(student);
    else byGrade.set(student.grade, [student]);
  }

  const classes = [];

  if (lite) {
    for (const pair of inBand) {
      const inGrade = byGrade.get(pair.grade) ?? [];
      const studentCount = pair.section
        ? inGrade.filter((s) => s.section === pair.section).length
        : inGrade.length;
      classes.push({
        id: pair.id,
        subject: pair.subject,
        grade: pair.grade,
        section: pair.section,
        studentCount,
      });
    }
    return NextResponse.json({ school: { id: user.schoolId }, classes, windowDays: WINDOW_DAYS });
  }

  for (const pair of inBand) {
    const inGrade = byGrade.get(pair.grade) ?? [];
    // Narrow to the section this teacher actually takes. Student sections are
    // stored normalised, so an exact comparison is the right test here.
    const students = pair.section
      ? inGrade.filter((s) => s.section === pair.section)
      : inGrade;
    const studentIds = students.map((s) => s.id);

    if (studentIds.length === 0) {
      classes.push({
        id: pair.id,
        subject: pair.subject,
        grade: pair.grade,
        section: pair.section,
        studentCount: 0,
        activeStudents: 0,
        answered: 0,
        accuracy: null,
        weakChapters: [],
        students: [],
      });
      continue;
    }

    const answers = await db.quizAnswer.findMany({
      where: {
        quiz: { studentId: { in: studentIds }, startedAt: { gte: since } },
        question: {
          chapter: { textbook: { subject: subjectFilter(pair.subject) } },
        },
      },
      take: MAX_ANSWERS_PER_CLASS,
      orderBy: { id: "desc" },
      select: {
        isCorrect: true,
        quiz: { select: { studentId: true } },
        question: {
          select: {
            chapter: { select: { id: true, title: true, chapterNumber: true } },
          },
        },
      },
    });

    const perStudent = new Map<string, StudentStat>();
    const perChapter = new Map<string, ChapterStat>();
    let correct = 0;

    for (const a of answers) {
      if (a.isCorrect) correct++;

      const sid = a.quiz.studentId;
      const s = perStudent.get(sid) ?? { answered: 0, correct: 0 };
      s.answered++;
      if (a.isCorrect) s.correct++;
      perStudent.set(sid, s);

      const ch = a.question?.chapter;
      if (ch) {
        const c =
          perChapter.get(ch.id) ?? {
            id: ch.id,
            title: ch.title,
            chapterNumber: ch.chapterNumber,
            answered: 0,
            correct: 0,
          };
        c.answered++;
        if (a.isCorrect) c.correct++;
        perChapter.set(ch.id, c);
      }
    }

    // ── Work this teacher set the class: completion, and marks on written
    //    work. Marked work counts toward a student's standing — a quiz-only
    //    figure showed a student scoring 23/25 and 18/20 as 40%. ──────────
    const activities = await db.classActivity.findMany({
      // Not "publishedAt set": work published before that column existed
      // has status PUBLISHED and a null publishedAt, and was being skipped.
      where: { teachingAssignmentId: pair.id, createdAt: { gte: since }, status: { not: "DRAFT" } },
      select: {
        id: true,
        format: true,
        maxMarks: true,
        targets: {
          where: { studentId: { in: studentIds } },
          select: { studentId: true, completedAt: true, submittedAt: true, markedAt: true, marks: true },
        },
      },
    });
    const paperIds = activities.filter((a) => a.format !== "DOCUMENT").map((a) => a.id);
    const finishedPapers = paperIds.length
      ? await db.quiz.findMany({
          where: { activityId: { in: paperIds }, studentId: { in: studentIds }, completedAt: { not: null } },
          select: { activityId: true, studentId: true },
        })
      : [];
    const paperDone = new Set(finishedPapers.map((q) => `${q.activityId}:${q.studentId}`));

    const work = new Map<string, { assigned: number; done: number; marks: number; max: number; marked: number }>();
    for (const a of activities) {
      for (const t of a.targets) {
        const w = work.get(t.studentId) ?? { assigned: 0, done: 0, marks: 0, max: 0, marked: 0 };
        w.assigned++;
        const done =
          a.format === "DOCUMENT"
            ? Boolean(t.completedAt || t.submittedAt || t.markedAt)
            : paperDone.has(`${a.id}:${t.studentId}`);
        if (done) w.done++;
        if (a.format === "DOCUMENT" && t.markedAt && t.marks !== null && (a.maxMarks ?? 0) > 0) {
          w.marks += t.marks;
          w.max += a.maxMarks!;
          w.marked++;
        }
        work.set(t.studentId, w);
      }
    }

    const weakChapters = Array.from(perChapter.values())
      .filter((c) => c.answered >= MIN_ANSWERS_FOR_CHAPTER)
      .map((c) => ({
        id: c.id,
        title: c.title,
        chapterNumber: c.chapterNumber,
        answered: c.answered,
        accuracy: c.correct / c.answered,
      }))
      .sort((a, b) => a.accuracy - b.accuracy)
      .slice(0, 5);

    const studentRows = students
      .map((s) => {
        const stat = perStudent.get(s.id);
        const w = work.get(s.id);
        return {
          id: s.id,
          name: s.name,
          section: s.section,
          lastActiveAt: s.lastActiveAt,
          answered: stat?.answered ?? 0,
          accuracy: stat && stat.answered > 0 ? stat.correct / stat.answered : null,
          workAssigned: w?.assigned ?? 0,
          workDone: w?.done ?? 0,
          markedCount: w?.marked ?? 0,
          markedAverage: w && w.max > 0 ? w.marks / w.max : null,
        };
      })
      // Students with no activity sort last; the rest weakest-first, which is
      // the order a teacher actually wants to act on.
      .sort((a, b) => {
        if (a.accuracy === null && b.accuracy === null) return a.name.localeCompare(b.name);
        if (a.accuracy === null) return 1;
        if (b.accuracy === null) return -1;
        return a.accuracy - b.accuracy;
      });

    classes.push({
      id: pair.id,
      subject: pair.subject,
      grade: pair.grade,
      section: pair.section,
      studentCount: students.length,
      activeStudents: perStudent.size,
      answered: answers.length,
      accuracy: answers.length > 0 ? correct / answers.length : null,
      weakChapters,
      students: studentRows,
    });
  }

  return NextResponse.json({
    school: { id: user.schoolId },
    classes,
    windowDays: WINDOW_DAYS,
  });
}
