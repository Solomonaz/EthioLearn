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
    const { phoneNumber, name, role, grade, section, schoolId, planId } = body;

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

    // Optionally attach a self-selected plan (independent students only).
    // Non-fatal: a plan problem must never block account creation.
    if (planId && role === "STUDENT" && !schoolId) {
      try {
        const plan = await db.pricingPlan.findUnique({ where: { id: String(planId) } });
        if (plan && plan.audience === "STUDENT" && plan.isActive) {
          const startDate = new Date();
          const isTrial = plan.trialDays > 0;
          await db.subscription.create({
            data: {
              planId: plan.id,
              studentId: user.id,
              status: isTrial ? "TRIAL" : "ACTIVE",
              startDate,
              endDate: isTrial
                ? new Date(startDate.getTime() + plan.trialDays * 24 * 60 * 60 * 1000)
                : null,
              amount: plan.price, // student plans are FLAT
              currency: plan.currency,
              createdById: user.id,
            },
          });
        }
      } catch (subErr) {
        console.error("Registration plan attach failed (non-fatal):", subErr);
      }
    }

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
