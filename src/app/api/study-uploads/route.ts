import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getCurrentUser } from "@/lib/get-session";
import {
  checkFile,
  dailyUploadLimit,
  KEEP_DAYS,
  pruneOldUploads,
  tutorGates,
  uploadsToday,
} from "@/lib/study-uploads";

/**
 * /api/study-uploads — a student's photos / small PDFs for the Whiteboard.
 *
 * GET  → their uploads from the last 7 days (no file bytes).
 * POST { file: base64, mimeType, name } → store it, return { id }. No AI call
 *      here: the page then asks the student what they want (see [id]/analyze
 *      and [id]/act). Same gates as the AI tutor (Pro, switch, CSRF, rate
 *      limit), plus a daily upload cap. Files are checked by their real bytes.
 */
export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const rows = await db.studyUpload.findMany({
    where: { userId: user.id, createdAt: { gte: new Date(Date.now() - KEEP_DAYS * 86_400_000) } },
    orderBy: { createdAt: "desc" },
    take: 20,
    select: { id: true, name: true, mime: true, pages: true, analysis: true, createdAt: true },
  });
  return NextResponse.json({
    uploads: rows.map((r) => ({
      id: r.id,
      name: r.name,
      mime: r.mime,
      pages: r.pages,
      title: (r.analysis as { title?: string } | null)?.title ?? null,
      createdAt: r.createdAt,
    })),
  });
}

export async function POST(req: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const gate = await tutorGates(req, user, false);
  if ("refusal" in gate) return gate.refusal;

  if (user.role !== "SUPER_ADMIN") {
    const limit = await dailyUploadLimit();
    if ((await uploadsToday(user.id)) >= limit) {
      return NextResponse.json(
        { error: `You can send up to ${limit} files a day. Try again tomorrow.`, code: "UPLOAD_LIMIT" },
        { status: 429 },
      );
    }
  }

  const body = (await req.json().catch(() => null)) as { file?: unknown; mimeType?: unknown; name?: unknown } | null;
  const checked = await checkFile(body?.file, body?.mimeType);
  if ("refusal" in checked) return checked.refusal;

  const name =
    (typeof body?.name === "string" ? body.name : "")
      .replace(/[\u0000-\u001f\u007f<>"]/g, "")
      .trim()
      .slice(0, 80) || (checked.mime === "application/pdf" ? "Document.pdf" : "Photo");

  await pruneOldUploads();
  const row = await db.studyUpload.create({
    data: { userId: user.id, name, mime: checked.mime, data: new Uint8Array(checked.bytes), pages: checked.pages },
    select: { id: true },
  });
  return NextResponse.json({ id: row.id });
}
