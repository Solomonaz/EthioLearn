import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getCurrentUser } from "@/lib/get-session";
import { validateCsrfOrigin } from "@/lib/csrf";
import { deleteExamImage, storeExamImage } from "@/lib/national-exam";

type RouteParams = { params: Promise<{ id: string; qid: string }> };

/** POST — attach (or replace) the figure a question refers to. Multipart field: file. */
export async function POST(request: NextRequest, { params }: RouteParams) {
  const user = await getCurrentUser();
  if (user?.role !== "SUPER_ADMIN") return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  if (!validateCsrfOrigin(request)) return NextResponse.json({ error: "Invalid request origin" }, { status: 403 });
  const { id, qid } = await params;
  const q = await db.nationalExamQuestion.findFirst({ where: { id: qid, examId: id }, select: { imageFile: true } });
  if (!q) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const form = await request.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof File)) return NextResponse.json({ error: "Please choose an image." }, { status: 400 });

  let key: string;
  try {
    key = await storeExamImage(Buffer.from(await file.arrayBuffer()), file.name);
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Could not store the image." }, { status: 400 });
  }
  await db.nationalExamQuestion.update({ where: { id: qid }, data: { imageFile: key } });
  await deleteExamImage(q.imageFile);
  return NextResponse.json({ success: true });
}

/** DELETE — remove the question's figure. */
export async function DELETE(request: NextRequest, { params }: RouteParams) {
  const user = await getCurrentUser();
  if (user?.role !== "SUPER_ADMIN") return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  if (!validateCsrfOrigin(request)) return NextResponse.json({ error: "Invalid request origin" }, { status: 403 });
  const { id, qid } = await params;
  const q = await db.nationalExamQuestion.findFirst({ where: { id: qid, examId: id }, select: { imageFile: true } });
  if (!q) return NextResponse.json({ error: "Not found" }, { status: 404 });
  await db.nationalExamQuestion.update({ where: { id: qid }, data: { imageFile: null } });
  await deleteExamImage(q.imageFile);
  return NextResponse.json({ success: true });
}
