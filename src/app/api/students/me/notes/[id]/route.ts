import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getCurrentUser } from "@/lib/get-session";
import { validateCsrfOrigin } from "@/lib/csrf";

// Guard rails so a note can't grow unbounded in the DB.
const MAX_TITLE = 120; // characters of a note title
const MAX_CONTENT = 50_000; // characters of typed text
const MAX_DRAWING = 3_000_000; // ~3 MB data URL

type Ctx = { params: Promise<{ id: string }> };

// ─── GET: load one note (full content + drawing), scoped to the owner ──
export async function GET(_req: Request, { params }: Ctx) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const note = await db.studentNote.findFirst({
    where: { id, userId: user.id },
    select: { id: true, title: true, content: true, drawing: true, updatedAt: true },
  });
  if (!note) return NextResponse.json({ error: "Not found" }, { status: 404 });

  // Context columns via raw SQL — see the note in ../route.ts.
  const ctx = await db.$queryRaw<{ contextLabel: string | null; contextPath: string | null }[]>`
    SELECT "contextLabel", "contextPath" FROM student_notes WHERE id = ${id} AND "userId" = ${user.id}
  `;

  return NextResponse.json({ note: { ...note, ...(ctx[0] ?? { contextLabel: null, contextPath: null }) } });
}

// ─── PATCH: update a note's title / content / drawing ──
export async function PATCH(req: Request, { params }: Ctx) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!validateCsrfOrigin(req)) {
    return NextResponse.json({ error: "Invalid request origin" }, { status: 403 });
  }

  const { id } = await params;

  let body: { title?: unknown; content?: unknown; drawing?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const data: { title?: string; content?: string | null; drawing?: string | null } = {};
  if (typeof body.title === "string") {
    // Empty is allowed: the panel shows the note’s first line instead.
    data.title = body.title.trim().slice(0, MAX_TITLE);
  }
  if ("content" in body) {
    data.content = typeof body.content === "string" ? body.content.slice(0, MAX_CONTENT) : null;
  }
  if ("drawing" in body) {
    data.drawing =
      typeof body.drawing === "string" && body.drawing.startsWith("data:image")
        ? body.drawing.slice(0, MAX_DRAWING)
        : null;
  }

  // updateMany with the owner in the filter guarantees a student can only
  // ever touch their own note (returns count 0 for anything else).
  const res = await db.studentNote.updateMany({
    where: { id, userId: user.id },
    data,
  });
  if (res.count === 0) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const note = await db.studentNote.findFirst({
    where: { id, userId: user.id },
    select: { id: true, title: true, updatedAt: true },
  });

  return NextResponse.json({ success: true, note });
}

// ─── DELETE: remove a note ──
export async function DELETE(req: Request, { params }: Ctx) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!validateCsrfOrigin(req)) {
    return NextResponse.json({ error: "Invalid request origin" }, { status: 403 });
  }

  const { id } = await params;
  const res = await db.studentNote.deleteMany({ where: { id, userId: user.id } });
  if (res.count === 0) return NextResponse.json({ error: "Not found" }, { status: 404 });

  return NextResponse.json({ success: true });
}
