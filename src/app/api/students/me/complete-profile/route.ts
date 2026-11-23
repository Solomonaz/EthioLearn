import { NextResponse } from "next/server";
import { isStudentGrade } from "@/lib/teacher-band";
import { db } from "@/lib/db";
import { getCurrentUser } from "@/lib/get-session";
import { validateCsrfOrigin } from "@/lib/csrf";

// POST /api/students/me/complete-profile  { name, grade, acceptTerms: true }
// A student who signed up with Google or Telegram confirms their name, picks
// their grade once and agrees to the terms, after which `profileIncomplete`
// clears on the next session refresh.

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

  // The grade is picked once. Changing it later is an admin's job, since it
  // decides between the grades 1-8 play area and the grades 9-12 dashboard.
  if (user.role !== "STUDENT" || user.grade != null) {
    return NextResponse.json({ error: "Your grade is already set." }, { status: 409 });
  }

  // The name came from Google or Telegram (often a nickname or "Telegram
  // User"); the student confirms or corrects it here, because teachers and the
  // leaderboard show it. Same rule as email sign-up.
  const name = typeof body.name === "string" ? body.name.trim().replace(/\s+/g, " ") : "";
  if (name.length < 2 || name.length > 50) {
    return NextResponse.json({ error: "Enter your full name (2-50 characters)." }, { status: 400 });
  }

  if (body.acceptTerms !== true) {
    return NextResponse.json(
      { error: "Please agree to the Terms of Service and Privacy Policy to continue." },
      { status: 400 },
    );
  }

  const grade = body.grade;
  if (!isStudentGrade(grade)) {
    return NextResponse.json({ error: "Grade must be between 1 and 12" }, { status: 400 });
  }

  const updated = await db.user.update({
    where: { id: user.id },
    data: { grade, name, termsAcceptedAt: new Date() },
    select: { id: true, name: true, email: true, grade: true },
  });

  return NextResponse.json({ user: updated });
}
