import { db } from "./db";
import { teacherRoleForLevel } from "./teacher-band";

/**
 * The head counts a school plan is priced on. Students are every enrolled
 * student (as before); teachers are the ACTIVE teachers of the school's own
 * level — secondary teachers at a secondary school, grades 1-8 teachers at an
 * elementary one. A deactivated teacher no longer costs anything. Elementary
 * schools have no students, so they are priced on teachers alone.
 */
export async function countSchoolSeats(schoolId: string): Promise<{ students: number; teachers: number }> {
  const school = await db.school.findUnique({ where: { id: schoolId }, select: { level: true } });
  const [students, teachers] = await Promise.all([
    db.user.count({ where: { schoolId, role: "STUDENT" } }),
    db.user.count({
      where: { schoolId, role: teacherRoleForLevel(school?.level), isActive: true },
    }),
  ]);
  return { students, teachers };
}
