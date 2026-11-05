import { getStudyScope } from "@/lib/grade-scope";

/**
 * Whether a user may read a textbook in the library (its PDF or its text).
 * Same visibility as GET /api/library: approved books from the national
 * library or the user's own school, and for a student only the grades of
 * their study scope. The super admin sees everything.
 */
export function canReadTextbook(
  user: { role: string; schoolId?: string | null; grade?: number | null },
  tb: { schoolId: string | null; grade: number; approvalStatus: string },
): boolean {
  if (user.role === "SUPER_ADMIN") return true;
  return (
    tb.approvalStatus === "APPROVED" &&
    (!tb.schoolId || tb.schoolId === user.schoolId) &&
    (user.role !== "STUDENT" || getStudyScope(user.grade).includes(tb.grade))
  );
}
