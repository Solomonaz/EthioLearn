/**
 * One-off: convert simple LaTeX in stored questions to plain Unicode.
 *
 * New questions are converted at validation (lib/question-validation) — this
 * brings the existing bank in line: `\(7^5\)` → 7⁵, `$H_2O$` → H₂O. LaTeX that
 * Unicode cannot express (fractions, roots of expressions) is left as-is and
 * still renders through MathText.
 *
 * Touches:
 *   - questions: questionText, options, correctAnswer, explanation
 *   - quiz_answers.studentAnswer for those questions, so a past pick still
 *     equals the (converted) option it chose on the results page
 *   - game_contents.payload: every string inside it
 *
 * An MCQ whose answer would stop matching its options is skipped and listed.
 *
 * Dry run:  npx tsx scripts/normalize-question-math.ts
 * Apply:    npx tsx scripts/normalize-question-math.ts --apply
 */
import "dotenv/config";
import { writeFileSync } from "fs";
import { PrismaClient, type Prisma } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { normalizeMathText as norm, normalizeOptionSet } from "../src/lib/math-notation";

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }),
});

/** Every string in a JSON value, converted; other values untouched. */
function normJson(v: Prisma.JsonValue): Prisma.JsonValue {
  if (typeof v === "string") return norm(v);
  if (Array.isArray(v)) return v.map(normJson);
  if (v && typeof v === "object") {
    return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, normJson(x as Prisma.JsonValue)]));
  }
  return v;
}

const optionText = (o: unknown) =>
  typeof o === "string" ? o : String((o as { text?: unknown })?.text ?? "");

async function main() {
  const apply = process.argv.includes("--apply");
  const report: string[] = [];
  const log = (s: string) => report.push(s);

  // ── Questions ────────────────────────────────────────────────────────────
  const questions = await prisma.question.findMany({
    select: { id: true, type: true, questionText: true, options: true, correctAnswer: true, explanation: true },
  });

  type Change = { id: string; data: Prisma.QuestionUpdateInput };
  const changes: Change[] = [];
  const skipped: string[] = [];
  /** Explanations that read like the model thinking aloud — not changed, listed for a human. */
  const suspicious: string[] = [];
  const fieldCounts = { questionText: 0, options: 0, correctAnswer: 0, explanation: 0 };

  for (const q of questions) {
    const data: Prisma.QuestionUpdateInput = {};
    const diffs: string[] = [];

    const text = norm(q.questionText);
    if (text !== q.questionText) {
      data.questionText = text;
      fieldCounts.questionText++;
      diffs.push(`  text:    ${q.questionText}\n        → ${text}`);
    }
    // Options and answer convert as one set (see normalizeOptionSet), so
    // options never end up in mixed notation that marks one apart.
    const plainOptions = Array.isArray(q.options) && q.options.every((o) => typeof o === "string");
    const set = plainOptions
      ? normalizeOptionSet(q.options as string[], q.correctAnswer)
      : { options: normJson(q.options), answer: norm(q.correctAnswer) };
    const options = set.options as Prisma.JsonValue;
    if (JSON.stringify(options) !== JSON.stringify(q.options)) {
      data.options = options as Prisma.InputJsonValue;
      fieldCounts.options++;
      diffs.push(`  options: ${JSON.stringify(q.options)}\n        → ${JSON.stringify(options)}`);
    }
    const answer = set.answer;
    if (answer !== q.correctAnswer) {
      data.correctAnswer = answer;
      fieldCounts.correctAnswer++;
      diffs.push(`  answer:  ${q.correctAnswer}\n        → ${answer}`);
    }
    if (q.explanation) {
      const exp = norm(q.explanation);
      if (exp !== q.explanation) {
        data.explanation = exp;
        fieldCounts.explanation++;
        diffs.push(`  explain: ${q.explanation}\n        → ${exp}`);
      }
    }
    if (/\b(wait|let's verify|let me|hmm|ah!)/i.test(q.explanation ?? "")) {
      suspicious.push(q.id);
    }
    if (diffs.length === 0) continue;

    // An MCQ must still have its answer among its options afterwards.
    if (q.type === "MCQ" && Array.isArray(q.options)) {
      const before = (q.options as unknown[]).map(optionText).includes(q.correctAnswer);
      const after = (options as unknown[]).map(optionText).includes(answer);
      if (before && !after) {
        skipped.push(q.id);
        log(`SKIP ${q.id} (${q.type}) — answer would stop matching its options\n${diffs.join("\n")}\n`);
        continue;
      }
    }
    changes.push({ id: q.id, data });
    log(`${q.id} (${q.type})\n${diffs.join("\n")}\n`);
  }

  // ── Past answers to the changed questions ───────────────────────────────
  const changedIds = changes.map((c) => c.id);
  const answers = changedIds.length
    ? await prisma.quizAnswer.findMany({
        where: { questionId: { in: changedIds } },
        select: { id: true, studentAnswer: true },
      })
    : [];
  const answerChanges = answers
    .map((a) => ({ id: a.id, from: a.studentAnswer, to: norm(a.studentAnswer) }))
    .filter((a) => a.to !== a.from);

  // ── Teacher game content ─────────────────────────────────────────────────
  const games = await prisma.gameContent.findMany({ select: { id: true, title: true, payload: true } });
  const gameChanges = games
    .map((g) => ({ id: g.id, title: g.title, from: g.payload, to: normJson(g.payload) }))
    .filter((g) => JSON.stringify(g.to) !== JSON.stringify(g.from));
  for (const g of gameChanges) {
    log(`GAME ${g.id} "${g.title}"\n  ${JSON.stringify(g.from)}\n→ ${JSON.stringify(g.to)}\n`);
  }

  // ── Summary ──────────────────────────────────────────────────────────────
  const summary = [
    `Questions scanned:        ${questions.length}`,
    `Questions to update:      ${changes.length}`,
    `  questionText changed:   ${fieldCounts.questionText}`,
    `  options changed:        ${fieldCounts.options}`,
    `  correctAnswer changed:  ${fieldCounts.correctAnswer}`,
    `  explanation changed:    ${fieldCounts.explanation}`,
    `Skipped (would break MCQ): ${skipped.length}`,
    `Explanations to review by hand (model thinking aloud): ${suspicious.length}${suspicious.length ? ` — ${suspicious.join(", ")}` : ""}`,
    `Past student answers:     ${answerChanges.length}`,
    `Game contents scanned:    ${games.length}, to update: ${gameChanges.length}`,
  ].join("\n");

  const outFile = process.env.REPORT_FILE || "normalize-question-math.report.txt";
  writeFileSync(outFile, summary + "\n\n" + report.join("\n"), "utf8");
  console.log(summary);
  console.log(`\nFull diff written to ${outFile}`);

  if (!apply) {
    console.log("\nDry run — nothing written. Re-run with --apply to save.");
    return;
  }

  await prisma.$transaction(
    [
      ...changes.map((c) => prisma.question.update({ where: { id: c.id }, data: c.data })),
      ...answerChanges.map((a) => prisma.quizAnswer.update({ where: { id: a.id }, data: { studentAnswer: a.to } })),
      ...gameChanges.map((g) =>
        prisma.gameContent.update({ where: { id: g.id }, data: { payload: g.to as Prisma.InputJsonValue } })
      ),
    ]
  );
  console.log(`\nApplied: ${changes.length} questions, ${answerChanges.length} answers, ${gameChanges.length} game contents.`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
