import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getCurrentUser } from "@/lib/get-session";
import { validateCsrfOrigin } from "@/lib/csrf";

interface RouteParams {
  params: Promise<{ id: string }>;
}

const VALID_STATUS_TRANSITIONS: Record<string, string[]> = {
  DRAFT: ["SCHEDULED", "CANCELLED"],
  SCHEDULED: ["ACTIVE", "CANCELLED"],
  ACTIVE: ["COMPLETED", "CANCELLED"],
  COMPLETED: [],
  CANCELLED: [],
};

export async function GET(_request: NextRequest, { params }: RouteParams) {
  const user = await getCurrentUser();

  if (!user || !["SUPER_ADMIN", "SCHOOL_ADMIN"].includes(user.role)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  }

  if (user.role === "SCHOOL_ADMIN" && !user.schoolId) {
    return NextResponse.json({ error: "No school associated with this account" }, { status: 400 });
  }

  const { id } = await params;

  const tournament = await db.tournament.findUnique({
    where: { id },
    include: {
      rounds: {
        orderBy: { roundNumber: "asc" },
        include: {
          gameRoom: {
            include: {
              players: true,
            },
          },
        },
      },
    },
  });

  if (!tournament) {
    return NextResponse.json({ error: "Tournament not found" }, { status: 404 });
  }

  if (user.role === "SCHOOL_ADMIN" && tournament.schoolId !== user.schoolId) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  return NextResponse.json({ tournament });
}

interface UpdateTournamentBody {
  name?: string;
  description?: string;
  status?: string;
  competitionStart?: string;
  competitionEnd?: string;
  maxPlayers?: number;
  subject?: string;
  grade?: string;
  difficulty?: string;
  rules?: any;
}

export async function PATCH(request: NextRequest, { params }: RouteParams) {
  const user = await getCurrentUser();

  if (!user || !["SUPER_ADMIN", "SCHOOL_ADMIN"].includes(user.role)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  }

  if (!validateCsrfOrigin(request)) {
    return NextResponse.json({ error: "Invalid request origin" }, { status: 403 });
  }

  if (user.role === "SCHOOL_ADMIN" && !user.schoolId) {
    return NextResponse.json({ error: "No school associated with this account" }, { status: 400 });
  }

  const { id } = await params;

  const existing = await db.tournament.findUnique({ where: { id } });

  if (!existing) {
    return NextResponse.json({ error: "Tournament not found" }, { status: 404 });
  }

  if (user.role === "SCHOOL_ADMIN" && existing.schoolId !== user.schoolId) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  let body: UpdateTournamentBody;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const updateData: Record<string, any> = {};

  if (body.name !== undefined) {
    if (typeof body.name !== "string" || body.name.trim() === "") {
      return NextResponse.json({ error: "Name cannot be empty" }, { status: 400 });
    }
    updateData.name = body.name.trim();
  }

  if (body.description !== undefined) {
    updateData.description = body.description?.trim() || null;
  }

  if (body.status !== undefined) {
    const validStatuses = ["DRAFT", "SCHEDULED", "ACTIVE", "COMPLETED", "CANCELLED"];
    if (!validStatuses.includes(body.status)) {
      return NextResponse.json({ error: "Invalid status" }, { status: 400 });
    }

    const allowedTransitions = VALID_STATUS_TRANSITIONS[existing.status] || [];
    if (!allowedTransitions.includes(body.status)) {
      return NextResponse.json(
        { error: `Cannot transition from ${existing.status} to ${body.status}` },
        { status: 400 }
      );
    }
    updateData.status = body.status;
  }

  if (body.competitionStart !== undefined) {
    updateData.competitionStart = body.competitionStart ? new Date(body.competitionStart) : null;
  }

  if (body.competitionEnd !== undefined) {
    updateData.competitionEnd = body.competitionEnd ? new Date(body.competitionEnd) : null;
  }

  if (body.maxPlayers !== undefined) {
    if (typeof body.maxPlayers !== "number" || body.maxPlayers < 2) {
      return NextResponse.json({ error: "maxPlayers must be at least 2" }, { status: 400 });
    }
    updateData.maxPlayers = body.maxPlayers;
  }

  if (body.subject !== undefined) {
    updateData.subject = body.subject?.trim() || null;
  }

  if (body.grade !== undefined) {
    updateData.grade = body.grade?.trim() || null;
  }

  if (body.difficulty !== undefined) {
    const validDifficulties = ["EASY", "MEDIUM", "HARD"];
    if (body.difficulty && !validDifficulties.includes(body.difficulty)) {
      return NextResponse.json({ error: "Invalid difficulty. Must be EASY, MEDIUM, or HARD" }, { status: 400 });
    }
    updateData.difficulty = body.difficulty || null;
  }

  if (body.rules !== undefined) {
    updateData.rules = body.rules;
  }

  const tournament = await db.tournament.update({
    where: { id },
    data: updateData,
  });

  return NextResponse.json({ tournament });
}

export async function DELETE(_request: NextRequest, { params }: RouteParams) {
  const user = await getCurrentUser();

  if (!user || !["SUPER_ADMIN", "SCHOOL_ADMIN"].includes(user.role)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  }

  if (!validateCsrfOrigin(_request)) {
    return NextResponse.json({ error: "Invalid request origin" }, { status: 403 });
  }

  if (user.role === "SCHOOL_ADMIN" && !user.schoolId) {
    return NextResponse.json({ error: "No school associated with this account" }, { status: 400 });
  }

  const { id } = await params;

  const existing = await db.tournament.findUnique({
    where: { id },
    include: { rounds: true },
  });

  if (!existing) {
    return NextResponse.json({ error: "Tournament not found" }, { status: 404 });
  }

  if (user.role === "SCHOOL_ADMIN" && existing.schoolId !== user.schoolId) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  if (!["DRAFT", "CANCELLED"].includes(existing.status)) {
    return NextResponse.json(
      { error: "Can only delete tournaments in DRAFT or CANCELLED status" },
      { status: 400 }
    );
  }

  // Delete rounds first, then the tournament
  await db.tournamentRound.deleteMany({ where: { tournamentId: id } });
  await db.tournament.delete({ where: { id } });

  return NextResponse.json({ success: true });
}
