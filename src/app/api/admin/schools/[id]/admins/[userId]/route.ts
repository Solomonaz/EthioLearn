import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getCurrentUser } from "@/lib/get-session";
import { validateCsrfOrigin } from "@/lib/csrf";

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; userId: string }> }
) {
  const user = await getCurrentUser();
  if (!user || user.role !== "SUPER_ADMIN") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  }

  if (!validateCsrfOrigin(req)) {
    return NextResponse.json({ error: "Invalid request origin" }, { status: 403 });
  }

  const { id, userId } = await params;

  try {
    const admin = await db.user.findUnique({
      where: { id: userId },
      select: { id: true, role: true, schoolId: true },
    });

    if (!admin) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    if (admin.role !== "SCHOOL_ADMIN" || admin.schoolId !== id) {
      return NextResponse.json(
        { error: "User is not a school admin of this school" },
        { status: 400 }
      );
    }

    await db.user.update({
      where: { id: userId },
      data: { role: "STUDENT", schoolId: null },
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Failed to remove school admin:", error);
    return NextResponse.json({ error: "Failed to remove school admin" }, { status: 500 });
  }
}
