import { NextResponse } from "next/server";
import { storeOTP } from "@/lib/otp-store";
import { rateLimit } from "@/lib/rate-limit";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { phoneNumber } = body;

    if (!phoneNumber || !/^\+251[0-9]{9}$/.test(phoneNumber)) {
      return NextResponse.json(
        { error: "Invalid Ethiopian phone number format (+251XXXXXXXXX)" },
        { status: 400 }
      );
    }

    // 3 OTP sends per phone per 10 minutes
    const rl = rateLimit(`otp:send:${phoneNumber}`, 3, 10 * 60 * 1000);
    if (!rl.success) {
      return NextResponse.json(
        { error: "Too many OTP requests. Please wait before trying again." },
        {
          status: 429,
          headers: { "Retry-After": String(rl.retryAfter) },
        }
      );
    }

    await storeOTP(phoneNumber);

    return NextResponse.json({
      success: true,
      message: "OTP sent successfully",
    });
  } catch {
    return NextResponse.json(
      { error: "Failed to send OTP" },
      { status: 500 }
    );
  }
}
