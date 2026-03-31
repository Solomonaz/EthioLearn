import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getCurrentUser } from "@/lib/get-session";

export async function GET(request: Request) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const grade = searchParams.get("grade");
  const subject = searchParams.get("subject");

  const where: Record<string, unknown> = {};
  if (grade) where.grade = parseInt(grade);
  if (subject) where.subject = subject;

  const textbooks = await db.textbook.findMany({
    where,
    include: {
      _count: { select: { chapters: true } },
    },
    orderBy: { subject: "asc" },
  });

  return NextResponse.json({ textbooks });
}
