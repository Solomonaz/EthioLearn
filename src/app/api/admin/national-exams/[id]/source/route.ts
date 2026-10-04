import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getCurrentUser } from "@/lib/get-session";
import { readTextbookFile } from "@/lib/textbook-ingest";

/** GET /api/admin/national-exams/[id]/source — the uploaded PDF, to compare against while reviewing. */
export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (user?.role !== "SUPER_ADMIN") return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  const { id } = await params;
  const exam = await db.nationalExam.findUnique({ where: { id }, select: { sourceFile: true, sourceFileName: true } });
  if (!exam?.sourceFile) return NextResponse.json({ error: "Not found" }, { status: 404 });
  let bytes: Buffer;
  try {
    bytes = await readTextbookFile(exam.sourceFile);
  } catch {
    return NextResponse.json({ error: "The file is missing from storage." }, { status: 404 });
  }
  const name = (exam.sourceFileName ?? "exam.pdf").replace(/[^\w.\- ]+/g, "_");
  return new NextResponse(new Uint8Array(bytes), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${name}"`,
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "private, no-store",
    },
  });
}
