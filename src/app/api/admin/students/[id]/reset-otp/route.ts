import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getCurrentUser } from "@/lib/get-session";
import { clearRateLimit } from "@/lib/rate-limit";
import { clearOTP } from "@/lib/otp-store";

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getCurrentUser();
  if (!user || !["SUPER_ADMIN", "SCHOOL_ADMIN"].includes(user.role)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  }

  const { id } = await params;
  const schoolId = user.schoolId;

  const student = await db.user.findFirst({
    where: {
      id,
      role: "STUDENT",
      ...(schoolId ? { schoolId } : {}),
    },
    select: { id: true, phoneNumber: true },
  });

  if (!student) {
    return NextResponse.json({ error: "Student not found" }, { status: 404 });
  }

  // Clear rate limits and OTP for this student's phone
  clearRateLimit(`otp:send:${student.phoneNumber}`);
  clearRateLimit(`otp:verify:${student.phoneNumber}`);
  clearOTP(student.phoneNumber);

  return NextResponse.json({
    success: true,
    message: "OTP lock reset for student",
  });
}
