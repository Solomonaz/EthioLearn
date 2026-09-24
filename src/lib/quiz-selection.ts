/**
 * Which bank questions a student gets, before any generation.
 *
 * Rules (both quiz sources — "AI" and "Question Bank" — follow them):
 *   1. Questions the student has NEVER answered come first. If the bank holds
 *      enough of them, nothing is generated, even when the student chose AI:
 *      they care about questions they haven't seen, not about how new a
 *      question is, and generating duplicates of the bank costs money for
 *      nothing.
 *   2. Only once those run out is generation worth paying for — unless the
 *      chapter is SATURATED (generation already showed it can only produce
 *      repeats), in which case the student is re-served questions they answered
 *      longest ago, mixed in random order.
 *
 * "Seen" means answered in a submitted quiz. A quiz abandoned before submit
 * leaves no QuizAnswer rows, so its questions still count as unseen.
 */
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { shuffleArray } from "@/lib/utils";

const BANK_SELECT = {
  id: true,
  questionText: true,
  options: true,
  type: true,
  difficulty: true,
  correctAnswer: true,
} as const;

export type BankQuestion = Prisma.QuestionGetPayload<{ select: typeof BANK_SELECT }>;

export interface BankPools {
  /** Never answered by this student, in random order. */
  unseen: BankQuestion[];
  /** Answered before, least recently answered first. */
  seen: BankQuestion[];
}

/** Split the questions matching `where` into unseen and seen for one student. */
export async function bankPoolsFor(
  studentId: string,
  where: Prisma.QuestionWhereInput
): Promise<BankPools> {
  const questions = await db.question.findMany({ where, select: BANK_SELECT });
  if (questions.length === 0) return { unseen: [], seen: [] };

  // When this student last answered each question. startedAt, not completedAt:
  // it is always set, and the two differ by minutes.
  const history = await db.$queryRaw<{ questionId: string; last: Date }[]>`
    SELECT qa."questionId", MAX(qz."startedAt") AS last
    FROM quiz_answers qa
    JOIN quizzes qz ON qz.id = qa."quizId"
    WHERE qz."studentId" = ${studentId}
      AND qa."questionId" = ANY(${questions.map((q) => q.id)})
    GROUP BY qa."questionId"
  `;
  const lastSeen = new Map(history.map((h) => [h.questionId, new Date(h.last).getTime()]));

  const unseen = shuffleArray(questions.filter((q) => !lastSeen.has(q.id)));
  // Shuffle first so questions last seen in the same quiz come back in a
  // different order each time; the sort is stable.
  const seen = shuffleArray(questions.filter((q) => lastSeen.has(q.id))).sort(
    (a, b) => (lastSeen.get(a.id) ?? 0) - (lastSeen.get(b.id) ?? 0)
  );
  return { unseen, seen };
}

/** True while the chapter is saturated and its content has not changed since. */
export async function isChapterSaturated(chapterId: string): Promise<boolean> {
  const c = await db.chapter.findUnique({
    where: { id: chapterId },
    select: { saturatedAt: true, saturatedContentHash: true, contentHash: true },
  });
  return !!c?.saturatedAt && (c.saturatedContentHash ?? "") === (c.contentHash ?? "");
}

/** Record that generation for this chapter now mostly produces repeats. */
export async function markChapterSaturated(chapterId: string): Promise<void> {
  const c = await db.chapter.findUnique({ where: { id: chapterId }, select: { contentHash: true } });
  await db.chapter.update({
    where: { id: chapterId },
    data: { saturatedAt: new Date(), saturatedContentHash: c?.contentHash ?? "" },
  });
}

/**
 * Whether one generation round shows the chapter is exhausted: at least half
 * of what it produced (and at least 2) repeated questions already in the bank.
 */
export function roundShowsSaturation(generated: number, repeatsOfBank: number): boolean {
  return generated > 0 && repeatsOfBank >= Math.max(2, Math.ceil(generated / 2));
}
