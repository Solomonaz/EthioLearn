import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getCurrentUser } from "@/lib/get-session";
import { peekOTP, consumeOTP } from "@/lib/otp-store";

// POST /api/students/me/complete-profile
// Two paths:
//   1. socialUser: true  → Google/Facebook users, just save grade (no OTP needed)
//   2. Default           → Telegram users, verify phone OTP then save phone + grade

export async function POST(req: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { phoneNumber, grade, otp, socialUser } = body as {
    phoneNumber?: string;
    grade?: number;
    otp?: string;
    socialUser?: boolean;
  };

  if (grade !== undefined && (typeof grade !== "number" || grade < 1 || grade > 12)) {
    return NextResponse.json({ error: "Grade must be between 1 and 12" }, { status: 400 });
  }

  // ── Path 1: Social user (Google / Facebook) — grade only ──────────────────
  if (socialUser) {
    if (!grade) {
      return NextResponse.json({ error: "Grade is required" }, { status: 400 });
    }

    const updated = await db.user.update({
      where: { id: user.id },
      data: { grade },
      select: { id: true, name: true, email: true, grade: true },
    });

    return NextResponse.json({ user: updated });
  }

  // ── Path 2: Telegram user — phone OTP required ────────────────────────────
  if ((user as any).phoneNumber) {
    return NextResponse.json({ error: "Profile already complete" }, { status: 400 });
  }

  if (!phoneNumber || typeof phoneNumber !== "string") {
    return NextResponse.json({ error: "Phone number is required" }, { status: 400 });
  }

  if (!otp || typeof otp !== "string") {
    return NextResponse.json({ error: "OTP is required" }, { status: 400 });
  }

  if (!await peekOTP(phoneNumber, otp)) {
    return NextResponse.json({ error: "Invalid or expired OTP" }, { status: 400 });
  }

  const conflict = await db.user.findFirst({
    where: { phoneNumber, id: { not: user.id } },
  });
  if (conflict) {
    return NextResponse.json(
      { error: "This phone number is already registered to another account" },
      { status: 409 },
    );
  }

  await consumeOTP(phoneNumber);

  const updated = await db.user.update({
    where: { id: user.id },
    data: {
      phoneNumber,
      ...(grade !== undefined ? { grade } : {}),
    },
    select: { id: true, name: true, phoneNumber: true, grade: true },
  });

  return NextResponse.json({ user: updated });
}
