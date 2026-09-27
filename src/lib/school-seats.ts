import { db } from "./db";

/**
 * The head counts a school plan is priced on. Students are every enrolled
 * student (as before); teachers are ACTIVE secondary teachers only — a
 * deactivated teacher no longer costs anything, and grades 1-8 teachers are a
 * separate institution that school plans do not price yet.
 */
export async function countSchoolSeats(schoolId: string): Promise<{ students: number; teachers: number }> {
  const [students, teachers] = await Promise.all([
    db.user.count({ where: { schoolId, role: "STUDENT" } }),
    db.user.count({ where: { schoolId, role: "SECONDARY_TEACHER", isActive: true } }),
  ]);
  return { students, teachers };
}
