import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getCurrentUser } from "@/lib/get-session";
import { validateCsrfOrigin } from "@/lib/csrf";
import { rateLimit } from "@/lib/rate-limit";
import { hashPassword, passwordProblem, verifyPassword } from "@/lib/password";

/**
 * POST /api/auth/password/change  { currentPassword?, newPassword }
 *
 * For a signed-in user. When the account already has a password, the current
 * one is required — including a school-issued temporary password, which is
 * what `mustChangePassword` forces the student to replace. An account with no
 * password yet (Google or Telegram only) may set one without it.
 */
export async function POST(request: Request) {
  if (!validateCsrfOrigin(request)) {
    return NextResponse.json({ error: "Invalid request origin" }, { status: 403 });
  }

  const user = await getCurrentUser();
  if (!user || user.id === "env_super_admin") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!rateLimit(`pwchange:${user.id}`, 10, 15 * 60 * 1000).success) {
    return NextResponse.json({ error: "Too many attempts. Please try again later." }, { status: 429 });
  }

  const body = await request.json().catch(() => ({}));
  const currentPassword = typeof body.currentPassword === "string" ? body.currentPassword : "";
  const newPassword = body.newPassword;

  const problem = passwordProblem(newPassword);
  if (problem) {
    return NextResponse.json({ error: problem }, { status: 400 });
  }

  const row = await db.user.findUnique({
    where: { id: user.id },
    select: { passwordHash: true },
  });
  if (row?.passwordHash) {
    if (!(await verifyPassword(currentPassword, row.passwordHash))) {
      return NextResponse.json({ error: "Your current password is not correct." }, { status: 400 });
    }
    if (currentPassword === newPassword) {
      return NextResponse.json({ error: "Choose a password different from the current one." }, { status: 400 });
    }
  }

  await db.user.update({
    where: { id: user.id },
    data: { passwordHash: await hashPassword(newPassword as string), mustChangePassword: false },
  });

  return NextResponse.json({ success: true });
}
