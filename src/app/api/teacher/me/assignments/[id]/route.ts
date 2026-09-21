import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getCurrentUser } from "@/lib/get-session";
import { validateCsrfOrigin } from "@/lib/csrf";
import { isAnyTeacher } from "@/lib/teacher-band";

/** DELETE /api/teacher/me/assignments/[id] — remove one of my teaching pairs. */
export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  if (!validateCsrfOrigin(request)) {
    return NextResponse.json({ error: "Invalid request origin" }, { status: 403 });
  }

  // Shared by both teacher bands; the deleteMany below is owner-scoped, so a
  // teacher can still only remove their own rows.
  const user = await getCurrentUser();
  if (!user || !isAnyTeacher(user.role)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  }

  const { id } = await params;

  // Scope the delete to the owner so a teacher can only remove their own rows.
  const result = await db.teachingAssignment.deleteMany({
    where: { id, teacherId: user.id },
  });

  if (result.count === 0) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  return NextResponse.json({ ok: true });
}
