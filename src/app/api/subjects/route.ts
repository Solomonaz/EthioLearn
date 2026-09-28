import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getCurrentUser } from "@/lib/get-session";
import { parseSchoolLevel, subjectLevelFor } from "@/lib/subject";

/**
 * The managed subject list for one level. Elementary and secondary schools
 * teach different subjects, so each keeps its own list.
 *
 * Only the super admin may pick the level (`?level=`); everyone else gets the
 * list for their own level — the elementary list for grades 1-8 teachers and
 * elementary school admins, the secondary list otherwise.
 */
export async function GET(req: NextRequest) {
  try {
    const user = await getCurrentUser();
    const requested = parseSchoolLevel(req.nextUrl.searchParams.get("level"));
    const level =
      user?.role === "SUPER_ADMIN" && requested ? requested : subjectLevelFor(user);

    const subjects = await db.subject.findMany({
      where: { level },
      orderBy: { name: "asc" },
    });
    return NextResponse.json({ subjects, level });
  } catch (error) {
    console.error("Failed to fetch subjects:", error);
    return NextResponse.json({ error: "Failed to fetch subjects" }, { status: 500 });
  }
}
