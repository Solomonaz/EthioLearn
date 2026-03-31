import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getCurrentUser } from "@/lib/get-session";

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await getCurrentUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!["SUPER_ADMIN", "SCHOOL_ADMIN"].includes(user.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id } = await params;

  const textbook = await db.textbook.findUnique({
    where: { id },
    select: { id: true, schoolId: true },
  });

  if (!textbook) {
    return NextResponse.json({ error: "Textbook not found" }, { status: 404 });
  }

  // School admins may only delete textbooks belonging to their school
  if (
    user.role === "SCHOOL_ADMIN" &&
    user.schoolId &&
    textbook.schoolId !== user.schoolId
  ) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // Chapter → Question cascade is set via onDelete: Cascade in schema,
  // so deleting the textbook cascades to chapters and their questions.
  await db.textbook.delete({ where: { id } });

  return NextResponse.json({ success: true });
}
