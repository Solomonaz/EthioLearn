import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getCurrentUser } from "@/lib/get-session";
import { validateCsrfOrigin } from "@/lib/csrf";
import { getPlatformSettings, PLATFORM_SETTINGS_SINGLETON_ID } from "@/lib/platform-settings";

const BOOLEAN_KEYS = [
  "aiEnabled",
  "aiTutorEnabled",
  "aiQuizGenEnabled",
  "aiAdaptiveEnabled",
  "aiMathToolsEnabled",
  "aiTeacherAssistantEnabled",
  "pricingEnabled",
  "rewardsEnabled",
  "antiCheatEnabled",
] as const;

// ─── GET: current global platform settings ──
export async function GET() {
  const user = await getCurrentUser();
  // Global platform settings are owner-level — SUPER_ADMIN only.
  if (!user || user.role !== "SUPER_ADMIN") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  }
  const settings = await getPlatformSettings();
  return NextResponse.json({ settings });
}

// ─── PATCH: toggle one or more flags ──
export async function PATCH(request: Request) {
  const user = await getCurrentUser();
  if (!user || user.role !== "SUPER_ADMIN") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  }
  if (!validateCsrfOrigin(request)) {
    return NextResponse.json({ error: "Invalid request origin" }, { status: 403 });
  }

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const data: Record<string, boolean | number | null> = {};
  for (const key of BOOLEAN_KEYS) {
    if (typeof body[key] === "boolean") data[key] = body[key] as boolean;
  }
  // Teachers' default monthly AI credits: a whole number, or null for no cap.
  if ("teacherAiDefaultMonthlyCredits" in body) {
    const v = body.teacherAiDefaultMonthlyCredits;
    if (v === null) {
      data.teacherAiDefaultMonthlyCredits = null;
    } else if (typeof v === "number" && Number.isInteger(v) && v >= 0 && v <= 100_000) {
      data.teacherAiDefaultMonthlyCredits = v;
    } else {
      return NextResponse.json(
        { error: "Default teacher AI credits must be a whole number from 0 to 100000, or empty for no cap." },
        { status: 400 },
      );
    }
  }

  if (Object.keys(data).length === 0) {
    return NextResponse.json({ error: "No valid settings to update" }, { status: 400 });
  }

  const settings = await db.platformSettings.upsert({
    where: { id: PLATFORM_SETTINGS_SINGLETON_ID },
    update: data,
    create: { id: PLATFORM_SETTINGS_SINGLETON_ID, ...data },
    select: {
      aiEnabled: true,
      aiTutorEnabled: true,
      aiQuizGenEnabled: true,
      aiAdaptiveEnabled: true,
      aiMathToolsEnabled: true,
      aiTeacherAssistantEnabled: true,
      pricingEnabled: true,
      rewardsEnabled: true,
      antiCheatEnabled: true,
      teacherAiDefaultMonthlyCredits: true,
    },
  });

  return NextResponse.json({ settings });
}
