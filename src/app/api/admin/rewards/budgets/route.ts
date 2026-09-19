import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getCurrentUser } from "@/lib/get-session";
import { validateCsrfOrigin } from "@/lib/csrf";

export async function GET(request: NextRequest) {
  const user = await getCurrentUser();

  if (!user || !["SUPER_ADMIN", "SCHOOL_ADMIN"].includes(user.role)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  }

  if (user.role === "SCHOOL_ADMIN" && !user.schoolId) {
    return NextResponse.json({ error: "No school associated with this account" }, { status: 400 });
  }

  const { searchParams } = new URL(request.url);
  const targetSchoolId = user.schoolId || searchParams.get("schoolId");

  const budgets = await db.rewardBudget.findMany({
    where: {
      ...(targetSchoolId ? { schoolId: targetSchoolId } : {}),
    },
    orderBy: { periodStart: "desc" },
  });

  const budgetsWithRemaining = budgets.map((budget) => ({
    ...budget,
    remaining: budget.totalBudget - budget.spentAmount,
  }));

  return NextResponse.json({ budgets: budgetsWithRemaining });
}

interface CreateBudgetBody {
  name?: string;
  totalBudget?: number;
  periodStart?: string;
  periodEnd?: string;
  currency?: string;
  schoolId?: string;
}

export async function POST(request: NextRequest) {
  const user = await getCurrentUser();

  if (!user || !["SUPER_ADMIN", "SCHOOL_ADMIN"].includes(user.role)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  }

  if (!validateCsrfOrigin(request)) {
    return NextResponse.json({ error: "Invalid request origin" }, { status: 403 });
  }

  if (user.role === "SCHOOL_ADMIN" && !user.schoolId) {
    return NextResponse.json({ error: "No school associated with this account" }, { status: 400 });
  }

  let body: CreateBudgetBody;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { name, totalBudget, periodStart, periodEnd, currency } = body;

  if (!name || typeof name !== "string" || name.trim() === "") {
    return NextResponse.json({ error: "Name is required" }, { status: 400 });
  }

  if (totalBudget === undefined || typeof totalBudget !== "number" || totalBudget <= 0) {
    return NextResponse.json({ error: "totalBudget must be a positive number" }, { status: 400 });
  }

  if (!periodStart) {
    return NextResponse.json({ error: "periodStart is required" }, { status: 400 });
  }

  if (!periodEnd) {
    return NextResponse.json({ error: "periodEnd is required" }, { status: 400 });
  }

  const start = new Date(periodStart);
  const end = new Date(periodEnd);

  if (isNaN(start.getTime())) {
    return NextResponse.json({ error: "Invalid periodStart date" }, { status: 400 });
  }

  if (isNaN(end.getTime())) {
    return NextResponse.json({ error: "Invalid periodEnd date" }, { status: 400 });
  }

  if (end <= start) {
    return NextResponse.json({ error: "periodEnd must be after periodStart" }, { status: 400 });
  }

  let targetSchoolId = user.schoolId || body.schoolId;
  if (!targetSchoolId && user.role === "SUPER_ADMIN") {
    targetSchoolId = (await db.school.findFirst({ select: { id: true } }))?.id;
  }

  if (!targetSchoolId) {
    return NextResponse.json({ error: "A school is required to create a budget" }, { status: 400 });
  }

  const budget = await db.rewardBudget.create({
    data: {
      name: name.trim(),
      totalBudget,
      periodStart: start,
      periodEnd: end,
      currency: currency?.trim() || "ETB",
      schoolId: targetSchoolId,
    },
  });

  return NextResponse.json(
    { budget: { ...budget, remaining: budget.totalBudget - budget.spentAmount } },
    { status: 201 }
  );
}
