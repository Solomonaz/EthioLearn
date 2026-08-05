import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getCurrentUser } from "@/lib/get-session";
import { getEntitlements } from "@/lib/entitlements";

/**
 * Returns the current user's feature entitlements for client-side gating.
 * Server routes enforce these independently — this is for UX (hiding/labelling).
 */
export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const ent = await getEntitlements(user);
  const isStudent = user.role === "STUDENT";
  const isSchoolStudent = isStudent && !!user.schoolId;
  const isIndependent = isStudent && !user.schoolId;

  // Surface the plan name for independent students (for upgrade prompts).
  let planName: string | null = null;
  if (isIndependent) {
    const sub = await db.subscription.findFirst({
      where: { studentId: user.id, status: { in: ["TRIAL", "ACTIVE", "PAST_DUE"] } },
      orderBy: { createdAt: "desc" },
      select: { plan: { select: { name: true } } },
    });
    planName = sub?.plan?.name ?? null;
  }

  return NextResponse.json({ ...ent, isIndependent, isSchoolStudent, planName });
}
