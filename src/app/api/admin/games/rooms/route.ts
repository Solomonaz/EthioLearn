import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getCurrentUser } from "@/lib/get-session";

export async function GET(request: NextRequest) {
  const user = await getCurrentUser();

  if (!user || !["SUPER_ADMIN", "SCHOOL_ADMIN"].includes(user.role)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  }

  if (user.role === "SCHOOL_ADMIN" && !user.schoolId) {
    return NextResponse.json({ error: "No school associated" }, { status: 400 });
  }

  const { searchParams } = new URL(request.url);
  const targetSchoolId = user.schoolId || searchParams.get("schoolId");

  try {
    const rooms = await db.gameRoom.findMany({
      where: {
        ...(targetSchoolId ? { host: { schoolId: targetSchoolId } } : {}),
        status: { in: ["WAITING", "ACTIVE"] }
      },
      include: {
        host: { select: { name: true } },
        _count: { select: { players: true } },
        tournamentRound: {
          include: {
            tournament: { select: { name: true } }
          }
        }
      },
      orderBy: { createdAt: "desc" }
    });

    return NextResponse.json({ rooms });
  } catch (error) {
    return NextResponse.json({ error: "Failed to fetch active games" }, { status: 500 });
  }
}
