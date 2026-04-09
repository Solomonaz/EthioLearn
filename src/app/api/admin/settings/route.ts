import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getCurrentUser } from "@/lib/get-session";
import { validateCsrfOrigin } from "@/lib/csrf";

export async function GET() {
  const user = await getCurrentUser();
  if (!user || !["SUPER_ADMIN", "SCHOOL_ADMIN"].includes(user.role)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  }

  let schoolId = user.schoolId;

  // Self-healing: If admin has no schoolId, find or create one
  if (!schoolId) {
    const existingSchool = await db.school.findFirst();
    if (existingSchool) {
      schoolId = existingSchool.id;
    } else {
      const newSchool = await db.school.create({
        data: {
          name: "Default School",
          region: "Addis Ababa",
          city: "Addis Ababa",
          type: "PUBLIC",
        },
      });
      schoolId = newSchool.id;
    }

    // Link the user to the school for future requests
    await db.user.update({
      where: { id: user.id },
      data: { schoolId },
    });
  }

  const school = await db.school.findUnique({
    where: { id: schoolId },
    include: {
      gameConfig: true,
      _count: {
        select: {
          users: true,
          textbooks: true,
          rewards: true,
        },
      },
    },
  });

  if (!school) {
    return NextResponse.json({ error: "School not found" }, { status: 404 });
  }

  return NextResponse.json({ school });
}

export async function PATCH(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user || !["SUPER_ADMIN", "SCHOOL_ADMIN"].includes(user.role)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  }

  if (!user.schoolId) {
    return NextResponse.json({ error: "No school assigned" }, { status: 400 });
  }

  if (!validateCsrfOrigin(request)) {
    return NextResponse.json({ error: "Invalid request origin" }, { status: 403 });
  }

  let body: any;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { 
    name, region, city, type,
    maxPlayersPerRoom, timePerQuestion, defaultDifficulty 
  } = body;

  // Validate School Info
  if (name !== undefined && (typeof name !== "string" || name.length < 2 || name.length > 100)) {
    return NextResponse.json({ error: "Name must be 2–100 characters" }, { status: 400 });
  }
  if (type !== undefined && !["PUBLIC", "PRIVATE"].includes(type)) {
    return NextResponse.json({ error: "Invalid school type. Must be PUBLIC or PRIVATE" }, { status: 400 });
  }

  // Use a transaction or separate updates
  const [updatedSchool] = await db.$transaction([
    db.school.update({
      where: { id: user.schoolId },
      data: {
        ...(name && { name }),
        ...(region && { region: String(region) }),
        ...(city && { city: String(city) }),
        ...(type && { type: type as any }),
      },
    }),
    db.gameConfig.upsert({
      where: { schoolId: user.schoolId },
      update: {
        ...(maxPlayersPerRoom !== undefined && { maxPlayersPerRoom: Number(maxPlayersPerRoom) }),
        ...(timePerQuestion !== undefined && { timePerQuestion: Number(timePerQuestion) }),
        ...(defaultDifficulty !== undefined && { defaultDifficulty: defaultDifficulty as any }),
      },
      create: {
        schoolId: user.schoolId,
        maxPlayersPerRoom: Number(maxPlayersPerRoom) || 20,
        timePerQuestion: Number(timePerQuestion) || 20,
        defaultDifficulty: (defaultDifficulty as any) || "MEDIUM",
      },
    }),
  ]);

  return NextResponse.json({ school: updatedSchool });
}
