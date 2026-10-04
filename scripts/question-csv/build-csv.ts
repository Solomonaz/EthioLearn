/**
 * Build an import CSV from a validated chapter MCQ set, then prove it imports.
 * usage: npx tsx --tsconfig tsconfig.json scripts/question-csv/build-csv.ts <in.mcq.json> <out.csv> <seed>
 */
import { readFileSync, writeFileSync } from "fs";
import Papa from "papaparse";

type Q = { questionText: string; options: string[]; correctAnswer: string; difficulty: string; explanation: string };
const [inp, out, seedArg] = process.argv.slice(2);
const qs: Q[] = JSON.parse(readFileSync(inp, "utf8"));

// Deterministic PRNG so a rebuild gives the same file.
let seed = Number(seedArg) || 1;
const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);

// Balanced answer letters: counts as even as possible, no letter 3 times in a row.
function letters(n: number): number[] {
  for (;;) {
    const pool: number[] = [];
    for (let i = 0; i < n; i++) pool.push(i % 4);
    for (let i = pool.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [pool[i], pool[j]] = [pool[j], pool[i]]; }
    if (!pool.some((x, i) => i >= 2 && x === pool[i - 1] && x === pool[i - 2])) return pool;
  }
}
const target = letters(qs.length);
const L = ["A", "B", "C", "D"];
const HEADER = ["questionText", "optionA", "optionB", "optionC", "optionD", "correctAnswer", "difficulty", "explanation"];

const rows = qs.map((q, i) => {
  const wrong = q.options.filter((o) => o !== q.correctAnswer);
  const opts = [...wrong];
  opts.splice(target[i], 0, q.correctAnswer);
  return { questionText: q.questionText, optionA: opts[0], optionB: opts[1], optionC: opts[2], optionD: opts[3],
           correctAnswer: q.correctAnswer, difficulty: q.difficulty, explanation: q.explanation };
});
// Quote every field: safest for commas, quotes and HTML; Excel- and Sheets-friendly.
const csv = Papa.unparse({ fields: HEADER, data: rows.map((r) => HEADER.map((h) => (r as Record<string, string>)[h])) }, { quotes: true, newline: "\n" });
writeFileSync(out, csv + "\n", "utf8");

// ── Round trip: exactly what src/app/api/admin/questions/import/route.ts does ──
const text = readFileSync(out, "utf8").replace(/^﻿/, "");
const parsed = Papa.parse<Record<string, string>>(text, { header: true, skipEmptyLines: true, transformHeader: (h) => h.trim(), transform: (v) => v.trim() });
const squash = (t: string) => t.replace(/\s+/g, " ").trim().toLowerCase();
function resolveAnswer(answer: string, byLetter: (string | undefined)[], options: string[]): string | null {
  const exact = options.find((o) => o === answer) ?? options.find((o) => squash(o) === squash(answer));
  if (exact) return exact;
  const m = answer.trim().match(/^(?:option\s*)?\(?([a-d])[).:]?$/i);
  if (!m) return null;
  return byLetter[L.indexOf(m[1].toUpperCase())] || null;
}
const problems: string[] = [];
if (parsed.errors.length) problems.push("parse errors: " + JSON.stringify(parsed.errors));
if (JSON.stringify(parsed.meta.fields) !== JSON.stringify(HEADER)) problems.push("header mismatch: " + parsed.meta.fields);
if (parsed.data.length !== qs.length) problems.push(`row count ${parsed.data.length} != ${qs.length}`);
parsed.data.forEach((row, i) => {
  const byLetter = [row.optionA, row.optionB, row.optionC, row.optionD].map((o) => o?.trim() || undefined);
  const options = byLetter.filter(Boolean) as string[];
  const ans = resolveAnswer(row.correctAnswer, byLetter, options);
  const d = (row.difficulty || "MEDIUM").toUpperCase();
  const src = qs[i];
  if (!row.questionText || options.length !== 4 || new Set(options.map(squash)).size !== 4) problems.push(`row ${i + 2}: bad options`);
  if (ans !== src.correctAnswer || options[target[i]] !== src.correctAnswer) problems.push(`row ${i + 2}: answer resolves to ${ans}`);
  if (row.questionText !== src.questionText || row.explanation !== src.explanation || d !== src.difficulty) problems.push(`row ${i + 2}: text changed in round trip`);
  if (new Set(options).size !== new Set(src.options).size || !src.options.every((o) => options.includes(o))) problems.push(`row ${i + 2}: options changed`);
});
const dist = L.map((l, k) => `${l}=${target.filter((t) => t === k).length}`).join(" ");
if (problems.length) { console.log("ROUND TRIP FAILED\n" + problems.join("\n")); process.exit(1); }
console.log(`OK ${out.split("/").pop()}: ${parsed.data.length} rows import cleanly; correct answer positions ${dist}`);
