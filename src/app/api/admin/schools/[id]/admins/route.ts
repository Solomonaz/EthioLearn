import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getCurrentUser } from "@/lib/get-session";
import { validateCsrfOrigin } from "@/lib/csrf";
import { normalizeEmail } from "@/lib/teacher-classes";

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

    const { userId, email: rawEmail, name } = await req.json();

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
          createdAt: true,
        },
      });

      return NextResponse.json({ admin }, { status: 201 });
    }

    // A new admin is created by EMAIL with no password: they sign in with
    // Google on that address, or set a password through "Forgot password".
    if (rawEmail !== undefined) {
      const email = normalizeEmail(rawEmail);
      if (!email) {
        return NextResponse.json({ error: "Enter a valid email address." }, { status: 400 });
      }

      const existing = await db.user.findUnique({ where: { email }, select: { id: true } });
      if (existing) {
        return NextResponse.json(
          { error: "A user with this email already exists" },
          { status: 400 }
        );
      }

      const admin = await db.user.create({
        data: {
          email,
          name: typeof name === "string" && name.trim() ? name.trim() : "School Admin",
          role: "SCHOOL_ADMIN",
          schoolId: id,
        },
        select: {
          id: true,
          name: true,
          email: true,
          createdAt: true,
        },
      });

      return NextResponse.json({ admin }, { status: 201 });
    }

    return NextResponse.json(
      { error: "Either userId or email is required" },
      { status: 400 }
    );
  } catch (error) {
    console.error("Failed to assign school admin:", error);
    return NextResponse.json({ error: "Failed to assign school admin" }, { status: 500 });
  }
}
