import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireCompleteProfile } from "@/lib/get-session";
import { validateCsrfOrigin } from "@/lib/csrf";

function getTodayRange() {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);
  return { today, tomorrow };
}

export async function GET() {
  const user = await requireCompleteProfile();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

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

  // Pick a random chapter from completed textbooks that have questions
  const chapters = await db.chapter.findMany({
    where: {
      questionCount: { gt: 0 },
      textbook: { 
        processingStatus: "COMPLETED",
        grade: user.grade ?? undefined
      },
    },
    select: {
      id: true,
      title: true,
      questionCount: true,
      textbook: { select: { subject: true } },
    },
  });

  if (chapters.length === 0) {
    return NextResponse.json({ completed: false, chapterId: null });
  }

  const randomChapter = chapters[Math.floor(Math.random() * chapters.length)];

  return NextResponse.json({
    completed: false,
    chapterId: randomChapter.id,
    chapterTitle: randomChapter.title,
    subject: randomChapter.textbook.subject,
    questionCount: 5,
  });
}

export async function POST(request: Request) {
  const user = await requireCompleteProfile();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

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
