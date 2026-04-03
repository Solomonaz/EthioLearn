import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getCurrentUser } from "@/lib/get-session";

export async function GET() {
  const user = await getCurrentUser();

  if (!user || !["SUPER_ADMIN", "SCHOOL_ADMIN"].includes(user.role)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  }

  if (!user.schoolId) {
    return NextResponse.json({ error: "No school associated" }, { status: 400 });
  }

  try {
    const rooms = await db.gameRoom.findMany({
      where: {
        host: { schoolId: user.schoolId },
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
