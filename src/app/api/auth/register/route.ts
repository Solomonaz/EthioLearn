import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { rateLimit } from "@/lib/rate-limit";

export async function POST(request: Request) {
  try {
    // 3 registrations per IP per 10 minutes
    // Use the rightmost IP from X-Forwarded-For — that's the one added by
    // the trusted load balancer (Railway). The leftmost can be spoofed by the client.
    const ip = request.headers.get("x-forwarded-for")?.split(",").pop()?.trim() ?? "unknown";
    const rl = rateLimit(`register:${ip}`, 3, 10 * 60 * 1000);
    if (!rl.success) {
      return NextResponse.json(
        { error: "Too many registration attempts. Please try again later." },
        { status: 429, headers: { "Retry-After": String(rl.retryAfter) } }
      );
    }

    const body = await request.json();
    const { phoneNumber, name, role, grade, section, schoolId } = body;

    // Validate required fields
    if (!phoneNumber || !name || !role) {
      return NextResponse.json(
        { error: "Phone number, name, and role are required" },
        { status: 400 }
      );
    }

    if (!/^\+251[0-9]{9}$/.test(phoneNumber)) {
      return NextResponse.json(
        { error: "Invalid Ethiopian phone number format" },
        { status: 400 }
      );
    }

    const validRoles = ["STUDENT"];
    if (!validRoles.includes(role)) {
      return NextResponse.json(
        { error: "Invalid role" },
        { status: 400 }
      );
    }

    // Check if user already exists
    const existing = await db.user.findUnique({
      where: { phoneNumber },
    });

    if (existing) {
      return NextResponse.json(
        { error: "An account with this phone number already exists" },
        { status: 409 }
      );
    }

    // Create user
    const user = await db.user.create({
      data: {
        phoneNumber,
        name,
        role,
        grade: role === "STUDENT" && grade ? parseInt(grade) : null,
        section: section || null,
        schoolId: schoolId || null,
      },
      select: {
        id: true,
        phoneNumber: true,
        name: true,
        role: true,
        grade: true,
        createdAt: true,
      },
    });

    return NextResponse.json({
      success: true,
      user,
    });
  } catch (error) {
    console.error("Registration error:", error);
    return NextResponse.json(
      { error: "Failed to create account" },
      { status: 500 }
    );
  }
}
