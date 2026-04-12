import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getCurrentUser } from "@/lib/get-session";
import { validateCsrfOrigin } from "@/lib/csrf";

export async function GET() {
  const user = await getCurrentUser();
  if (!user || user.role !== "SUPER_ADMIN") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  }

  try {
    const schools = await db.school.findMany({
      include: {
        _count: {
          select: { users: true, textbooks: true, rewards: true },
        },
        users: {
          where: { role: "SCHOOL_ADMIN" },
          select: {
            id: true,
            name: true,
            email: true,
            phoneNumber: true,
          },
        },
      },
      orderBy: { createdAt: "desc" },
    });

    // Rename `users` (Prisma relation) → `admins` for the frontend
    const mapped = schools.map(({ users: admins, ...rest }) => ({ ...rest, admins }));
    return NextResponse.json({ schools: mapped });
  } catch (error) {
    console.error("Failed to fetch schools:", error);
    return NextResponse.json({ error: "Failed to fetch schools" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user || user.role !== "SUPER_ADMIN") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  }

  if (!validateCsrfOrigin(req)) {
    return NextResponse.json({ error: "Invalid request origin" }, { status: 403 });
  }

  try {
    const { name, region, city, type } = await req.json();

    if (!name || typeof name !== "string" || name.trim().length < 2 || name.trim().length > 100) {
      return NextResponse.json(
        { error: "Name is required and must be between 2 and 100 characters" },
        { status: 400 }
      );
    }

    if (!region || typeof region !== "string" || region.trim().length === 0) {
      return NextResponse.json({ error: "Region is required" }, { status: 400 });
    }

    if (!city || typeof city !== "string" || city.trim().length === 0) {
      return NextResponse.json({ error: "City is required" }, { status: 400 });
    }

    const schoolType = type || "PUBLIC";
    if (!["PUBLIC", "PRIVATE"].includes(schoolType)) {
      return NextResponse.json(
        { error: "Type must be PUBLIC or PRIVATE" },
        { status: 400 }
      );
    }

    const school = await db.school.create({
      data: {
        name: name.trim(),
        region: region.trim(),
        city: city.trim(),
        type: schoolType,
      },
    });

    return NextResponse.json({ school }, { status: 201 });
  } catch (error: any) {
    if (error.code === "P2002") {
      return NextResponse.json({ error: "A school with this name already exists" }, { status: 400 });
    }
    console.error("Failed to create school:", error);
    return NextResponse.json({ error: "Failed to create school" }, { status: 500 });
  }
}
