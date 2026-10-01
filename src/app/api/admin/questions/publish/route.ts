import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getCurrentUser } from "@/lib/get-session";
import { validateCsrfOrigin } from "@/lib/csrf";
import type { Prisma, QuestionType } from "@prisma/client";
import { manageableTextbookWhere } from "@/lib/textbook-access";

/**
 * Publish draft questions in bulk, so students can be quizzed on them.
 *
 * Body: `{ ids }` publishes those drafts; otherwise every draft matching the
 * question bank's filters (`textbookId`, `chapterId`, `type`, `search`), so
 * "Publish all" covers exactly the drafts the admin is looking at. Only books
 * the admin may change are touched: library drafts stay with the super admin.
 */
export async function POST(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!["SUPER_ADMIN", "SCHOOL_ADMIN"].includes(user.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  if (!validateCsrfOrigin(request)) {
    return NextResponse.json({ error: "Invalid request origin" }, { status: 403 });
  }

  let body: { ids?: unknown; chapterId?: unknown; textbookId?: unknown; type?: unknown; search?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const ids = Array.isArray(body.ids) ? body.ids.filter((x): x is string => typeof x === "string") : null;
  if (ids && ids.length === 0) {
    return NextResponse.json({ error: "No questions selected" }, { status: 400 });
  }
  const chapterId = typeof body.chapterId === "string" && body.chapterId ? body.chapterId : undefined;
  const textbookId = typeof body.textbookId === "string" && body.textbookId ? body.textbookId : undefined;
  const validTypes: string[] = ["MCQ", "TRUE_FALSE", "FILL_IN_BLANK", "MATCH_PAIRS", "ORDERING"];
  const type = typeof body.type === "string" && validTypes.includes(body.type) ? (body.type as QuestionType) : undefined;
  const search = typeof body.search === "string" && body.search.trim() ? body.search.trim() : undefined;

  const where: Prisma.QuestionWhereInput = {
    status: "DRAFT",
    ...(ids ? { id: { in: ids } } : {}),
    chapter: {
      textbook: manageableTextbookWhere(user),
      ...(chapterId ? { id: chapterId } : {}),
      ...(textbookId ? { textbookId } : {}),
    },
    ...(type ? { type } : {}),
    ...(search ? { questionText: { contains: search, mode: "insensitive" as const } } : {}),
  };

  const result = await db.question.updateMany({ where, data: { status: "PUBLISHED" } });
  return NextResponse.json({ published: result.count });
}
