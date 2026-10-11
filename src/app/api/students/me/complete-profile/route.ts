import { NextResponse } from "next/server";
import { isSecondaryGrade } from "@/lib/teacher-band";
import { db } from "@/lib/db";
import { getCurrentUser } from "@/lib/get-session";
import { validateCsrfOrigin } from "@/lib/csrf";

// POST /api/students/me/complete-profile  { grade }
// A student who signed up with Google or Telegram picks their grade once,
// after which `profileIncomplete` clears on the next session refresh.

export async function POST(req: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  if (!validateCsrfOrigin(req)) {
    return NextResponse.json({ error: "Invalid request origin" }, { status: 403 });
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const grade = body.grade;
  // Student accounts are for grades 9-12 (grades 1-8 have no student accounts).
  if (!isSecondaryGrade(grade)) {
    return NextResponse.json({ error: "Grade must be between 9 and 12" }, { status: 400 });
  }

  const updated = await db.user.update({
    where: { id: user.id },
    data: { grade },
    select: { id: true, name: true, email: true, grade: true },
  });

  return NextResponse.json({ user: updated });
}
