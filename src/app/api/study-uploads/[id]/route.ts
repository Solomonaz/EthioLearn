import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getCurrentUser } from "@/lib/get-session";
import { validateCsrfOrigin } from "@/lib/csrf";
import { ownUpload, readResults } from "@/lib/study-uploads";

/**
 * GET    /api/study-uploads/[id] → the student's own upload: name, type, what the
 *        guide found in it, and the lessons / practice sets already made.
 * DELETE /api/study-uploads/[id] → remove it now (it would go after 7 days anyway).
 * Anyone else's id answers 404.
 */
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await ctx.params;
  const up = await ownUpload(id, user.id);
  if (!up) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({
    id: up.id,
    name: up.name,
    mime: up.mime,
    pages: up.pages,
    analysis: up.analysis,
    results: readResults(up.results),
    createdAt: up.createdAt,
  });
}

export async function DELETE(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!validateCsrfOrigin(req)) return NextResponse.json({ error: "Invalid request origin" }, { status: 403 });
  const { id } = await ctx.params;
  const up = await ownUpload(id, user.id);
  if (!up) return NextResponse.json({ error: "Not found" }, { status: 404 });
  await db.studyUpload.delete({ where: { id: up.id } });
  return NextResponse.json({ ok: true });
}
