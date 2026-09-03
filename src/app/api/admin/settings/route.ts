import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getCurrentUser } from "@/lib/get-session";
import { validateCsrfOrigin } from "@/lib/csrf";

export async function GET() {
  const user = await getCurrentUser();
  if (!user || !["SUPER_ADMIN", "SCHOOL_ADMIN"].includes(user.role)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  }

  // A super admin does not own a school — they oversee ALL schools from the
  // Schools tab. This page shows them only the platform-wide controls, so we
  // return no school and never bind them to one.
  if (user.role === "SUPER_ADMIN") {
    return NextResponse.json({ isSuperAdmin: true, school: null });
  }

  let schoolId = user.schoolId;

  // Self-healing: a school admin missing a schoolId gets attached to a school.
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

    // Link the school admin to the school for future requests.
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

  // Super admins don't edit a single school from here — they manage each school
  // individually under the Schools tab. Guard the endpoint accordingly.
  if (user.role === "SUPER_ADMIN") {
    return NextResponse.json(
      { error: "Super admins manage schools from the Schools tab, not here." },
      { status: 403 }
    );
  }

  let schoolId = user.schoolId;
  if (!schoolId) {
    const existingSchool = await db.school.findFirst();
    if (!existingSchool) {
      return NextResponse.json({ error: "No school exists yet. Visit Settings to create one." }, { status: 400 });
    }
    schoolId = existingSchool.id;
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
      where: { id: schoolId },
      data: {
        ...(name && { name }),
        ...(region && { region: String(region) }),
        ...(city && { city: String(city) }),
        ...(type && { type: type as any }),
      },
    }),
    db.gameConfig.upsert({
      where: { schoolId: schoolId },
      update: {
        ...(maxPlayersPerRoom !== undefined && { maxPlayersPerRoom: Number(maxPlayersPerRoom) }),
        ...(timePerQuestion !== undefined && { timePerQuestion: Number(timePerQuestion) }),
        ...(defaultDifficulty !== undefined && { defaultDifficulty: defaultDifficulty as any }),
      },
      create: {
        schoolId: schoolId,
        maxPlayersPerRoom: Number(maxPlayersPerRoom) || 20,
        timePerQuestion: Number(timePerQuestion) || 20,
        defaultDifficulty: (defaultDifficulty as any) || "MEDIUM",
      },
    }),
  ]);

  return NextResponse.json({ school: updatedSchool });
}
