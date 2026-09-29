import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getCurrentUser } from "@/lib/get-session";
import { validateCsrfOrigin } from "@/lib/csrf";
import Papa from "papaparse";
import { isValidSection, MAX_SECTION_LENGTH, normalizeSection } from "@/lib/section";
import { generateTempPassword, generateUsername, hashPassword } from "@/lib/password";

/**
 * POST /api/admin/students/import  { csvData }
 *
 * CSV columns: name, grade, section. Each student gets a school-issued
 * username and a temporary password; the full list comes back ONCE in
 * `credentials` for the admin to print or save — passwords are never stored
 * in readable form. Each student replaces theirs at first sign-in.
 *
 * Rows are matched against existing students of the same school by name,
 * grade and section, so re-uploading a file does not create everyone twice.
 */

interface CsvRow {
  name?: string;
  grade?: string;
  section?: string;
}

/** Most rows in one upload. Hashing each password takes real CPU time. */
const MAX_ROWS = 1000;

function matchKey(name: string, grade: number, section: string): string {
  return `${name.toLowerCase().replace(/\s+/g, " ")}::${grade}::${section}`;
}

export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user || !["SUPER_ADMIN", "SCHOOL_ADMIN"].includes(user.role)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  }

  if (!validateCsrfOrigin(req)) {
    return NextResponse.json({ error: "Invalid request origin" }, { status: 403 });
  }

  // Elementary schools have no students on the school side — their teachers
  // run single-screen classroom games with no pupil accounts.
  if (user.school?.level === "ELEMENTARY") {
    return NextResponse.json(
      { error: "Elementary schools do not register students." },
      { status: 403 },
    );
  }

  let body: { csvData?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { csvData } = body;
  if (!csvData || typeof csvData !== "string") {
    return NextResponse.json(
      { error: "csvData string is required" },
      { status: 400 }
    );
  }

  const parsed = Papa.parse<CsvRow>(csvData, {
    header: true,
    skipEmptyLines: true,
    transformHeader: (header: string) => header.trim().toLowerCase(),
  });

  if (parsed.data.length > MAX_ROWS) {
    return NextResponse.json(
      { error: `Upload at most ${MAX_ROWS} students at a time — split the file.` },
      { status: 400 }
    );
  }

  const errors: { row: number; message: string }[] = [];
  const valid: { name: string; grade: number; section: string }[] = [];

  for (let i = 0; i < parsed.data.length; i++) {
    const row = parsed.data[i];
    const rowNum = i + 2; // 1-indexed + header row

    const name = row.name?.trim().replace(/\s+/g, " ");
    if (!name || name.length < 2 || name.length > 50) {
      errors.push({ row: rowNum, message: "Name is required (2-50 characters)" });
      continue;
    }

    const gradeStr = row.grade?.trim();
    if (!gradeStr) {
      errors.push({ row: rowNum, message: "Grade is required" });
      continue;
    }
    const gradeNum = parseInt(gradeStr, 10);
    if (isNaN(gradeNum) || gradeNum < 1 || gradeNum > 12) {
      errors.push({
        row: rowNum,
        message: `Grade must be between 1 and 12, got: ${gradeStr}`,
      });
      continue;
    }

    const section = normalizeSection(row.section);
    if (!isValidSection(section)) {
      errors.push({
        row: rowNum,
        message: "Section is required (up to " + MAX_SECTION_LENGTH + " characters), e.g. A",
      });
      continue;
    }

    valid.push({ name, grade: gradeNum, section: section as string });
  }

  // Skip students already in this school (same name, grade and section), and
  // repeats within the file itself.
  const existing = await db.user.findMany({
    where: { role: "STUDENT", schoolId: user.schoolId ?? null },
    select: { name: true, grade: true, section: true },
  });
  const seen = new Set(
    existing
      .filter((e) => e.grade !== null && e.section)
      .map((e) => matchKey(e.name, e.grade as number, e.section as string)),
  );

  const reserved = new Set<string>();
  const credentials: {
    name: string;
    grade: number;
    section: string;
    username: string;
    tempPassword: string;
  }[] = [];
  let skipped = 0;

  for (const row of valid) {
    const key = matchKey(row.name, row.grade, row.section);
    if (seen.has(key)) {
      skipped++;
      continue;
    }
    seen.add(key);

    const username = await generateUsername(row.name, reserved);
    const tempPassword = generateTempPassword();
    credentials.push({ ...row, username, tempPassword });
  }

  // Hash in parallel (scrypt runs on libuv's thread pool), then insert.
  const hashes = await Promise.all(credentials.map((c) => hashPassword(c.tempPassword)));
  if (credentials.length > 0) {
    await db.user.createMany({
      data: credentials.map((c, i) => ({
        name: c.name,
        username: c.username,
        passwordHash: hashes[i],
        mustChangePassword: true,
        grade: c.grade,
        section: c.section,
        role: "STUDENT" as const,
        schoolId: user.schoolId,
        isActive: true,
      })),
    });
  }

  return NextResponse.json({
    imported: credentials.length,
    skipped,
    errors,
    credentials,
  });
}
