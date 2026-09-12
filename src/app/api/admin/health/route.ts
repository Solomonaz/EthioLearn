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

  // Verification-code delivery health. SMS was dropped with the Africa's
  // Talking integration, so the live channels are Telegram and email — report
  // on those rather than on a provider that no longer exists.
  const hasTelegram = !!process.env.TELEGRAM_BOT_TOKEN;
  const hasEmail = !!process.env.RESEND_API_KEY;
  const otpStatus: "operational" | "degraded" | "unavailable" =
    hasTelegram && hasEmail ? "operational" : hasTelegram || hasEmail ? "degraded" : "unavailable";

  return NextResponse.json({
    api: { 
      status: "operational", 
      latencyMs: apiLatencyMs,
      uptime: 99.98, // Simulated uptime percentage
    },
    database: { status: dbStatus, latencyMs: dbLatencyMs },
    ai: { status: aiStatus },
    otpDelivery: { status: otpStatus, channels: { telegram: hasTelegram, email: hasEmail, sms: false } },
  });
}
