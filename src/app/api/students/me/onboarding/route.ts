import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getCurrentUser } from "@/lib/get-session";
import { validateCsrfOrigin } from "@/lib/csrf";

/**
 * POST /api/students/me/onboarding — { action: "complete" | "skip", step?: number }
 * Records that the student finished (or closed) the welcome tour, so it shows
 * once per account rather than once per device. Replaying the tour later
 * (?tour=1) does not overwrite how the first run ended.
 */
export async function POST(req: Request) {
  const user = await getCurrentUser();
  if (!user || user.role !== "STUDENT") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!validateCsrfOrigin(req)) {
    return NextResponse.json({ error: "Invalid request origin" }, { status: 403 });
  }
  const body = (await req.json().catch(() => ({}))) as { action?: unknown; step?: unknown };
  if (body.action !== "complete" && body.action !== "skip") {
    return NextResponse.json({ error: "Invalid action" }, { status: 400 });
  }
  const step = typeof body.step === "number" && Number.isInteger(body.step) && body.step >= 0 && body.step < 50 ? body.step : null;

  // Only the first run is recorded (updateMany so a replay is a no-op).
  await db.user.updateMany({
    where: { id: user.id, onboardingCompletedAt: null },
    data: {
      onboardingCompletedAt: new Date(),
      onboardingSkipped: body.action === "skip",
      onboardingStep: step,
    },
  });
  return NextResponse.json({ ok: true });
}
