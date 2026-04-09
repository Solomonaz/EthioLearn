import { NextResponse } from "next/server";
import { storeEmailOTP } from "@/lib/otp-store";
import { rateLimit } from "@/lib/rate-limit";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { email } = body;

    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return NextResponse.json(
        { error: "Invalid email address" },
        { status: 400 }
      );
    }

    const normalizedEmail = email.toLowerCase().trim();

    // 3 OTP sends per email per 10 minutes
    const rl = rateLimit(`otp:email:send:${normalizedEmail}`, 3, 10 * 60 * 1000);
    if (!rl.success) {
      return NextResponse.json(
        { error: "Too many OTP requests. Please wait before trying again." },
        { status: 429, headers: { "Retry-After": String(rl.retryAfter) } }
      );
    }

    await storeEmailOTP(normalizedEmail);

    return NextResponse.json({ success: true, message: "OTP sent successfully" });
  } catch {
    return NextResponse.json({ error: "Failed to send OTP" }, { status: 500 });
  }
}
