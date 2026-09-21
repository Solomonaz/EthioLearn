import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getCurrentUser } from "@/lib/get-session";
import { validateCsrfOrigin } from "@/lib/csrf";

/**
 * One saved resource: read it back in full, rename it, or delete it.
 *
 * Every query is scoped to the owning teacher, so one teacher can never reach
 * another's library.
 */

const MAX_TITLE = 160;

async function getTeacher() {
  const user = await getCurrentUser();
  if (!user || user.role !== "SECONDARY_TEACHER") return null;
  return user;
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await getTeacher();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 403 });

  const { id } = await params;
  const resource = await db.teacherResource.findFirst({
    where: { id, teacherId: user.id },
    select: {
      id: true,
      task: true,
      title: true,
      body: true,
      subject: true,
      grade: true,
      chapterTitle: true,
      createdAt: true,
      updatedAt: true,
    },
  });

  if (!resource) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  return NextResponse.json({ resource });
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  if (!validateCsrfOrigin(req)) {
    return NextResponse.json({ error: "Invalid request origin" }, { status: 403 });
  }

  const user = await getTeacher();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 403 });

  const { id } = await params;

  let body: { title?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const title = typeof body.title === "string" ? body.title.trim().slice(0, MAX_TITLE) : "";
  if (title.length < 2) {
    return NextResponse.json({ error: "Give it a title." }, { status: 400 });
  }

  // updateMany scopes by owner in the same statement, so a resource belonging
  // to another teacher is simply not matched.
  const result = await db.teacherResource.updateMany({
    where: { id, teacherId: user.id },
    data: { title },
  });
  if (result.count === 0) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  return NextResponse.json({ ok: true, title });
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  if (!validateCsrfOrigin(req)) {
    return NextResponse.json({ error: "Invalid request origin" }, { status: 403 });
  }

  const user = await getTeacher();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 403 });

  const { id } = await params;

  // Deleting a saved resource never touches an activity made from it — the
  // activity holds its own copy of the text.
  const result = await db.teacherResource.deleteMany({
    where: { id, teacherId: user.id },
  });
  if (result.count === 0) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  return NextResponse.json({ ok: true });
}
