import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getCurrentUser } from "@/lib/get-session";

export async function GET() {
  const user = await getCurrentUser();

  if (!user || !["SUPER_ADMIN", "SCHOOL_ADMIN"].includes(user.role)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  }

  if (!user.schoolId) {
    return NextResponse.json({ error: "No school associated with this account" }, { status: 400 });
  }

  const budgets = await db.rewardBudget.findMany({
    where: { schoolId: user.schoolId },
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
}

export async function POST(request: NextRequest) {
  const user = await getCurrentUser();

  if (!user || !["SUPER_ADMIN", "SCHOOL_ADMIN"].includes(user.role)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  }

  if (!user.schoolId) {
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

  const budget = await db.rewardBudget.create({
    data: {
      name: name.trim(),
      totalBudget,
      periodStart: start,
      periodEnd: end,
      currency: currency?.trim() || "ETB",
      schoolId: user.schoolId,
    },
  });

  return NextResponse.json(
    { budget: { ...budget, remaining: budget.totalBudget - budget.spentAmount } },
    { status: 201 }
  );
}
