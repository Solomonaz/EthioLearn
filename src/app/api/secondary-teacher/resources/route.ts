import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getCurrentUser } from "@/lib/get-session";
import { validateCsrfOrigin } from "@/lib/csrf";
import { ASSISTANT_TASKS } from "@/lib/assistant-tasks";

/**
 * A teacher's AI material — their own library. Everything they generate is
 * stored here automatically (lib/teacher-library); what they Save is "kept".
 * Reuse across teachers happens behind the scenes and is never listed here.
 *
 * Deliberately separate from ClassActivity: a lesson plan is for the teacher
 * and may never reach a student, while a worksheet might. Saving something and
 * giving it to a class are different decisions, so they are different records.
 */

const MAX_TITLE = 160;
const MAX_BODY = 60_000;
const VALID_TASKS = new Set<string>(ASSISTANT_TASKS.map((t) => t.value));

async function getTeacher() {
  const user = await getCurrentUser();
  if (!user || user.role !== "SECONDARY_TEACHER") return null;
  return user;
}

export async function POST(req: NextRequest) {
  if (!validateCsrfOrigin(req)) {
    return NextResponse.json({ error: "Invalid request origin" }, { status: 403 });
  }

  const user = await getTeacher();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 403 });

  let body: {
    task?: string;
    title?: string;
    body?: string;
    subject?: string | null;
    grade?: number | null;
    chapterTitle?: string | null;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const title = typeof body.title === "string" ? body.title.trim().slice(0, MAX_TITLE) : "";
  if (title.length < 2) {
    return NextResponse.json({ error: "Give it a title." }, { status: 400 });
  }

  const content = typeof body.body === "string" ? body.body.trim() : "";
  if (content.length < 10) {
    return NextResponse.json({ error: "There is nothing to save." }, { status: 400 });
  }
  if (content.length > MAX_BODY) {
    return NextResponse.json({ error: "That is too long to save." }, { status: 400 });
  }

  const task = VALID_TASKS.has(body.task ?? "") ? (body.task as string) : "FREEFORM";

  const subject = typeof body.subject === "string" && body.subject ? body.subject : null;
  const grade = Number.isInteger(body.grade) ? (body.grade as number) : null;
  const resource = await db.teacherResource.create({
    data: {
      teacherId: user.id,
      task,
      title,
      body: content,
      subject,
      grade,
      chapterTitle:
        typeof body.chapterTitle === "string" && body.chapterTitle
          ? body.chapterTitle.slice(0, 200)
          : null,
      // Saved by hand, so kept on purpose. Not reusable: a hand-saved copy
      // has no request to match against.
      kept: true,
    },
    select: {
      id: true,
      task: true,
      title: true,
      subject: true,
      grade: true,
      chapterTitle: true,
      createdAt: true,
    },
  });

  return NextResponse.json({ resource }, { status: 201 });
}

export async function GET(req: NextRequest) {
  const user = await getTeacher();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 403 });

  const limit = Math.min(
    200,
    Math.max(1, parseInt(req.nextUrl.searchParams.get("limit") || "100", 10)),
  );

  // Only ever this teacher's own. The list omits the body — a library of
  // lesson plans would otherwise be hundreds of kilobytes for a screen that
  // only shows titles.
  const resources = await db.teacherResource.findMany({
    where: { teacherId: user.id },
    orderBy: { createdAt: "desc" },
    take: limit,
    select: {
      id: true,
      task: true,
      title: true,
      subject: true,
      grade: true,
      chapterTitle: true,
      kept: true,
      source: true,
      createdAt: true,
    },
  });

  return NextResponse.json({ resources });
}
