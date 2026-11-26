import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
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

type Reader = { role: string; schoolId?: string | null; grade?: number | null };

/**
 * The query form of canReadTextbook's school + approval rule (lists add their
 * own grade filter): approved books from the national library or the user's
 * own school. A user without a school sees the national library only.
 */
export function readableTextbookWhere(user: Reader): Prisma.TextbookWhereInput {
  if (user.role === "SUPER_ADMIN") return {};
  return {
    approvalStatus: "APPROVED",
    OR: user.schoolId ? [{ schoolId: null }, { schoolId: user.schoolId }] : [{ schoolId: null }],
  };
}

/**
 * May this user study from the book behind a chapter (or a whole book when
 * chapterId is "all"/absent)? Used by the quiz, tutor and chapter routes so a
 * chapter id can't open another school's private book, an unapproved one, or
 * a grade outside the student's study scope. False when nothing is found.
 */
export async function canStudyFrom(
  user: Reader,
  ref: { chapterId?: unknown; textbookId?: unknown },
): Promise<boolean> {
  const select = { schoolId: true, grade: true, approvalStatus: true } as const;
  let tb: { schoolId: string | null; grade: number; approvalStatus: string } | null = null;
  if (typeof ref.chapterId === "string" && ref.chapterId !== "all") {
    tb = (await db.chapter.findUnique({ where: { id: ref.chapterId }, select: { textbook: { select } } }))?.textbook ?? null;
  } else if (typeof ref.textbookId === "string") {
    tb = await db.textbook.findUnique({ where: { id: ref.textbookId }, select });
  }
  return !!tb && canReadTextbook(user, tb);
}
