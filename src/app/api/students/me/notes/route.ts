import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getCurrentUser } from "@/lib/get-session";
import { validateCsrfOrigin } from "@/lib/csrf";

const MAX_TITLE = 120; // characters of a note title
const MAX_NOTES = 60; // per student, to keep the list sane

// ─── GET: list the current student's notes (lightweight metadata only) ──
export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const notes = await db.studentNote.findMany({
    where: { userId: user.id },
    select: { id: true, title: true, updatedAt: true },
    orderBy: { createdAt: "asc" },
  });

  return NextResponse.json({ notes });
}

// ─── POST: create a new (empty) note ──
export async function POST(req: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!validateCsrfOrigin(req)) {
    return NextResponse.json({ error: "Invalid request origin" }, { status: 403 });
  }

  const count = await db.studentNote.count({ where: { userId: user.id } });
  if (count >= MAX_NOTES) {
    return NextResponse.json(
      { error: `You can keep up to ${MAX_NOTES} notes. Delete one to add another.` },
      { status: 400 },
    );
  }

  let body: { title?: unknown } = {};
  try {
    body = await req.json();
  } catch {
    /* an empty body is fine — we default the title */
  }

  const rawTitle = typeof body.title === "string" ? body.title.trim() : "";
  const title = (rawTitle || "Untitled").slice(0, MAX_TITLE);

  const note = await db.studentNote.create({
    data: { userId: user.id, title },
    select: { id: true, title: true, updatedAt: true },
  });

  return NextResponse.json({ note });
}
