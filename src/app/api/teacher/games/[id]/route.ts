import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { validateCsrfOrigin } from "@/lib/csrf";
import {
  getRequester,
  ownerWhere,
  gameSetSchema,
  assertCorrectInOptions,
} from "../_shared";

type Params = { params: Promise<{ id: string }> };

/** GET /api/teacher/games/[id] — full set incl. questions (for editing/play). */
export async function GET(_request: NextRequest, { params }: Params) {
  const req = await getRequester();
  if (!req) return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  const { id } = await params;

  const set = await db.gameContent.findFirst({
    where: { id, type: "MCQ", ...ownerWhere(req) },
    select: {
      id: true,
      title: true,
      subject: true,
      grade: true,
      language: true,
      payload: true,
    },
  });
  if (!set) return NextResponse.json({ error: "Not found" }, { status: 404 });

  return NextResponse.json({
    game: {
      id: set.id,
      title: set.title,
      subject: set.subject,
      grade: set.grade,
      language: set.language,
      questions: Array.isArray((set.payload as any)?.questions)
        ? (set.payload as any).questions
        : [],
    },
  });
}

/** PUT /api/teacher/games/[id] — replace the set. */
export async function PUT(request: NextRequest, { params }: Params) {
  const req = await getRequester();
  if (!req) return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  if (!validateCsrfOrigin(request)) {
    return NextResponse.json({ error: "Invalid request origin" }, { status: 403 });
  }
  const { id } = await params;

  const body = await request.json().catch(() => null);
  const parsed = gameSetSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid input" },
      { status: 400 },
    );
  }
  const mismatch = assertCorrectInOptions(parsed.data);
  if (mismatch) return NextResponse.json({ error: mismatch }, { status: 400 });

  // Scope the update to the owner so a teacher can't edit another's set.
  const existing = await db.gameContent.findFirst({
    where: { id, type: "MCQ", ...ownerWhere(req) },
    select: { id: true },
  });
  if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const { title, subject, grade, language, questions } = parsed.data;
  await db.gameContent.update({
    where: { id },
    data: { title, subject, grade, language, payload: { questions } },
  });

  return NextResponse.json({ id });
}

/** DELETE /api/teacher/games/[id] */
export async function DELETE(request: NextRequest, { params }: Params) {
  const req = await getRequester();
  if (!req) return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  if (!validateCsrfOrigin(request)) {
    return NextResponse.json({ error: "Invalid request origin" }, { status: 403 });
  }
  const { id } = await params;

  const existing = await db.gameContent.findFirst({
    where: { id, type: "MCQ", ...ownerWhere(req) },
    select: { id: true },
  });
  if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });

  await db.gameContent.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
