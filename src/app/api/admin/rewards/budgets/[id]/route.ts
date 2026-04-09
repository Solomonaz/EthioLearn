import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getCurrentUser } from "@/lib/get-session";
import { validateCsrfOrigin } from "@/lib/csrf";

interface RouteParams {
  params: Promise<{ id: string }>;
}

export async function PATCH(request: NextRequest, { params }: RouteParams) {
  const user = await getCurrentUser();

  if (!user || !["SUPER_ADMIN", "SCHOOL_ADMIN"].includes(user.role)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  }

  if (!validateCsrfOrigin(request)) {
    return NextResponse.json({ error: "Invalid request origin" }, { status: 403 });
  }

  if (!user.schoolId) {
    return NextResponse.json({ error: "No school associated with this account" }, { status: 400 });
  }

  const { id } = await params;

  const existing = await db.rewardBudget.findUnique({ where: { id } });

  if (!existing) {
    return NextResponse.json({ error: "Budget not found" }, { status: 404 });
  }

  if (existing.schoolId !== user.schoolId) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  let body: {
    name?: string;
    totalBudget?: number;
    currency?: string;
    periodStart?: string;
    periodEnd?: string;
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const updateData: {
    name?: string;
    totalBudget?: number;
    currency?: string;
    periodStart?: Date;
    periodEnd?: Date;
  } = {};

  if (body.name !== undefined) {
    if (typeof body.name !== "string" || body.name.trim() === "") {
      return NextResponse.json({ error: "Name cannot be empty" }, { status: 400 });
    }
    updateData.name = body.name.trim();
  }

  if (body.totalBudget !== undefined) {
    if (typeof body.totalBudget !== "number" || body.totalBudget <= 0) {
      return NextResponse.json({ error: "totalBudget must be a positive number" }, { status: 400 });
    }
    updateData.totalBudget = body.totalBudget;
  }

  if (body.currency !== undefined) {
    if (typeof body.currency !== "string" || body.currency.trim() === "") {
      return NextResponse.json({ error: "Currency cannot be empty" }, { status: 400 });
    }
    updateData.currency = body.currency.trim();
  }

  if (body.periodStart !== undefined) {
    const start = new Date(body.periodStart);
    if (isNaN(start.getTime())) {
      return NextResponse.json({ error: "Invalid periodStart date" }, { status: 400 });
    }
    updateData.periodStart = start;
  }

  if (body.periodEnd !== undefined) {
    const end = new Date(body.periodEnd);
    if (isNaN(end.getTime())) {
      return NextResponse.json({ error: "Invalid periodEnd date" }, { status: 400 });
    }
    updateData.periodEnd = end;
  }

  // Validate periodEnd > periodStart using the effective values
  const effectiveStart = updateData.periodStart ?? existing.periodStart;
  const effectiveEnd = updateData.periodEnd ?? existing.periodEnd;
  if (effectiveEnd <= effectiveStart) {
    return NextResponse.json({ error: "periodEnd must be after periodStart" }, { status: 400 });
  }

  const budget = await db.rewardBudget.update({
    where: { id },
    data: updateData,
  });

  return NextResponse.json({
    budget: { ...budget, remaining: budget.totalBudget - budget.spentAmount },
  });
}

export async function DELETE(_request: NextRequest, { params }: RouteParams) {
  const user = await getCurrentUser();

  if (!user || !["SUPER_ADMIN", "SCHOOL_ADMIN"].includes(user.role)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  }

  if (!validateCsrfOrigin(_request)) {
    return NextResponse.json({ error: "Invalid request origin" }, { status: 403 });
  }

  if (!user.schoolId) {
    return NextResponse.json({ error: "No school associated with this account" }, { status: 400 });
  }

  const { id } = await params;

  const existing = await db.rewardBudget.findUnique({ where: { id } });

  if (!existing) {
    return NextResponse.json({ error: "Budget not found" }, { status: 404 });
  }

  if (existing.schoolId !== user.schoolId) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  await db.rewardBudget.delete({ where: { id } });

  return NextResponse.json({ success: true });
}
