import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getCurrentUser } from "@/lib/get-session";

const DEFAULTS = {
  maxPlayersPerRoom: 20,
  timePerQuestion: 20,
  defaultDifficulty: "MEDIUM",
  difficultyLocked: false,
  minPlayersToStart: 2,
};

export async function GET() {
  const user = await getCurrentUser();

  if (!user || !["SUPER_ADMIN", "SCHOOL_ADMIN"].includes(user.role)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  }

  if (!user.schoolId) {
    return NextResponse.json({ error: "No school associated with this account" }, { status: 400 });
  }

  const config = await db.gameConfig.findUnique({
    where: { schoolId: user.schoolId },
  });

  if (!config) {
    return NextResponse.json({ config: DEFAULTS });
  }

  return NextResponse.json({ config });
}

interface UpdateConfigBody {
  maxPlayersPerRoom?: number;
  timePerQuestion?: number;
  defaultDifficulty?: string;
  difficultyLocked?: boolean;
  minPlayersToStart?: number;
}

export async function PUT(request: NextRequest) {
  return handleUpsert(request);
}

export async function PATCH(request: NextRequest) {
  return handleUpsert(request);
}

async function handleUpsert(request: NextRequest) {
  const user = await getCurrentUser();

  if (!user || !["SUPER_ADMIN", "SCHOOL_ADMIN"].includes(user.role)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  }

  if (!user.schoolId) {
    return NextResponse.json({ error: "No school associated with this account" }, { status: 400 });
  }

  let body: UpdateConfigBody;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (body.maxPlayersPerRoom !== undefined) {
    if (typeof body.maxPlayersPerRoom !== "number" || body.maxPlayersPerRoom < 2 || body.maxPlayersPerRoom > 50) {
      return NextResponse.json({ error: "maxPlayersPerRoom must be between 2 and 50" }, { status: 400 });
    }
  }

  if (body.timePerQuestion !== undefined) {
    if (typeof body.timePerQuestion !== "number" || body.timePerQuestion < 10 || body.timePerQuestion > 60) {
      return NextResponse.json({ error: "timePerQuestion must be between 10 and 60" }, { status: 400 });
    }
  }

  if (body.defaultDifficulty !== undefined) {
    const validDifficulties = ["EASY", "MEDIUM", "HARD"];
    if (!validDifficulties.includes(body.defaultDifficulty)) {
      return NextResponse.json({ error: "defaultDifficulty must be EASY, MEDIUM, or HARD" }, { status: 400 });
    }
  }

  if (body.difficultyLocked !== undefined) {
    if (typeof body.difficultyLocked !== "boolean") {
      return NextResponse.json({ error: "difficultyLocked must be a boolean" }, { status: 400 });
    }
  }

  if (body.minPlayersToStart !== undefined) {
    if (typeof body.minPlayersToStart !== "number" || body.minPlayersToStart < 1 || body.minPlayersToStart > 10) {
      return NextResponse.json({ error: "minPlayersToStart must be between 1 and 10" }, { status: 400 });
    }
  }

  const config = await db.gameConfig.upsert({
    where: { schoolId: user.schoolId },
    update: {
      ...(body.maxPlayersPerRoom !== undefined && { maxPlayersPerRoom: body.maxPlayersPerRoom }),
      ...(body.timePerQuestion !== undefined && { timePerQuestion: body.timePerQuestion }),
      ...(body.defaultDifficulty !== undefined && { defaultDifficulty: body.defaultDifficulty as any }),
      ...(body.difficultyLocked !== undefined && { difficultyLocked: body.difficultyLocked }),
      ...(body.minPlayersToStart !== undefined && { minPlayersToStart: body.minPlayersToStart }),
    },
    create: {
      schoolId: user.schoolId,
      maxPlayersPerRoom: body.maxPlayersPerRoom ?? DEFAULTS.maxPlayersPerRoom,
      timePerQuestion: body.timePerQuestion ?? DEFAULTS.timePerQuestion,
      defaultDifficulty: (body.defaultDifficulty as any) ?? DEFAULTS.defaultDifficulty,
      difficultyLocked: body.difficultyLocked ?? DEFAULTS.difficultyLocked,
      minPlayersToStart: body.minPlayersToStart ?? DEFAULTS.minPlayersToStart,
    },
  });

  return NextResponse.json({ config });
}
