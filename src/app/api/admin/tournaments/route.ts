import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getCurrentUser } from "@/lib/get-session";
import { validateCsrfOrigin } from "@/lib/csrf";

export async function GET(request: NextRequest) {
  const user = await getCurrentUser();

  if (!user || !["SUPER_ADMIN", "SCHOOL_ADMIN"].includes(user.role)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  }

  if (user.role === "SCHOOL_ADMIN" && !user.schoolId) {
    return NextResponse.json({ error: "No school associated with this account" }, { status: 400 });
  }

  const { searchParams } = new URL(request.url);
  const targetSchoolId = user.schoolId || searchParams.get("schoolId");
  const status = searchParams.get("status");

  const where: any = {
    ...(targetSchoolId ? { schoolId: targetSchoolId } : {}),
  };

  if (status) {
    const validStatuses = ["DRAFT", "SCHEDULED", "ACTIVE", "COMPLETED", "CANCELLED"];
    if (!validStatuses.includes(status)) {
      return NextResponse.json({ error: "Invalid status filter" }, { status: 400 });
    }
    where.status = status;
  }

  const tournaments = await db.tournament.findMany({
    where,
    orderBy: { createdAt: "desc" },
    include: {
      _count: {
        select: { rounds: true },
      },
    },
  });

  return NextResponse.json({ tournaments });
}

interface CreateTournamentBody {
  name?: string;
  description?: string;
  competitionStart?: string;
  competitionEnd?: string;
  maxPlayers?: number;
  subject?: string;
  grade?: string;
  difficulty?: string;
  rules?: any;
  schoolId?: string;
}

export async function POST(request: NextRequest) {
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

  let body: CreateTournamentBody;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { name, description, competitionStart, competitionEnd, maxPlayers, subject, grade, difficulty, rules } = body;

  if (!name || typeof name !== "string" || name.trim() === "") {
    return NextResponse.json({ error: "Name is required" }, { status: 400 });
  }

  if (maxPlayers !== undefined && (typeof maxPlayers !== "number" || maxPlayers < 2)) {
    return NextResponse.json({ error: "maxPlayers must be at least 2" }, { status: 400 });
  }

  if (difficulty) {
    const validDifficulties = ["EASY", "MEDIUM", "HARD"];
    if (!validDifficulties.includes(difficulty)) {
      return NextResponse.json({ error: "Invalid difficulty. Must be EASY, MEDIUM, or HARD" }, { status: 400 });
    }
  }

  let targetSchoolId = user.schoolId || body.schoolId;
  if (!targetSchoolId && user.role === "SUPER_ADMIN") {
    targetSchoolId = (await db.school.findFirst({ select: { id: true } }))?.id;
  }

  if (!targetSchoolId) {
    return NextResponse.json({ error: "A school is required to create a tournament" }, { status: 400 });
  }

  const tournament = await db.tournament.create({
    data: {
      name: name.trim(),
      description: description?.trim() || null,
      status: "DRAFT",
      competitionStart: competitionStart ? new Date(competitionStart) : null,
      competitionEnd: competitionEnd ? new Date(competitionEnd) : null,
      maxPlayers: maxPlayers ?? 100,
      subject: subject?.trim() || null,
      grade: grade ? parseInt(grade, 10) : null,
      difficulty: difficulty as "EASY" | "MEDIUM" | "HARD" | null ?? null,
      rules: rules ?? undefined,
      schoolId: targetSchoolId,
      createdById: user.id,
    },
  });

  return NextResponse.json({ tournament }, { status: 201 });
}
