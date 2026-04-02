import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getCurrentUser } from "@/lib/get-session";
import Papa from "papaparse";
import { Prisma } from "@prisma/client";

interface CsvRow {
  name?: string;
  phone?: string;
  phoneNumber?: string;
  grade?: string;
  section?: string;
}

function normalizePhone(phone: string): string | null {
  const trimmed = phone.trim();

  // Validate Ethiopian phone format
  if (
    !trimmed.startsWith("0") &&
    !trimmed.startsWith("+251") &&
    !trimmed.startsWith("251")
  ) {
    return null;
  }

  if (trimmed.startsWith("0")) {
    return "+251" + trimmed.slice(1);
  }
  if (trimmed.startsWith("251")) {
    return "+" + trimmed;
  }
  // Already starts with +251
  return trimmed;
}

export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user || !["SUPER_ADMIN", "SCHOOL_ADMIN"].includes(user.role)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
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

  const errors: { row: number; message: string }[] = [];
  const validRows: Prisma.UserCreateManyInput[] = [];

  for (let i = 0; i < parsed.data.length; i++) {
    const row = parsed.data[i];
    const rowNum = i + 2; // 1-indexed + header row

    // Name validation
    const name = row.name?.trim();
    if (!name) {
      errors.push({ row: rowNum, message: "Name is required" });
      continue;
    }

    // Phone validation and normalization
    const rawPhone = (row.phone || row.phoneNumber || "").trim();
    if (!rawPhone) {
      errors.push({ row: rowNum, message: "Phone number is required" });
      continue;
    }

    const normalizedPhone = normalizePhone(rawPhone);
    if (!normalizedPhone) {
      errors.push({
        row: rowNum,
        message: `Invalid Ethiopian phone format: ${rawPhone}`,
      });
      continue;
    }

    // Grade validation
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

    const section = row.section?.trim() || null;

    validRows.push({
      name,
      phoneNumber: normalizedPhone,
      grade: gradeNum,
      section,
      role: "STUDENT" as const,
      schoolId: user.schoolId,
      isActive: true,
    });
  }

  let imported = 0;
  if (validRows.length > 0) {
    const result = await db.user.createMany({
      data: validRows,
      skipDuplicates: true,
    });
    imported = result.count;
  }

  const skipped = validRows.length - imported;

  return NextResponse.json({
    imported,
    skipped,
    errors,
  });
}
