/**
 * One-off repair: merge "chapters" that are really exercise sections back into
 * the unit they belong to.
 *
 * The chapter splitter took end-of-section headings for unit headings, so
 * Grade 11 Chemistry had "3. Part 2: Answer the following questions" and
 * "5. Part 4: Solve the following problems" — each holding the second half of
 * the unit before it (covalent bonding; the gas laws). Teachers and students
 * saw them as chapters in every picker, and the real units looked half-empty.
 *
 * Each one is merged into the chapter immediately before it with
 * lib/chapter-merge, which moves questions, class activities and embedded
 * chunks, then renumbers the book. The detection prompt no longer produces
 * these (lib/groq buildChapterDetectionPrompt, rule 7).
 *
 * Dry run:  npx tsx scripts/merge-exercise-chapters.ts
 * Apply:    npx tsx scripts/merge-exercise-chapters.ts --apply
 */
import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { looksLikeExerciseSection, mergeChapterInto } from "../src/lib/chapter-merge";

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }),
});

async function main() {
  const apply = process.argv.includes("--apply");
  const books = await prisma.textbook.findMany({
    select: {
      id: true,
      title: true,
      chapters: {
        orderBy: { chapterNumber: "asc" },
        select: { id: true, chapterNumber: true, title: true, content: true },
      },
    },
  });

  const plan: { textbookId: string; book: string; source: { id: string; label: string }; target: { id: string; label: string } }[] = [];
  for (const b of books) {
    b.chapters.forEach((c, i) => {
      if (!looksLikeExerciseSection(c.title)) return;
      const prev = b.chapters[i - 1];
      if (!prev) {
        console.log(`SKIP ${b.title} ch.${c.chapterNumber} "${c.title}" — no chapter before it to merge into.`);
        return;
      }
      plan.push({
        textbookId: b.id,
        book: b.title,
        source: { id: c.id, label: `${c.chapterNumber}. ${c.title}` },
        target: { id: prev.id, label: `${prev.chapterNumber}. ${prev.title}` },
      });
    });
  }

  if (plan.length === 0) {
    console.log("No exercise-section chapters found.");
    return;
  }

  for (const p of plan) {
    const [questions, activities, chunks] = await Promise.all([
      prisma.question.count({ where: { chapterId: p.source.id } }),
      prisma.classActivity.count({ where: { chapterId: p.source.id } }),
      prisma.contentChunk.count({ where: { chapterId: p.source.id } }),
    ]);
    console.log(
      `${p.book}: merge "${p.source.label}" into "${p.target.label}" — ` +
        `moves ${questions} question(s), ${activities} activit${activities === 1 ? "y" : "ies"}, ${chunks} chunk(s)`
    );
  }

  if (!apply) {
    console.log("\nDry run — nothing written. Re-run with --apply to merge.");
    return;
  }

  // One merge per transaction: each renumbers the book, so the next source
  // is looked up by id (stable), never by its old chapter number.
  for (const p of plan) {
    await prisma.$transaction(
      (tx) => mergeChapterInto(tx, { textbookId: p.textbookId, sourceChapterId: p.source.id, targetChapterId: p.target.id }),
      { timeout: 60_000 },
    );
    console.log(`Merged "${p.source.label}".`);
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
