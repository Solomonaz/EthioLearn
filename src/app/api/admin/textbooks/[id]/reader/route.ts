import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getCurrentUser } from "@/lib/get-session";
import { validateCsrfOrigin } from "@/lib/csrf";
import { canManageTextbook } from "@/lib/textbook-access";
import { MAX_TEXTBOOK_BYTES, deleteTextbookFile, storeTextbookFile } from "@/lib/textbook-ingest";

type RouteParams = { params: Promise<{ id: string }> };

async function authorise(request: NextRequest, id: string) {
  const user = await getCurrentUser();
  if (!user || !["SUPER_ADMIN", "SCHOOL_ADMIN"].includes(user.role)) {
    return { error: NextResponse.json({ error: "Unauthorized" }, { status: 403 }) };
  }
  if (!validateCsrfOrigin(request)) {
    return { error: NextResponse.json({ error: "Invalid request origin" }, { status: 403 }) };
  }
  const tb = await db.textbook.findUnique({ where: { id }, select: { schoolId: true, readerFile: true } });
  if (!tb || !canManageTextbook(user, tb.schoolId)) {
    return { error: NextResponse.json({ error: "Not found" }, { status: 404 }) };
  }
  return { tb };
}

/**
 * POST /api/admin/textbooks/[id]/reader — attach the PDF students read in the
 * Library (multipart field: file). Separate from processing: replacing it
 * changes nothing about chapters, questions or embeddings.
 */
export async function POST(request: NextRequest, { params }: RouteParams) {
  const { id } = await params;
  const auth = await authorise(request, id);
  if ("error" in auth) return auth.error;

  const form = await request.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof File)) return NextResponse.json({ error: "Please choose a PDF." }, { status: 400 });
  if (!file.name.toLowerCase().endsWith(".pdf")) return NextResponse.json({ error: "The reader needs a PDF file." }, { status: 400 });
  if (file.size > MAX_TEXTBOOK_BYTES) return NextResponse.json({ error: "File too large. Maximum size is 50 MB." }, { status: 400 });

  let key: string;
  try {
    key = await storeTextbookFile(Buffer.from(await file.arrayBuffer()), file.name);
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Could not store the file." }, { status: 400 });
  }
  await db.textbook.update({ where: { id }, data: { readerFile: key, readerFileSize: file.size } });
  await deleteTextbookFile(auth.tb.readerFile);
  return NextResponse.json({ success: true, size: file.size });
}

/** DELETE /api/admin/textbooks/[id]/reader — take the book out of the Library. */
export async function DELETE(request: NextRequest, { params }: RouteParams) {
  const { id } = await params;
  const auth = await authorise(request, id);
  if ("error" in auth) return auth.error;
  await db.textbook.update({ where: { id }, data: { readerFile: null, readerFileSize: null } });
  await deleteTextbookFile(auth.tb.readerFile);
  return NextResponse.json({ success: true });
}
