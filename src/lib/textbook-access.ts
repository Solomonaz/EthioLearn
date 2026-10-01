import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { canonicalSubject, subjectFilter } from "@/lib/subject";

/**
 * Who may see and who may change a textbook.
 *
 * A textbook with `schoolId = null` belongs to the **national library**: the
 * platform uploads and processes each MoE book once, and every school's
 * students get it. Schools only upload books the library doesn't have.
 *
 *   • SUPER_ADMIN  — sees and manages everything.
 *   • SCHOOL_ADMIN — sees the library + its own school's books, but may only
 *                    change its own. Library books are read-only to schools,
 *                    so one school can't edit, re-process (paid) or delete a
 *                    book every other school depends on.
 */

interface AccessUser {
  role: string;
  schoolId?: string | null;
}

export function isLibraryBook(textbookSchoolId: string | null | undefined): boolean {
  return !textbookSchoolId;
}

export function canManageTextbook(user: AccessUser, textbookSchoolId: string | null | undefined): boolean {
  if (user.role === "SUPER_ADMIN") return true;
  if (user.role === "SCHOOL_ADMIN") return !!user.schoolId && textbookSchoolId === user.schoolId;
  return false;
}

export function canViewTextbook(user: AccessUser, textbookSchoolId: string | null | undefined): boolean {
  if (user.role === "SUPER_ADMIN") return true;
  return isLibraryBook(textbookSchoolId) || (!!user.schoolId && textbookSchoolId === user.schoolId);
}

/** Textbooks an admin can change — the query form of `canManageTextbook`. */
export function manageableTextbookWhere(user: AccessUser): Prisma.TextbookWhereInput {
  if (user.role === "SUPER_ADMIN") return {};
  if (user.role === "SCHOOL_ADMIN" && user.schoolId) return { schoolId: user.schoolId };
  return { id: { in: [] } };
}

/** Textbooks an admin can see: everything for super admin, library + own school otherwise. */
export function visibleTextbookWhere(user: AccessUser): Prisma.TextbookWhereInput {
  if (user.role === "SUPER_ADMIN") return {};
  return user.schoolId ? { OR: [{ schoolId: null }, { schoolId: user.schoolId }] } : { schoolId: null };
}

export interface DuplicateTextbook {
  id: string;
  title: string;
  subject: string;
  grade: number;
  isLibrary: boolean;
  chapterCount: number;
}

/**
 * Books that would make a new upload redundant: the same grade + subject in
 * the national library, or already uploaded by the same school. MoE publishes
 * one textbook per grade per subject, so grade + subject is the identity —
 * titles vary too much ("Physics", "Physics Grade 11 Student Text") to match on.
 */
export async function findDuplicateTextbooks(
  user: AccessUser,
  grade: number,
  subject: string,
): Promise<DuplicateTextbook[]> {
  const canonical = await canonicalSubject(subject);
  const rows = await db.textbook.findMany({
    where: {
      grade,
      subject: subjectFilter(canonical),
      // A refused request shouldn't stop the school asking again.
      approvalStatus: { not: "REJECTED" },
      OR: [
        { schoolId: null },
        ...(user.role === "SCHOOL_ADMIN" && user.schoolId ? [{ schoolId: user.schoolId }] : []),
      ],
    },
    select: { id: true, title: true, subject: true, grade: true, schoolId: true, _count: { select: { chapters: true } } },
    orderBy: { createdAt: "asc" },
  });
  return rows.map((r) => ({
    id: r.id,
    title: r.title,
    subject: r.subject,
    grade: r.grade,
    isLibrary: isLibraryBook(r.schoolId),
    chapterCount: r._count.chapters,
  }));
}

/**
 * The 409 body both upload endpoints return. School admins are blocked
 * outright; the super admin can re-send with `allowDuplicate` (e.g. a revised
 * edition) since they own the library.
 */
export function duplicateResponseBody(user: AccessUser, duplicates: DuplicateTextbook[]) {
  const first = duplicates[0];
  const where = first.isLibrary ? "the national library" : "your school's textbooks";
  return {
    error:
      `"${first.title}" (Grade ${first.grade} ${first.subject}) is already in ${where}.` +
      (user.role === "SUPER_ADMIN"
        ? " Confirm to upload another copy anyway."
        : first.isLibrary
          ? " Your students already have it — no upload needed. If your school uses a different book for this subject, contact the platform admin."
          : " Delete the existing one first if you want to replace it."),
    code: "DUPLICATE_TEXTBOOK",
    duplicates,
    canOverride: user.role === "SUPER_ADMIN",
  };
}
