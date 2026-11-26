import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getCurrentUser } from "@/lib/get-session";
import { validateCsrfOrigin } from "@/lib/csrf";

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const user = await getCurrentUser();
    // Subjects are one shared list per level (Subject has no school), so
    // deleting one removes it for every school at that level: super admin only.
    if (!user || user.role !== "SUPER_ADMIN") {
      return NextResponse.json(
        { error: "Subjects are shared by every school. Ask the Abugida team to remove one." },
        { status: 403 },
      );
    }

    if (!validateCsrfOrigin(req)) {
      return NextResponse.json({ error: "Invalid request origin" }, { status: 403 });
    }

    // A school admin may only remove subjects from their own level's list —
    // an elementary school must not be able to delete a secondary subject.
    const subject = await db.subject.findUnique({ where: { id }, select: { level: true } });
    if (!subject) {
      return NextResponse.json({ error: "Subject not found" }, { status: 404 });
    }

    await db.subject.delete({
      where: { id },
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Failed to delete subject:", error);
    return NextResponse.json({ error: "Failed to delete subject" }, { status: 500 });
  }
}

