import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getCurrentUser } from "@/lib/get-session";
import { normalizeOption } from "@/lib/utils";
import { getEntitlements, UPGRADE_MESSAGES } from "@/lib/entitlements";

function generateRoomCode(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "";
  for (let i = 0; i < 6; i++) {
    code += chars[Math.floor(Math.random() * chars.length)];
  }
  return code;
}

// POST /api/battles — Create a battle room
export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const ent = await getEntitlements(user);
  if (!ent.multiplayer) {
    return NextResponse.json(
      { error: UPGRADE_MESSAGES.multiplayer, code: "UPGRADE_REQUIRED" },
      { status: 403 }
    );
  }

  try {
    const body = await request.json();
    const { subject, questionCount = 10 } = body as {
      subject: string;
      questionCount: number;
    };

    // Grade is ALWAYS the student's own profile grade — never trust the client.
    const grade = (user as { grade?: number | null }).grade ?? null;

    if (!subject) {
      return NextResponse.json({ error: "Subject is required" }, { status: 400 });
    }
    if (!grade) {
      return NextResponse.json(
        { error: "Your profile has no grade set. Complete your profile first." },
        { status: 400 }
      );
    }

    // Gather all COMPLETED textbooks for this exact subject + the student's grade.
    // (findMany, not findFirst, so the pool matches the count from /options,
    // which sums across every textbook for the subject.)
    const textbooks = await db.textbook.findMany({
      where: {
        subject: { equals: subject, mode: "insensitive" },
        grade,
        processingStatus: "COMPLETED",
      },
      include: { chapters: { select: { id: true } } },
    });

    const chapterIds = textbooks.flatMap((t) => t.chapters.map((c) => c.id));

    if (chapterIds.length === 0) {
      return NextResponse.json(
        { error: "No questions available for this subject and grade" },
        { status: 404 }
      );
    }

    // Fetch questions with correctAnswer included (for in-memory socket validation)
    const allQuestions = await db.question.findMany({
      where: {
        chapterId: { in: chapterIds },
        type: "MCQ",
        status: "PUBLISHED",
      },
      select: {
        id: true,
        questionText: true,
        options: true,
        correctAnswer: true,
      },
    });

    if (allQuestions.length === 0) {
      return NextResponse.json(
        { error: "No MCQ questions available for this selection" },
        { status: 404 }
      );
    }

    // Fisher-Yates shuffle
    const shuffled = [...allQuestions];
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }

    const selected = shuffled.slice(0, Math.min(questionCount, shuffled.length));

    // Build question objects with correctIndex for socket server.
    // Normalize options: DB may store them as plain strings OR as {text, label} objects.
    const questionsWithIndex = selected.map((q) => {
      const options = (q.options as unknown[]).map(normalizeOption);
      const normalizedAnswer = normalizeOption(q.correctAnswer as unknown);
      const correctIndex = options.indexOf(normalizedAnswer);
      return {
        id: q.id,
        question: q.questionText,
        options,
        correctIndex: correctIndex >= 0 ? correctIndex : 0,
      };
    });

    // Generate unique room code
    let roomCode = generateRoomCode();
    let attempts = 0;
    while (attempts < 10) {
      const existing = await db.gameRoom.findUnique({ where: { roomCode } });
      if (!existing) break;
      roomCode = generateRoomCode();
      attempts++;
    }

    // Create GameRoom in DB
    const gameRoom = await db.gameRoom.create({
      data: {
        roomCode,
        hostUserId: user.id,
        status: "WAITING",
        maxPlayers: 8,
        quizConfig: {
          subject,
          grade,
          questionCount: questionsWithIndex.length,
          textbookId: textbooks[0]?.id ?? null,
          questions: questionsWithIndex,
        },
      },
    });

    // Add host as first player
    await db.gamePlayer.create({
      data: {
        userId: user.id,
        gameRoomId: gameRoom.id,
        score: 0,
      },
    });

    // Return questions WITHOUT correctIndex — answers stay server-side only.
    // The socket server loads questions (with correctIndex) directly from the
    // DB when the host calls create_room, so the client never sees answers.
    return NextResponse.json({
      roomCode,
      roomId: gameRoom.id,
      questions: questionsWithIndex.map(({ correctIndex: _, ...q }) => q),
      subject,
      grade,
      questionCount: questionsWithIndex.length,
    });
  } catch (error) {
    console.error("Battle creation error:", error);
    return NextResponse.json(
      { error: "Failed to create battle room" },
      { status: 500 }
    );
  }
}

// GET /api/battles?roomCode=XXXXXX — Get room info
export async function GET(request: Request) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const ent = await getEntitlements(user);
  if (!ent.multiplayer) {
    return NextResponse.json(
      { error: UPGRADE_MESSAGES.multiplayer, code: "UPGRADE_REQUIRED" },
      { status: 403 }
    );
  }

  const { searchParams } = new URL(request.url);
  const roomCode = searchParams.get("roomCode");

  if (!roomCode) {
    return NextResponse.json({ error: "roomCode is required" }, { status: 400 });
  }

  try {
    const room = await db.gameRoom.findUnique({
      where: { roomCode },
      include: {
        players: {
          include: {
            user: {
              select: {
                id: true,
                name: true,
                avatarUrl: true,
                grade: true,
              },
            },
          },
          orderBy: { joinedAt: "asc" },
        },
        host: {
          select: {
            id: true,
            name: true,
            avatarUrl: true,
          },
        },
      },
    });

    if (!room) {
      return NextResponse.json({ error: "Room not found" }, { status: 404 });
    }

    if (room.status === "ACTIVE") {
      return NextResponse.json({ error: "Game already in progress" }, { status: 409 });
    }

    return NextResponse.json({ room });
  } catch (error) {
    console.error("Battle fetch error:", error);
    return NextResponse.json(
      { error: "Failed to fetch room info" },
      { status: 500 }
    );
  }
}
