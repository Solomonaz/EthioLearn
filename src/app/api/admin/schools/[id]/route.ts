import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getCurrentUser } from "@/lib/get-session";
import { validateCsrfOrigin } from "@/lib/csrf";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getCurrentUser();
  if (!user || user.role !== "SUPER_ADMIN") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  }

  const { id } = await params;

  try {
    const school = await db.school.findUnique({
      where: { id },
      include: {
        gameConfig: true,
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
            createdAt: true,
          },
        },
      },
    });

    if (!school) {
      return NextResponse.json({ error: "School not found" }, { status: 404 });
    }

    // Rename `users` (Prisma relation name) → `admins` for the frontend
    const { users: admins, ...rest } = school;
    return NextResponse.json({ school: { ...rest, admins } });
  } catch (error) {
    console.error("Failed to fetch school:", error);
    return NextResponse.json({ error: "Failed to fetch school" }, { status: 500 });
  }
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getCurrentUser();
  if (!user || user.role !== "SUPER_ADMIN") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  }

  if (!validateCsrfOrigin(req)) {
    return NextResponse.json({ error: "Invalid request origin" }, { status: 403 });
  }

  const { id } = await params;

  try {
    const existing = await db.school.findUnique({ where: { id } });
    if (!existing) {
      return NextResponse.json({ error: "School not found" }, { status: 404 });
    }

    const body = await req.json();
    const updates: Record<string, unknown> = {};

    if (body.name !== undefined) {
      if (typeof body.name !== "string" || body.name.trim().length < 2 || body.name.trim().length > 100) {
        return NextResponse.json(
          { error: "Name must be between 2 and 100 characters" },
          { status: 400 }
        );
      }
      updates.name = body.name.trim();
    }

    if (body.region !== undefined) {
      if (typeof body.region !== "string" || body.region.trim().length === 0) {
        return NextResponse.json({ error: "Region cannot be empty" }, { status: 400 });
      }
      updates.region = body.region.trim();
    }

    if (body.city !== undefined) {
      if (typeof body.city !== "string" || body.city.trim().length === 0) {
        return NextResponse.json({ error: "City cannot be empty" }, { status: 400 });
      }
      updates.city = body.city.trim();
    }

    if (body.type !== undefined) {
      if (!["PUBLIC", "PRIVATE"].includes(body.type)) {
        return NextResponse.json(
          { error: "Type must be PUBLIC or PRIVATE" },
          { status: 400 }
        );
      }
      updates.type = body.type;
    }

    if (Object.keys(updates).length === 0) {
      return NextResponse.json({ error: "No fields to update" }, { status: 400 });
    }

    const school = await db.school.update({
      where: { id },
      data: updates,
    });

    return NextResponse.json({ school });
  } catch (error: any) {
    if (error.code === "P2002") {
      return NextResponse.json({ error: "A school with this name already exists" }, { status: 400 });
    }
    console.error("Failed to update school:", error);
    return NextResponse.json({ error: "Failed to update school" }, { status: 500 });
  }
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getCurrentUser();
  if (!user || user.role !== "SUPER_ADMIN") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  }

  if (!validateCsrfOrigin(req)) {
    return NextResponse.json({ error: "Invalid request origin" }, { status: 403 });
  }

  const { id } = await params;

  try {
    const school = await db.school.findUnique({
      where: { id },
      include: {
        _count: {
          select: { users: true, textbooks: true, rewards: true },
        },
      },
    });

    if (!school) {
      return NextResponse.json({ error: "School not found" }, { status: 404 });
    }

    if (school._count.users > 0) {
      return NextResponse.json(
        { error: "Cannot delete school with assigned users. Reassign or remove all users first." },
        { status: 409 }
      );
    }

    if (school._count.textbooks > 0) {
      return NextResponse.json(
        { error: "Cannot delete school with associated textbooks. Remove all textbooks first." },
        { status: 409 }
      );
    }

    if (school._count.rewards > 0) {
      return NextResponse.json(
        { error: "Cannot delete school with associated rewards. Remove all rewards first." },
        { status: 409 }
      );
    }

    await db.school.delete({ where: { id } });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Failed to delete school:", error);
    return NextResponse.json({ error: "Failed to delete school" }, { status: 500 });
  }
}
