import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/get-session";
import { getEntitlements, getStudentTrial } from "@/lib/entitlements";
import { getPlatformSettings, effectiveAiFlags } from "@/lib/platform-settings";

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

  // The plan that decided access (for upgrade prompts): the student's own, the
  // free plan, or the school's.
  const planName = ent.planName;

  // Global platform flags so the client can hide billing (pricing off) and
  // individual AI features (per-feature switches) without a flash of locked UI.
  const settings = await getPlatformSettings();
  const aiFeatures = effectiveAiFlags(settings);

  // Sign-up free trial (independent students, pricing on, trial set) — for the
  // "N days left" / "trial ended" prompts.
  const trial = await getStudentTrial(user);

  return NextResponse.json({
    features: ent.features,
    available: ent.available,
    antiCheat: ent.antiCheat,
    viaSchool: ent.source === "school",
    isIndependent,
    isSchoolStudent,
    planName,
    pricingEnabled: settings.pricingEnabled,
    rewardsEnabled: settings.rewardsEnabled,
    aiFeatures,
    trialEndsAt: trial ? trial.endsAt.toISOString() : null,
    trialActive: trial?.active ?? false,
    // The signed-in user's school level, so the school-admin sidebar can drop
    // the student-facing sections at an elementary school.
    schoolLevel: user.school?.level ?? null,
  });
}
