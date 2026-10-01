import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getCurrentUser } from "@/lib/get-session";
import { validateCsrfOrigin } from "@/lib/csrf";
import { Difficulty, QuestionStatus, QuestionType } from "@prisma/client";
import Papa from "papaparse";
import { canManageTextbook } from "@/lib/textbook-access";
import { findNearDuplicates, recentChapterQuestions } from "@/lib/question-dedupe";

/**
 * CSV import into one chapter's question bank (multiple choice).
 *
 * Questions written outside Abugida skip the generation pipeline's answer
 * verifier and quality checks, so by default they land as DRAFT, hidden from
 * students until an admin publishes them from the question bank. Rows are
 * also checked against the chapter's saved questions and each other with the
 * same near-duplicate test the generator uses, so a re-uploaded or reworded
 * file does not fill the bank with repeats.
 */

interface CSVRow {
  questionText?: string;
  optionA?: string;
  optionB?: string;
  optionC?: string;
  optionD?: string;
  correctAnswer?: string;
  difficulty?: string;
  explanation?: string;
}

const MAX_ROWS = 500;
const LETTERS = ["A", "B", "C", "D"] as const;

const squash = (t: string) => t.replace(/\s+/g, " ").trim().toLowerCase();

/**
 * The option text a row's `correctAnswer` means. Accepts the full option text
 * (case and spacing ignored) or a letter: "B", "b", "B)", "(B)", "B.",
 * "Option B". Text wins over a letter, so an option that is itself "A" still
 * matches by text. Null when it matches nothing.
 */
function resolveAnswer(answer: string, byLetter: (string | undefined)[], options: string[]): string | null {
  const exact = options.find((o) => o === answer) ?? options.find((o) => squash(o) === squash(answer));
  if (exact) return exact;
  const m = answer.trim().match(/^(?:option\s*)?\(?([a-d])[).:]?$/i);
  if (!m) return null;
  return byLetter[LETTERS.indexOf(m[1].toUpperCase() as (typeof LETTERS)[number])] || null;
}

export async function POST(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!["SUPER_ADMIN", "SCHOOL_ADMIN"].includes(user.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  if (!validateCsrfOrigin(request)) {
    return NextResponse.json({ error: "Invalid request origin" }, { status: 403 });
  }

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return NextResponse.json({ error: "Invalid form data" }, { status: 400 });
  }

  const chapterId = formData.get("chapterId");
  const file = formData.get("file");
  // Drafts unless the admin explicitly chose to publish straight away.
  const status = formData.get("publish") === "1" ? QuestionStatus.PUBLISHED : QuestionStatus.DRAFT;

  if (!chapterId || typeof chapterId !== "string") {
    return NextResponse.json({ error: "chapterId is required" }, { status: 400 });
  }
  if (!file || typeof file === "string") {
    return NextResponse.json({ error: "CSV file is required" }, { status: 400 });
  }

  // Verify chapter belongs to this school
  const chapter = await db.chapter.findUnique({
    where: { id: chapterId },
    select: { id: true, textbook: { select: { schoolId: true } } },
  });
  if (!chapter) {
    return NextResponse.json({ error: "Chapter not found" }, { status: 404 });
  }
  if (!canManageTextbook(user, chapter.textbook.schoolId)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // Excel saves CSV with a byte-order mark, which would rename the first header.
  const csvText = (await (file as Blob).text()).replace(/^﻿/, "");
  const parsed = Papa.parse<CSVRow>(csvText, {
    header: true,
    skipEmptyLines: true,
    transformHeader: (h) => h.trim(),
    transform: (v) => v.trim(),
  });

  if (parsed.data.length > MAX_ROWS) {
    return NextResponse.json(
      { error: `This file has ${parsed.data.length} rows. Import at most ${MAX_ROWS} at a time.` },
      { status: 400 },
    );
  }

  const errors: { row: number; reason: string }[] = [];
  const candidates: {
    row: number;
    data: {
      chapterId: string;
      questionText: string;
      options: string[];
      correctAnswer: string;
      difficulty: Difficulty;
      explanation: string | null;
      type: QuestionType;
      status: QuestionStatus;
    };
  }[] = [];

  const validDifficulties = ["EASY", "MEDIUM", "HARD"];

  for (let i = 0; i < parsed.data.length; i++) {
    const row = parsed.data[i];
    const rowNum = i + 2; // 1-indexed + header row

    const questionText = row.questionText?.trim();
    const byLetter = [row.optionA, row.optionB, row.optionC, row.optionD].map((o) => o?.trim() || undefined);
    const answerRaw = row.correctAnswer?.trim();
    const difficultyRaw = row.difficulty?.trim().toUpperCase() || "MEDIUM";
    const explanation = row.explanation?.trim() || null;

    if (!questionText) { errors.push({ row: rowNum, reason: "questionText is empty" }); continue; }
    if (!byLetter[0] || !byLetter[1]) { errors.push({ row: rowNum, reason: "At least optionA and optionB are required" }); continue; }
    if (!answerRaw) { errors.push({ row: rowNum, reason: "correctAnswer is empty" }); continue; }

    const options = byLetter.filter(Boolean) as string[];
    if (new Set(options.map(squash)).size !== options.length) {
      errors.push({ row: rowNum, reason: "Two options are the same" });
      continue;
    }

    const correctAnswer = resolveAnswer(answerRaw, byLetter, options);
    if (!correctAnswer) {
      errors.push({ row: rowNum, reason: `correctAnswer "${answerRaw}" is not one of the options or A–D` });
      continue;
    }

    const difficulty = validDifficulties.includes(difficultyRaw)
      ? (difficultyRaw as Difficulty)
      : Difficulty.MEDIUM;

    candidates.push({
      row: rowNum,
      data: {
        chapterId,
        questionText,
        options,
        correctAnswer,
        difficulty,
        explanation,
        type: QuestionType.MCQ,
        status,
      },
    });
  }

  // Repeats of the chapter's saved questions (drafts included) or of an
  // earlier row in this file. Degrades to exact-text matching on its own if
  // the embedding service is unavailable.
  let duplicates = 0;
  let toCreate = candidates;
  if (candidates.length > 0) {
    const existing = await recentChapterQuestions(chapterId);
    const hits = await findNearDuplicates(
      candidates.map((c) => c.data),
      existing,
    );
    toCreate = candidates.filter((c, i) => {
      const hit = hits.get(i);
      if (!hit) return true;
      duplicates++;
      errors.push({
        row: c.row,
        reason:
          hit.existingIndex !== null
            ? `Repeats a question already in this chapter: "${existing[hit.existingIndex].questionText.slice(0, 80)}"`
            : `Repeats row ${candidates[hit.candidateIndex!].row}`,
      });
      return false;
    });
  }

  let imported = 0;
  if (toCreate.length > 0) {
    const result = await db.question.createMany({ data: toCreate.map((c) => c.data) });
    imported = result.count;
  }

  errors.sort((a, b) => a.row - b.row);
  return NextResponse.json({
    imported,
    status,
    skipped: errors.length,
    duplicates,
    total: parsed.data.length,
    errors,
  });
}
