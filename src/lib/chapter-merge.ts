import type { Prisma } from "@prisma/client";

/**
 * Merge one chapter into another inside a transaction: everything that hangs
 * off the source moves to the target, then the source is deleted and the
 * book's chapters are renumbered 1..n.
 *
 * Shared by the admin "merge chapters" action and the fake-chapter repair
 * script. The route used to move only questions and text, which lost two
 * things on the delete:
 *   • content_chunks cascade-deleted — the merged chapter kept the source's
 *     TEXT but lost its embedded passages, so the tutor and the teachers'
 *     assistant could no longer find anything from that part of the chapter;
 *   • class activities pointing at the source had their chapter link nulled.
 * Both now move to the target instead.
 *
 * The target's contentHash is cleared: its content changed, so anything keyed
 * to the old hash (question-bank saturation) must not carry over.
 */
export async function mergeChapterInto(
  tx: Prisma.TransactionClient,
  opts: { textbookId: string; sourceChapterId: string; targetChapterId: string },
): Promise<{ id: string; title: string; chapterNumber: number } | null> {
  const { textbookId, sourceChapterId, targetChapterId } = opts;

  const [source, target] = await Promise.all([
    tx.chapter.findFirst({ where: { id: sourceChapterId, textbookId }, select: { content: true } }),
    tx.chapter.findFirst({ where: { id: targetChapterId, textbookId }, select: { content: true } }),
  ]);
  if (!source || !target) return null;

  // Questions and class activities follow the text.
  await tx.question.updateMany({
    where: { chapterId: sourceChapterId },
    data: { chapterId: targetChapterId },
  });
  await tx.classActivity.updateMany({
    where: { chapterId: sourceChapterId },
    data: { chapterId: targetChapterId },
  });

  // Chunks move too, renumbered after the target's own (chunkIndex is unique
  // per chapter), so their embeddings survive the delete below.
  const last = await tx.$queryRaw<{ max: number | null }[]>`
    SELECT MAX("chunkIndex") AS max FROM content_chunks WHERE "chapterId" = ${targetChapterId}
  `;
  const offset = (last[0]?.max ?? -1) + 1;
  await tx.$executeRaw`
    UPDATE content_chunks
    SET "chapterId" = ${targetChapterId}, "chunkIndex" = "chunkIndex" + ${offset}
    WHERE "chapterId" = ${sourceChapterId}
  `;

  const content = source.content
    ? target.content
      ? `${target.content}\n${source.content}`
      : source.content
    : target.content;
  const questionCount = await tx.question.count({
    where: { chapterId: targetChapterId, status: "PUBLISHED" },
  });
  await tx.chapter.update({
    where: { id: targetChapterId },
    data: { content, contentHash: null, saturatedAt: null, saturatedContentHash: null, questionCount },
  });

  await tx.chapter.delete({ where: { id: sourceChapterId } });

  // Renumber 1..n. Two passes: the (textbookId, chapterNumber) pair is unique.
  const remaining = await tx.chapter.findMany({
    where: { textbookId },
    orderBy: { chapterNumber: "asc" },
    select: { id: true },
  });
  for (let i = 0; i < remaining.length; i++) {
    await tx.chapter.update({ where: { id: remaining[i].id }, data: { chapterNumber: 10000 + i } });
  }
  for (let i = 0; i < remaining.length; i++) {
    await tx.chapter.update({ where: { id: remaining[i].id }, data: { chapterNumber: i + 1 } });
  }

  return tx.chapter.findUnique({
    where: { id: targetChapterId },
    select: { id: true, title: true, chapterNumber: true },
  });
}

/**
 * A "chapter" title that is really an exercise section the splitter mistook
 * for a unit heading: "Part 2: Answer the following questions",
 * "Part 4: Solve the following problems", "Review exercise".
 */
export function looksLikeExerciseSection(title: string): boolean {
  return (
    /^\s*part\s+\d+\s*[:.\-]/i.test(title) ||
    /\b(answer|solve|complete|choose)\s+the\s+following\b/i.test(title) ||
    /^\s*(review|end[-\s]of[-\s]unit)\s+(exercises?|questions?)\s*$/i.test(title)
  );
}
