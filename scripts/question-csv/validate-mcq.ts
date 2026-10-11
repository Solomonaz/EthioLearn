/**
 * Validates one chapter's MCQ set before it becomes an import CSV.
 * Hard errors (exit 1): anything the importer would reject or change, the app's
 * own generated-question validator would drop, or the quiz screen would show badly.
 * Warnings: quality signals to review (not blocking).
 */
import { readFileSync } from "fs";
import { validateQuestions } from "@/lib/question-validation";
import { sanitizeQuestionText } from "@/lib/question-prompts";
import { splitForDisplay } from "@/lib/math-notation";
import { questionFacts, judgeRepeat } from "@/lib/question-similarity";

type Q = { questionText: string; options: string[]; correctAnswer: string; difficulty: string; explanation: string };
const file = process.argv[2];
const arr: Q[] = JSON.parse(readFileSync(file, "utf8"));
const errors: string[] = [];
const warns: string[] = [];
const squash = (t: string) => t.replace(/\s+/g, " ").trim().toLowerCase();
const words = (t: string) => new Set(squash(t).replace(/[^a-z0-9 ]/g, " ").split(" ").filter((w) => w.length > 3));
const jacc = (a: Set<string>, b: Set<string>) => { let s = 0; for (const x of a) if (b.has(x)) s++; return s / (a.size + b.size - s || 1); };

if (arr.length !== 30) errors.push(`expected 30 questions, found ${arr.length}`);
const keys = ["questionText", "options", "correctAnswer", "difficulty", "explanation"];
arr.forEach((q, i) => {
  const n = `#${i + 1}`;
  const extra = Object.keys(q).filter((k) => !keys.includes(k));
  if (extra.length) errors.push(`${n} unexpected keys ${extra.join(",")}`);
  const all = [q.questionText, ...(q.options ?? []), q.correctAnswer, q.explanation];
  if (all.some((v) => typeof v !== "string")) { errors.push(`${n} non-string field`); return; }
  if (all.some((v) => /[\r\n\t]/.test(v))) errors.push(`${n} contains a line break/tab (the quiz screen collapses them) — put code on one line, e.g. with ';'`);
  if (all.some((v) => v !== v.trim())) errors.push(`${n} leading/trailing spaces (importer trims them)`);
  if (q.options.length !== 4) errors.push(`${n} needs exactly 4 options`);
  if (new Set(q.options.map(squash)).size !== q.options.length) errors.push(`${n} two options are the same`);
  if (q.options.filter((o) => o === q.correctAnswer).length !== 1) errors.push(`${n} correctAnswer must equal exactly one option, character for character`);
  if (q.options.some((o) => /^[A-Da-d]$/.test(o.trim()))) errors.push(`${n} an option is a bare letter A-D (importer would read it as a letter)`);
  if (!["EASY", "MEDIUM", "HARD"].includes(q.difficulty)) errors.push(`${n} difficulty must be EASY|MEDIUM|HARD`);
  if (!q.questionText.endsWith("?")) errors.push(`${n} question should end with "?"`);
  if (/_{3,}/.test(q.questionText)) errors.push(`${n} blank-style "____" stem is not allowed for MCQ`);
  if (sanitizeQuestionText(q.questionText) !== q.questionText) errors.push(`${n} meta-reference lead-in ("According to the chapter…") — the app strips these`);
  if (/\b(the|this) (chapter|text|passage|textbook|unit|lesson)\b|\bgrade \d+ (textbook|book)\b/i.test(q.questionText)) errors.push(`${n} refers to the chapter/text/textbook`);
  if (/\b(all|none) of the (above|below|these)\b|\bboth [a-d] and [a-d]\b|\bneither [a-d] nor [a-d]\b/i.test(q.options.join(" | "))) errors.push(`${n} banned meta option`);
  if (/\boption ?[1-4a-d]\b|\b(first|second|third|fourth|last) option\b|\b(choice|answer) [a-d]\b/i.test(q.explanation)) errors.push(`${n} explanation refers to an option by position (options are reordered/shuffled)`);
  if (q.explanation.length < 40) errors.push(`${n} explanation too short`);
  if ([q.questionText, ...q.options].some((t) => splitForDisplay(t).some((s) => "math" in s))) warns.push(`${n} contains math markup (^, √, $…$) that will render as maths — check it is intended`);
  if (squash(q.questionText).includes(squash(q.correctAnswer)) && q.correctAnswer.length > 4) warns.push(`${n} answer text appears in the stem`);
  const lens = q.options.map((o) => o.length).sort((a, b) => b - a);
  if (q.correctAnswer.length === lens[0] && lens[0] > 1.6 * lens[1] && lens[0] > 25) warns.push(`${n} correct option is much longer than every distractor (length cue)`);
});
// The app's own validator for generated MCQs.
const app = validateQuestions(arr.map((q) => ({ ...q, type: "MCQ" })));
if (app.length !== arr.length) errors.push(`${arr.length - app.length} question(s) rejected by the app's validateQuestions`);
// Repeats: exact, lexical, same-answer (what the importer's dedupe looks at).
for (let i = 0; i < arr.length; i++) for (let j = 0; j < i; j++) {
  const a = arr[i], b = arr[j];
  if (squash(a.questionText) === squash(b.questionText)) errors.push(`#${i + 1} repeats #${j + 1} exactly`);
  const sim = jacc(words(a.questionText), words(b.questionText));
  if (sim >= 0.6) warns.push(`#${i + 1} and #${j + 1} worded very similarly (${Math.round(sim * 100)}%)`);
  if (squash(a.correctAnswer) === squash(b.correctAnswer) && judgeRepeat(0.96, questionFacts(a), questionFacts(b)).repeat && sim >= 0.3)
    warns.push(`#${i + 1} and #${j + 1} share the answer "${a.correctAnswer.slice(0, 40)}" — make sure they test different things`);
}
const dif: Record<string, number> = {};
arr.forEach((q) => (dif[q.difficulty] = (dif[q.difficulty] ?? 0) + 1));
const longest = arr.filter((q) => q.correctAnswer.length === Math.max(...q.options.map((o) => o.length))).length;
console.log(`questions=${arr.length} difficulty=${JSON.stringify(dif)} correct-is-longest=${longest}/${arr.length}`);
if (longest > 12) warns.push(`correct option is the longest in ${longest}/30 questions — students can guess by length; target ≤ 12`);
for (const w of warns) console.log("WARN  " + w);
for (const e of errors) console.log("ERROR " + e);
if (errors.length) { console.log("INVALID ✗"); process.exit(1); }
console.log("VALID ✓");
