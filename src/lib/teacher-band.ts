/**
 * Teacher bands.
 *
 * Abugida has two teacher surfaces, and they are deliberately separate
 * roles rather than one role with a band derived from `TeachingAssignment`:
 *
 *   • TEACHER           → grades 1-8  → /teacher           (classroom games)
 *   • SECONDARY_TEACHER → grades 9-12 → /secondary-teacher (cohort insights)
 *
 * Why a role and not a derived band:
 *   1. The grades 1-8 surface already gates on `role !== "TEACHER"`, so a
 *      secondary teacher is excluded by construction — no band check has to be
 *      added inside any existing route.
 *   2. A freshly provisioned teacher has zero assignments, so a derived band
 *      would be undefined on first login and they would have nowhere to land.
 *   3. A teacher holding both a grade-8 and a grade-9 assignment would satisfy
 *      both bands at once.
 *
 * The 8|9 split matches the Ethiopian cycle boundary in `lib/grade-scope`
 * (primary 1-6 + middle 7-8 vs secondary 9-12) and the grade ceiling the
 * existing game-set validator already enforces.
 */

import type { SchoolLevel, UserRole } from "@prisma/client";

/** Highest grade the grades 1-8 teacher surface covers. */
export const PRIMARY_MAX_GRADE = 8;

/** Lowest grade the secondary teacher surface covers. */
export const SECONDARY_MIN_GRADE = 9;

/** Highest grade in the curriculum. */
export const SECONDARY_MAX_GRADE = 12;

/** The grades a secondary teacher may be assigned to teach. */
export const SECONDARY_GRADES: readonly number[] = [9, 10, 11, 12];

/**
 * Grades offered when setting a student's grade: 9-12 (student accounts are
 * secondary only), plus the student's current grade if it is an older one
 * outside that range, so the form still shows it instead of a blank.
 */
export function studentGradeOptions(current?: number | null): number[] {
  const grades = [...SECONDARY_GRADES];
  if (current != null && !grades.includes(current)) grades.unshift(current);
  return grades;
}

/** Whether `grade` falls in the secondary band (9-12). */
export function isSecondaryGrade(grade: unknown): grade is number {
  return (
    Number.isInteger(grade) &&
    (grade as number) >= SECONDARY_MIN_GRADE &&
    (grade as number) <= SECONDARY_MAX_GRADE
  );
}

/**
 * The teacher role a school creates. The school's level decides it, never the
 * client: an elementary school's admin can only ever make grades 1-8 teachers.
 * No school (a super admin provisioning an unassigned teacher) keeps the
 * secondary default.
 */
export function teacherRoleForLevel(
  level: SchoolLevel | null | undefined,
): "TEACHER" | "SECONDARY_TEACHER" {
  return level === "ELEMENTARY" ? "TEACHER" : "SECONDARY_TEACHER";
}

/**
 * A class that names both a subject and a grade. Every secondary class does;
 * a grades 1-8 row may leave either blank ("teaches all of grade 3", "teaches
 * Mathematics"). Secondary code filters through this so a partial row can
 * never reach a cohort query.
 */
export function isFullClass<T extends { subject: string | null; grade: number | null }>(
  c: T,
): c is T & { subject: string; grade: number } {
  return c.subject !== null && c.grade !== null;
}

/** Either teacher role — useful where a surface is shared by both bands. */
export function isAnyTeacher(role: UserRole | string | undefined | null): boolean {
  return role === "TEACHER" || role === "SECONDARY_TEACHER";
}

/**
 * Where a role lands after login. Single source of truth for every redirect
 * hub (login page, /redirect, /auth/redirect) so a new role can never be
 * silently funnelled into the student dashboard by a trailing `else`.
 */
export function homeRouteForRole(role: UserRole | string | undefined | null): string {
  switch (role) {
    case "SUPER_ADMIN":
      return "/admin";
    case "SCHOOL_ADMIN":
      return "/school-admin";
    case "TEACHER":
      return "/teacher";
    case "SECONDARY_TEACHER":
      return "/secondary-teacher";
    default:
      return "/student";
  }
}
