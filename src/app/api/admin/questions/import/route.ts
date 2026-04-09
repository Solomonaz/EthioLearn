import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getCurrentUser } from "@/lib/get-session";
import { validateCsrfOrigin } from "@/lib/csrf";
import { Difficulty, QuestionType } from "@prisma/client";
import Papa from "papaparse";

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
  if (user.role === "SCHOOL_ADMIN" && user.schoolId && chapter.textbook.schoolId !== user.schoolId) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const csvText = await (file as Blob).text();
  const parsed = Papa.parse<CSVRow>(csvText, {
    header: true,
    skipEmptyLines: true,
    transformHeader: (h) => h.trim(),
    transform: (v) => v.trim(),
  });

  const errors: { row: number; reason: string }[] = [];
  const toCreate: {
    chapterId: string;
    questionText: string;
    options: string[];
    correctAnswer: string;
    difficulty: Difficulty;
    explanation: string | null;
    type: QuestionType;
  }[] = [];

  const validDifficulties = ["EASY", "MEDIUM", "HARD"];

  for (let i = 0; i < parsed.data.length; i++) {
    const row = parsed.data[i];
    const rowNum = i + 2; // 1-indexed + header row

    const questionText = row.questionText?.trim();
    const optionA = row.optionA?.trim();
    const optionB = row.optionB?.trim();
    const optionC = row.optionC?.trim();
    const optionD = row.optionD?.trim();
    const correctAnswer = row.correctAnswer?.trim();
    const difficultyRaw = row.difficulty?.trim().toUpperCase() ?? "MEDIUM";
    const explanation = row.explanation?.trim() || null;

    if (!questionText) { errors.push({ row: rowNum, reason: "questionText is empty" }); continue; }
    if (!optionA || !optionB) { errors.push({ row: rowNum, reason: "At least optionA and optionB are required" }); continue; }
    if (!correctAnswer) { errors.push({ row: rowNum, reason: "correctAnswer is empty" }); continue; }

    const options = [optionA, optionB, optionC, optionD].filter(Boolean) as string[];
    if (!options.includes(correctAnswer)) {
      errors.push({ row: rowNum, reason: `correctAnswer "${correctAnswer}" not found in options` });
      continue;
    }

    const difficulty = validDifficulties.includes(difficultyRaw)
      ? (difficultyRaw as Difficulty)
      : Difficulty.MEDIUM;

    toCreate.push({
      chapterId,
      questionText,
      options,
      correctAnswer,
      difficulty,
      explanation,
      type: QuestionType.MCQ,
    });
  }

  let imported = 0;
  if (toCreate.length > 0) {
    const result = await db.question.createMany({ data: toCreate });
    imported = result.count;
  }

  return NextResponse.json({
    imported,
    skipped: errors.length,
    total: parsed.data.length,
    errors,
  });
}
