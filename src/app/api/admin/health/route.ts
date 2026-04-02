import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getCurrentUser } from "@/lib/get-session";

export async function GET() {
  const user = await getCurrentUser();
  if (!user || !["SUPER_ADMIN", "SCHOOL_ADMIN"].includes(user.role)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  }

  // API health — if we're responding, it's operational
  const apiStart = Date.now();
  const apiLatencyMs = Date.now() - apiStart;

  // Database health
  let dbStatus: "operational" | "unavailable" = "unavailable";
  let dbLatencyMs = 0;
  try {
    const dbStart = Date.now();
    await db.$queryRaw`SELECT 1`;
    dbLatencyMs = Date.now() - dbStart;
    dbStatus = "operational";
  } catch {
    dbStatus = "unavailable";
  }

  // AI services health
  const hasGemini = !!process.env.GEMINI_API_KEY;
  const hasGroq = !!process.env.GROQ_API_KEY;
  let aiStatus: "operational" | "degraded" | "unavailable";
  if (hasGemini && hasGroq) {
    aiStatus = "operational";
  } else if (hasGemini || hasGroq) {
    aiStatus = "degraded";
  } else {
    aiStatus = "unavailable";
  }

  // SMS health
  const hasAtKey = !!process.env.AFRICASTALKING_API_KEY;
  const hasAtUsername = !!process.env.AFRICASTALKING_USERNAME;
  const smsStatus: "operational" | "unavailable" =
    hasAtKey && hasAtUsername ? "operational" : "unavailable";

  return NextResponse.json({
    services: {
      api: { status: "operational", latencyMs: apiLatencyMs },
      database: { status: dbStatus, latencyMs: dbLatencyMs },
      ai: {
        status: aiStatus,
        providers: { gemini: hasGemini, groq: hasGroq },
      },
      sms: {
        status: smsStatus,
        provider: "africastalking",
      },
    },
  });
}
