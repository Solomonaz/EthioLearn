import crypto from "node:crypto";
import { NextResponse } from "next/server";
import { db } from "@/lib/db";
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
 * POST  → record today's challenge as done (bonus points).
 */

function getTodayRange() {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);
  return { today, tomorrow };
}

/** The grade's chapters that have questions, with their subject. */
async function challengeChapters(grade: number | null) {
  return db.chapter.findMany({
    where: {
      questionCount: { gt: 0 },
      textbook: { processingStatus: "COMPLETED", grade: grade ?? undefined },
    },
    select: { id: true, title: true, textbook: { select: { subject: true } } },
    orderBy: { id: "asc" },
  });
}

function subjectsOf(chapters: { textbook: { subject: string } }[]): string[] {
  return [...new Set(chapters.map((c) => c.textbook.subject))].sort((a, b) => a.localeCompare(b));
}

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

  const [chapters, me] = await Promise.all([
    challengeChapters(user.grade ?? null),
    db.user.findUnique({ where: { id: user.id }, select: { dailyChallengeSubject: true } }),
  ]);
  if (chapters.length === 0) {
    return NextResponse.json({ completed: false, chapterId: null });
  }

  const subjects = subjectsOf(chapters);
  // A saved subject that no longer has questions falls back to any subject.
  const chosen = me?.dailyChallengeSubject && subjects.includes(me.dailyChallengeSubject) ? me.dailyChallengeSubject : null;
  const pool = chosen ? chapters.filter((c) => c.textbook.subject === chosen) : chapters;
  const dayKey = `${today.getFullYear()}-${today.getMonth() + 1}-${today.getDate()}`;
  const hash = crypto.createHash("sha256").update(`${user.id}|${dayKey}|${chosen ?? "*"}`).digest();
  const chapter = pool[hash.readUInt32BE(0) % pool.length];

  return NextResponse.json({
    completed: false,
    chapterId: chapter.id,
    chapterTitle: chapter.title,
    subject: chapter.textbook.subject,
    subjects,
    chosenSubject: chosen,
    questionCount: 5,
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
  if (subject !== null && !subjectsOf(await challengeChapters(user.grade ?? null)).includes(subject)) {
    return NextResponse.json({ error: "That subject has no challenge questions for your grade." }, { status: 400 });
  }
  if (user.id === "env_super_admin") return NextResponse.json({ subject });
  await db.user.update({ where: { id: user.id }, data: { dailyChallengeSubject: subject } });
  return NextResponse.json({ subject });
}

export async function POST(request: Request) {
  const user = await requireCompleteProfile();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const featureRefusal = await featureDenial(user, "dailyChallenge");
  if (featureRefusal) return featureRefusal;

  if (!validateCsrfOrigin(request)) {
    return NextResponse.json({ error: "Invalid request origin" }, { status: 403 });
  }

  const { today, tomorrow } = getTodayRange();

  let body: { score?: number } = {};
  try {
    const text = await request.text();
    if (text) body = JSON.parse(text);
  } catch (e) {
    // No body or invalid json
  }
  const { score }: { score?: number } = body;

  if (score !== undefined && score < 60) {
     return NextResponse.json({ message: "Quiz completed, but score too low for bonus." }, { status: 200 });
  }

  const todayEntry = await db.pointLedger.findFirst({
    where: {
      userId: user.id,
      actionType: "DAILY_CHALLENGE",
      createdAt: { gte: today, lt: tomorrow },
    },
  });

  if (todayEntry) {
    return NextResponse.json({ error: "Already completed today" }, { status: 400 });
  }

  await db.pointLedger.create({
    data: {
      userId: user.id,
      actionType: "DAILY_CHALLENGE",
      points: 50,
      description: "Daily challenge completed",
    },
  });

  await db.user.update({
    where: { id: user.id },
    data: {
      totalPoints: { increment: 50 },
      lastActiveAt: new Date(),
    },
  });

  return NextResponse.json({ success: true, pointsEarned: 50 });
}
