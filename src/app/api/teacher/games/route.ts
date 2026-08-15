import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { validateCsrfOrigin } from "@/lib/csrf";
import {
  getRequester,
  ownerWhere,
  gameSetSchema,
  assertCorrectInOptions,
} from "./_shared";

/** GET /api/teacher/games — list the teacher's saved MCQ sets (newest first). */
export async function GET() {
  const req = await getRequester();
  if (!req) return NextResponse.json({ error: "Unauthorized" }, { status: 403 });

  const sets = await db.gameContent.findMany({
    where: { type: "MCQ", ...ownerWhere(req) },
    orderBy: { updatedAt: "desc" },
    select: {
      id: true,
      title: true,
      subject: true,
      grade: true,
      language: true,
      payload: true,
      updatedAt: true,
    },
  });

  const games = sets.map((s) => ({
    id: s.id,
    title: s.title,
    subject: s.subject,
    grade: s.grade,
    language: s.language,
    questionCount: Array.isArray((s.payload as any)?.questions)
      ? (s.payload as any).questions.length
      : 0,
    updatedAt: s.updatedAt,
  }));

  return NextResponse.json({ games });
}

/** POST /api/teacher/games — create a new MCQ set. */
export async function POST(request: NextRequest) {
  const req = await getRequester();
  if (!req) return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  if (!validateCsrfOrigin(request)) {
    return NextResponse.json({ error: "Invalid request origin" }, { status: 403 });
  }

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

  const { title, subject, grade, language, questions } = parsed.data;
  const created = await db.gameContent.create({
    data: {
      type: "MCQ",
      title,
      subject,
      grade,
      language,
      payload: { questions },
      createdById: req.ownerId,
    },
    select: { id: true },
  });

  return NextResponse.json({ id: created.id }, { status: 201 });
}
