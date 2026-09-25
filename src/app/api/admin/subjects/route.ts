import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getCurrentUser } from "@/lib/get-session";
import { validateCsrfOrigin } from "@/lib/csrf";
import { subjectFilter, tidySubjectName } from "@/lib/subject";

export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user || !["SUPER_ADMIN", "SCHOOL_ADMIN"].includes(user.role)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  }

  if (user.role === "SCHOOL_ADMIN" && !user.schoolId) {
    return NextResponse.json({ error: "No school assigned" }, { status: 400 });
  }

  if (!validateCsrfOrigin(req)) {
    return NextResponse.json({ error: "Invalid request origin" }, { status: 403 });
  }

  try {
    const { name } = await req.json();
    if (!name || typeof name !== "string" || name.trim().length === 0) {
      return NextResponse.json({ error: "Name is required" }, { status: 400 });
    }

    // Case-insensitive: "biology" is stored as "Biology", and cannot be added
    // beside an existing "Biology" — the database's unique check is
    // case-sensitive, so it would have let both in.
    const tidy = tidySubjectName(name);
    const existing = await db.subject.findFirst({
      where: { name: subjectFilter(tidy) },
      select: { name: true },
    });
    if (existing) {
      return NextResponse.json(
        { error: `"${existing.name}" already exists.` },
        { status: 400 },
      );
    }

    const subject = await db.subject.create({
      data: { name: tidy },
    });

    return NextResponse.json({ subject });
  } catch (error: any) {
    if (error.code === "P2002") {
      return NextResponse.json({ error: "Subject already exists" }, { status: 400 });
    }
    return NextResponse.json({ error: "Failed to create subject" }, { status: 500 });
  }
}
