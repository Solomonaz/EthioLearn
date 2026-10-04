import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getCurrentUser } from "@/lib/get-session";
import { IMAGE_CONTENT_TYPES, readExamImage } from "@/lib/national-exam";

/**
 * GET /api/national-exams/images/[qid] — a question's figure. Students may see
 * figures of published papers only; the super admin sees any paper's. Served
 * inline (it is shown in the question) with a fixed image type and nosniff:
 * only JPG/PNG/WebP are ever stored, none of which can execute.
 */
export async function GET(_request: NextRequest, { params }: { params: Promise<{ qid: string }> }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { qid } = await params;
  const q = await db.nationalExamQuestion.findUnique({
    where: { id: qid },
    select: { imageFile: true, exam: { select: { status: true } } },
  });
  if (!q?.imageFile || (q.exam.status !== "PUBLISHED" && user.role !== "SUPER_ADMIN")) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  let bytes: Buffer;
  try {
    bytes = await readExamImage(q.imageFile);
  } catch {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const ext = q.imageFile.split(".").pop() ?? "png";
  return new NextResponse(new Uint8Array(bytes), {
    headers: {
      "Content-Type": IMAGE_CONTENT_TYPES[ext] ?? "application/octet-stream",
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "private, max-age=3600",
    },
  });
}
