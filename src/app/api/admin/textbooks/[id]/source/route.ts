import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getCurrentUser } from "@/lib/get-session";
import { canManageTextbook } from "@/lib/textbook-access";
import { readTextbookFile } from "@/lib/textbook-ingest";

const CONTENT_TYPES: Record<string, string> = {
  pdf: "application/pdf",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  doc: "application/msword",
  epub: "application/epub+zip",
};

/**
 * GET /api/admin/textbooks/[id]/source — download a request's held file, so
 * the reviewer can look at the book before approving it. Always served as an
 * attachment, never inline.
 */
export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user || !["SUPER_ADMIN", "SCHOOL_ADMIN"].includes(user.role)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  }

  const { id } = await params;
  const tb = await db.textbook.findUnique({
    where: { id },
    select: { schoolId: true, sourceFile: true, sourceFileName: true },
  });
  if (!tb || !canManageTextbook(user, tb.schoolId)) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  if (!tb.sourceFile) {
    return NextResponse.json({ error: "No file is held for this textbook." }, { status: 404 });
  }

  let bytes: Buffer;
  try {
    bytes = await readTextbookFile(tb.sourceFile);
  } catch {
    return NextResponse.json({ error: "The file is missing from storage." }, { status: 404 });
  }

  const ext = tb.sourceFile.split(".").pop() ?? "pdf";
  const downloadName = (tb.sourceFileName ?? `textbook.${ext}`).replace(/[^\w.\- ]+/g, "_");
  return new NextResponse(new Uint8Array(bytes), {
    headers: {
      "Content-Type": CONTENT_TYPES[ext] ?? "application/octet-stream",
      "Content-Disposition": `attachment; filename="${downloadName}"`,
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "private, no-store",
    },
  });
}
