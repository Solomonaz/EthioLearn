import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getCurrentUser } from "@/lib/get-session";
import { validateCsrfOrigin } from "@/lib/csrf";

const MAX_TITLE = 120; // characters of a note title
const MAX_NOTES = 60; // per student, to keep the list sane
const MAX_CONTEXT_LABEL = 120;
const MAX_CONTEXT_PATH = 200;
const SNIPPET_CHARS = 160; // preview text shown in the list and searched

// The context columns (what the student was studying) are read and written
// with raw SQL: they were added after the Prisma client was generated, and raw
// SQL keeps working whether or not the client has been regenerated since.

type NoteRow = {
  id: string;
  title: string;
  updatedAt: Date;
  contextLabel: string | null;
  contextPath: string | null;
  snippet: string | null;
};

// ─── GET: list the current student's notes (metadata + a short preview) ──
export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const notes = await db.$queryRaw<NoteRow[]>`
    SELECT id, title, "updatedAt", "contextLabel", "contextPath",
           LEFT(COALESCE(content, ''), ${SNIPPET_CHARS}) AS snippet
    FROM student_notes
    WHERE "userId" = ${user.id}
    ORDER BY "updatedAt" DESC
  `;

  return NextResponse.json({ notes });
}

function cleanString(v: unknown, max: number): string | null {
  if (typeof v !== "string") return null;
  const t = v.trim().slice(0, max);
  return t || null;
}

// ─── POST: create a new (empty) note, tagged with where it was created ──
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

  let body: { title?: unknown; contextLabel?: unknown; contextPath?: unknown } = {};
  try {
    body = await req.json();
  } catch {
    /* an empty body is fine */
  }

  // An empty title is allowed: the panel shows the note's first line instead.
  const title = typeof body.title === "string" ? body.title.trim().slice(0, MAX_TITLE) : "";
  const contextLabel = cleanString(body.contextLabel, MAX_CONTEXT_LABEL);
  const contextPath = cleanString(body.contextPath, MAX_CONTEXT_PATH);

  const created = await db.studentNote.create({
    data: { userId: user.id, title },
    select: { id: true, title: true, updatedAt: true },
  });
  if (contextLabel || contextPath) {
    await db.$executeRaw`
      UPDATE student_notes SET "contextLabel" = ${contextLabel}, "contextPath" = ${contextPath}
      WHERE id = ${created.id} AND "userId" = ${user.id}
    `;
  }

  return NextResponse.json({ note: { ...created, contextLabel, contextPath, snippet: "" } });
}
