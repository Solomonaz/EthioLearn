import { NextResponse } from "next/server";
import { verifyOTP } from "@/lib/otp-store";
import { rateLimit } from "@/lib/rate-limit";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { phoneNumber, otp } = body;

    if (!phoneNumber || !otp) {
      return NextResponse.json(
        { error: "Phone number and OTP are required" },
        { status: 400 }
      );
    }

    // 5 verify attempts per phone per 10 minutes
    const rl = rateLimit(`otp:verify:${phoneNumber}`, 5, 10 * 60 * 1000);
    if (!rl.success) {
      return NextResponse.json(
        { error: "Too many verification attempts. Please wait." },
        { status: 429, headers: { "Retry-After": String(rl.retryAfter) } }
      );
    }

    const isValid = verifyOTP(phoneNumber, otp);

    if (!isValid) {
      return NextResponse.json(
        { error: "Invalid or expired OTP" },
        { status: 401 }
      );
    }

    return NextResponse.json({
      success: true,
      verified: true,
    });
  } catch {
    return NextResponse.json(
      { error: "Failed to verify OTP" },
      { status: 500 }
    );
  }
}
