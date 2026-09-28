import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getCurrentUser } from "@/lib/get-session";
import { validateCsrfOrigin } from "@/lib/csrf";
import { subjectLevelFor } from "@/lib/subject";

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const user = await getCurrentUser();
    if (!user || (user.role !== "SUPER_ADMIN" && user.role !== "SCHOOL_ADMIN")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
    }

    if (!validateCsrfOrigin(req)) {
      return NextResponse.json({ error: "Invalid request origin" }, { status: 403 });
    }

    // A school admin may only remove subjects from their own level's list —
    // an elementary school must not be able to delete a secondary subject.
    const subject = await db.subject.findUnique({ where: { id }, select: { level: true } });
    if (!subject || (user.role === "SCHOOL_ADMIN" && subject.level !== subjectLevelFor(user))) {
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

