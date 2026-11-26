import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { challengeChapters, challengeDoneToday, DAILY_CHALLENGE_QUESTIONS, getTodayRange, subjectsOf, todaysChallenge } from "@/lib/daily-challenge";
import { requireCompleteProfile } from "@/lib/get-session";
import { featureDenial } from "@/lib/entitlements";
import { validateCsrfOrigin } from "@/lib/csrf";

/**
 * The daily challenge: 5 questions from one chapter of the student's grade.
 *
 * The student chooses the subject (saved on their account, so a Natural
 * science student never gets Economics unless they pick it); null = any
 * subject. The chapter is picked from that subject by a hash of the student,
 * the day and the subject, so reloading the page doesn't reshuffle it.
 *
 * GET   → { completed } or { chapterId, chapterTitle, subject, subjects, chosenSubject }
 * PATCH { subject: string | null } → save the subject choice.
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

  if (todayEntry) {
    return NextResponse.json({ completed: true, pointsEarned: 50 });
  }
  // Taken today without earning the bonus still uses up today's challenge.
  if (await challengeDoneToday(user.id)) {
    return NextResponse.json({ completed: true, pointsEarned: 0 });
  }

  const pick = await todaysChallenge(user);
  if (!pick) {
    return NextResponse.json({ completed: false, chapterId: null });
  }
  const { chapter, subjects, chosen } = pick;

  return NextResponse.json({
    completed: false,
    chapterId: chapter.id,
    chapterTitle: chapter.title,
    subject: chapter.textbook.subject,
    subjects,
    chosenSubject: chosen,
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
  const body = (await request.json().catch(() => null)) as { subject?: unknown } | null;
  const subject = body?.subject;
  if (subject !== null && (typeof subject !== "string" || subject.length > 100)) {
    return NextResponse.json({ error: "Choose a subject." }, { status: 400 });
  }
  if (subject !== null && !subjectsOf(await challengeChapters(user)).includes(subject)) {
    return NextResponse.json({ error: "That subject has no challenge questions for your grade." }, { status: 400 });
  }
  if (user.id === "env_super_admin") return NextResponse.json({ subject });
  await db.user.update({ where: { id: user.id }, data: { dailyChallengeSubject: subject } });
  return NextResponse.json({ subject });
}

// No POST: the challenge bonus is paid by quiz submit (POST /api/quizzes/[id]/submit)
// for a server-recognised daily-challenge quiz — never on the client's word.
