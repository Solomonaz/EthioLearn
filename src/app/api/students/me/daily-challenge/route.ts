import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { challengeChapters, challengeDoneToday, DAILY_CHALLENGE_QUESTIONS, getTodayRange, subjectsOf, todaysChallenge } from "@/lib/daily-challenge";
import { requireCompleteProfile } from "@/lib/get-session";
import { featureDenial } from "@/lib/entitlements";
import { validateCsrfOrigin } from "@/lib/csrf";

/**
 * The daily challenge: 5 questions from one chapter of the student's grade.
 *
 * The student chooses the subjects they study (saved on their account, so a
 * natural-science student never gets History unless they pick it); none =
 * any subject. Each day rotates among them (lib/daily-challenge), stable for
 * the day so reloading doesn't reshuffle it.
 *
 * GET   → { completed, subjects, chosenSubjects, … } plus today's chapter when
 *         not completed (the subjects come back either way, so tomorrow's can
 *         be changed after today's is done).
 * PATCH { subjects: string[] } → save the choice ([] = any subject).
 *       ({ subject: string | null } from older pages still works.)
 */

export async function GET() {
  const user = await requireCompleteProfile();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const featureRefusal = await featureDenial(user, "dailyChallenge");
  if (featureRefusal) return featureRefusal;

  const { today, tomorrow } = getTodayRange();

  const todayEntry = await db.pointLedger.findFirst({
    where: {
      userId: user.id,
      actionType: "DAILY_CHALLENGE",
      createdAt: { gte: today, lt: tomorrow },
    },
  });

  const pick = await todaysChallenge(user);
  if (!pick) {
    return NextResponse.json({ completed: false, chapterId: null, subjects: [], chosenSubjects: [] });
  }
  const { chapter, subjects, chosen } = pick;
  const choice = { subjects, chosenSubjects: chosen };

  if (todayEntry) {
    return NextResponse.json({ completed: true, pointsEarned: 50, ...choice });
  }
  // Taken today without earning the bonus still uses up today's challenge.
  if (await challengeDoneToday(user.id)) {
    return NextResponse.json({ completed: true, pointsEarned: 0, ...choice });
  }

  return NextResponse.json({
    completed: false,
    chapterId: chapter.id,
    chapterTitle: chapter.title,
    subject: chapter.textbook.subject,
    ...choice,
    questionCount: DAILY_CHALLENGE_QUESTIONS,
  });
}

export async function PATCH(request: Request) {
  const user = await requireCompleteProfile();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const featureRefusal = await featureDenial(user, "dailyChallenge");
  if (featureRefusal) return featureRefusal;
  if (!validateCsrfOrigin(request)) {
    return NextResponse.json({ error: "Invalid request origin" }, { status: 403 });
  }
  const body = (await request.json().catch(() => null)) as { subjects?: unknown; subject?: unknown } | null;
  // New pages send a list; an older page may still send one subject or null.
  const raw = Array.isArray(body?.subjects)
    ? body.subjects
    : body && "subject" in body
      ? body.subject === null ? [] : [body.subject]
      : null;
  if (!raw || raw.length > 30 || raw.some((s) => typeof s !== "string" || s.length > 100)) {
    return NextResponse.json({ error: "Choose your subjects." }, { status: 400 });
  }
  const available = subjectsOf(await challengeChapters(user));
  const subjects = [...new Set(raw as string[])];
  if (subjects.some((s) => !available.includes(s))) {
    return NextResponse.json({ error: "That subject has no challenge questions for your grade." }, { status: 400 });
  }
  if (user.id === "env_super_admin") return NextResponse.json({ subjects });
  await db.user.update({
    where: { id: user.id },
    data: { dailyChallengeSubjects: subjects, dailyChallengeSubject: null },
  });
  return NextResponse.json({ subjects });
}

// No POST: the challenge bonus is paid by quiz submit (POST /api/quizzes/[id]/submit)
// for a server-recognised daily-challenge quiz — never on the client's word.
