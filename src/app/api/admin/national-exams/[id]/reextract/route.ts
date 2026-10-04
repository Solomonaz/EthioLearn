import { NextRequest, NextResponse, after } from "next/server";
import { db } from "@/lib/db";
import { getCurrentUser } from "@/lib/get-session";
import { validateCsrfOrigin } from "@/lib/csrf";
import { extractNationalExam } from "@/lib/national-exam";

/**
 * POST /api/admin/national-exams/[id]/reextract — read the uploaded PDF again.
 * Replaces every question (and its edits), so it is refused for a published paper.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (user?.role !== "SUPER_ADMIN") return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  if (!validateCsrfOrigin(request)) return NextResponse.json({ error: "Invalid request origin" }, { status: 403 });
  const { id } = await params;
  const exam = await db.nationalExam.findUnique({ where: { id }, select: { status: true, sourceFile: true } });
  if (!exam) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (!exam.sourceFile) return NextResponse.json({ error: "The original PDF is no longer stored." }, { status: 409 });
  if (exam.status === "PUBLISHED") return NextResponse.json({ error: "Unpublish the paper first." }, { status: 409 });
  if (exam.status === "EXTRACTING") return NextResponse.json({ error: "Extraction is already running." }, { status: 409 });
  await db.nationalExam.update({ where: { id }, data: { status: "EXTRACTING", extractionError: null } });
  after(() => extractNationalExam(id));
  return NextResponse.json({ success: true });
}
