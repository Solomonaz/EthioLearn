import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getCurrentUser } from "@/lib/get-session";
import { clearRateLimit } from "@/lib/rate-limit";
import { validateCsrfOrigin } from "@/lib/csrf";
import { generateTempPassword, generateUsername, hashPassword } from "@/lib/password";
import { revokeAllUserSessions } from "@/lib/session-store";

/**
 * POST /api/admin/students/[id]/reset-password
 *
 * Gives a student a new temporary password — for the student who forgot
 * theirs. Students a school created have no email, so this is their only way
 * back in. The student must replace it at next sign-in, and every existing
 * session is signed out.
 *
 * The password is returned ONCE, for the admin to hand over; it is never
 * stored in readable form.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getCurrentUser();
  if (!user || !["SUPER_ADMIN", "SCHOOL_ADMIN"].includes(user.role)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  }

  if (!validateCsrfOrigin(req)) {
    return NextResponse.json({ error: "Invalid request origin" }, { status: 403 });
  }

  const { id } = await params;
  const schoolId = user.schoolId;

  const student = await db.user.findFirst({
    where: {
      id,
      role: "STUDENT",
      ...(schoolId ? { schoolId } : {}),
    },
    select: { id: true, name: true, username: true, email: true },
  });

  if (!student) {
    return NextResponse.json({ error: "Student not found" }, { status: 404 });
  }

  // A student from before sign-in moved off phone numbers may have neither a
  // username nor an email; give them a username, or the new password would
  // have nothing to go with.
  const username =
    student.username ?? (student.email ? null : await generateUsername(student.name));

  const tempPassword = generateTempPassword();
  await db.user.update({
    where: { id: student.id },
    data: {
      passwordHash: await hashPassword(tempPassword),
      mustChangePassword: true,
      ...(username && !student.username ? { username } : {}),
    },
  });
  await revokeAllUserSessions(student.id);

  // A student locked out by too many wrong guesses can try again at once.
  for (const identifier of [student.username, student.email]) {
    if (identifier) clearRateLimit(`auth:password:${identifier.toLowerCase()}`);
  }

  return NextResponse.json({
    success: true,
    signInAs: username ?? student.email,
    tempPassword,
  });
}
