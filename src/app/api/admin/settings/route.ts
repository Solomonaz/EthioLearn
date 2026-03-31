import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getCurrentUser } from "@/lib/get-session";

export async function GET() {
  const user = await getCurrentUser();
  if (!user || !["SUPER_ADMIN", "SCHOOL_ADMIN"].includes(user.role)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  }

  if (!user.schoolId) {
    return NextResponse.json({ error: "No school assigned" }, { status: 400 });
  }

  const school = await db.school.findUnique({
    where: { id: user.schoolId },
    include: {
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

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { name, region, city, type } = body as {
    name?: string; region?: string; city?: string; type?: string;
  };

  // Validate field lengths
  if (name !== undefined && (typeof name !== "string" || name.length < 2 || name.length > 100)) {
    return NextResponse.json({ error: "Name must be 2–100 characters" }, { status: 400 });
  }
  if (type !== undefined && !["PRIMARY", "SECONDARY", "PREPARATORY", "PRIVATE"].includes(type)) {
    return NextResponse.json({ error: "Invalid school type" }, { status: 400 });
  }

  const updateData: Record<string, string> = {};
  if (name !== undefined) updateData.name = name;
  if (region !== undefined) updateData.region = String(region);
  if (city !== undefined) updateData.city = String(city);
  if (type !== undefined) updateData.type = type;

  const school = await db.school.update({
    where: { id: user.schoolId },
    data: updateData,
  });

  return NextResponse.json({ school });
}
