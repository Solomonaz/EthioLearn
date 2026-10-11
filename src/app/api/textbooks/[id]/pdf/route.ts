import { NextRequest, NextResponse } from "next/server";
import { createReadStream } from "fs";
import { stat } from "fs/promises";
import path from "path";
import { Readable } from "stream";
import { db } from "@/lib/db";
import { getCurrentUser } from "@/lib/get-session";
import { canReadTextbook } from "@/lib/library-access";
import { UPLOAD_ROOT } from "@/lib/uploads";

/**
 * GET /api/textbooks/[id]/pdf — the book's reader PDF, for the in-app viewer.
 *
 * Range requests are honoured so pdf.js can fetch only the pages being read
 * instead of the whole book (textbooks run to tens of MB on slow connections).
 * Served inline for the viewer, never cached by shared caches, and only to
 * users who may see the book — same rules as GET /api/library.
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;

  const tb = await db.textbook.findUnique({
    where: { id },
    select: { readerFile: true, schoolId: true, grade: true, approvalStatus: true },
  });
  const allowed = !!tb?.readerFile && canReadTextbook(user, tb);
  if (!allowed || !tb?.readerFile || !/^[0-9a-f-]{36}\.pdf$/.test(tb.readerFile)) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const abs = path.join(UPLOAD_ROOT, "textbooks", tb.readerFile);
  let size: number;
  try {
    size = (await stat(abs)).size;
  } catch {
    return NextResponse.json({ error: "The file is missing from storage." }, { status: 404 });
  }

  const headers: Record<string, string> = {
    "Content-Type": "application/pdf",
    "Content-Disposition": "inline",
    "Accept-Ranges": "bytes",
    "X-Content-Type-Options": "nosniff",
    "Cache-Control": "private, max-age=3600",
  };

  let start = 0;
  let end = size - 1;
  let status = 200;
  const range = request.headers.get("range");
  if (range) {
    const m = range.match(/^bytes=(\d*)-(\d*)$/);
    if (!m || (!m[1] && !m[2])) {
      return new NextResponse(null, { status: 416, headers: { "Content-Range": `bytes */${size}` } });
    }
    if (m[1]) {
      start = Number(m[1]);
      end = m[2] ? Math.min(Number(m[2]), size - 1) : size - 1;
    } else {
      start = Math.max(0, size - Number(m[2]));
    }
    if (start > end || start >= size) {
      return new NextResponse(null, { status: 416, headers: { "Content-Range": `bytes */${size}` } });
    }
    status = 206;
    headers["Content-Range"] = `bytes ${start}-${end}/${size}`;
  }

  // Streamed, not buffered: a whole 40 MB book must not sit in memory per reader.
  headers["Content-Length"] = String(end - start + 1);
  const stream = Readable.toWeb(createReadStream(abs, { start, end })) as ReadableStream<Uint8Array>;
  return new NextResponse(stream, { status, headers });
}
