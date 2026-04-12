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
    const school = await db.school.findUnique({ where: { id } });
    if (!school) {
      return NextResponse.json({ error: "School not found" }, { status: 404 });
    }

    const admins = await db.user.findMany({
      where: { schoolId: id, role: "SCHOOL_ADMIN" },
      select: {
        id: true,
        name: true,
        email: true,
        phoneNumber: true,
        createdAt: true,
      },
    });

    return NextResponse.json({ admins });
  } catch (error) {
    console.error("Failed to fetch school admins:", error);
    return NextResponse.json({ error: "Failed to fetch school admins" }, { status: 500 });
  }
}

export async function POST(
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
    const school = await db.school.findUnique({ where: { id } });
    if (!school) {
      return NextResponse.json({ error: "School not found" }, { status: 404 });
    }

    const { userId, phoneNumber, name } = await req.json();

    if (userId) {
      const existingUser = await db.user.findUnique({ where: { id: userId } });
      if (!existingUser) {
        return NextResponse.json({ error: "User not found" }, { status: 404 });
      }

      if (existingUser.role === "SUPER_ADMIN") {
        return NextResponse.json(
          { error: "Cannot assign SUPER_ADMIN as a school admin" },
          { status: 400 }
        );
      }

      const admin = await db.user.update({
        where: { id: userId },
        data: { role: "SCHOOL_ADMIN", schoolId: id },
        select: {
          id: true,
          name: true,
          email: true,
          phoneNumber: true,
          createdAt: true,
        },
      });

      return NextResponse.json({ admin }, { status: 201 });
    }

    if (phoneNumber) {
      const phoneRegex = /^\+251[0-9]{9}$/;
      if (!phoneRegex.test(phoneNumber)) {
        return NextResponse.json(
          { error: "Invalid phone number format. Must be +251 followed by 9 digits." },
          { status: 400 }
        );
      }

      const existingPhone = await db.user.findFirst({
        where: { phoneNumber },
      });
      if (existingPhone) {
        return NextResponse.json(
          { error: "A user with this phone number already exists" },
          { status: 400 }
        );
      }

      const admin = await db.user.create({
        data: {
          phoneNumber,
          name: name || "School Admin",
          role: "SCHOOL_ADMIN",
          schoolId: id,
        },
        select: {
          id: true,
          name: true,
          email: true,
          phoneNumber: true,
          createdAt: true,
        },
      });

      return NextResponse.json({ admin }, { status: 201 });
    }

    return NextResponse.json(
      { error: "Either userId or phoneNumber is required" },
      { status: 400 }
    );
  } catch (error) {
    console.error("Failed to assign school admin:", error);
    return NextResponse.json({ error: "Failed to assign school admin" }, { status: 500 });
  }
}
