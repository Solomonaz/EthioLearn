import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireCompleteProfile } from "@/lib/get-session";
import { ACHIEVEMENTS } from "@/lib/achievements";

export async function GET() {
  const user = await requireCompleteProfile();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const earned = await db.userAchievement.findMany({
      where: { userId: user.id },
      select: { code: true, earnedAt: true },
    });

    const earnedMap = new Map(earned.map((e) => [e.code, e.earnedAt]));

    const achievements = ACHIEVEMENTS.map((def) => ({
      code: def.code,
      name: def.name,
      desc: def.desc,
      icon: def.icon,
      category: def.category,
      earnedAt: earnedMap.get(def.code)?.toISOString() ?? null,
    }));

    return NextResponse.json({ achievements });
  } catch (error) {
    console.error("Achievements fetch error:", error);
    return NextResponse.json(
      { error: "Failed to fetch achievements" },
      { status: 500 }
    );
  }
}
