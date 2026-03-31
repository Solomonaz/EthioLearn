import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getCurrentUser } from "@/lib/get-session";
import { RedemptionStatus } from "@prisma/client";

export async function GET(request: NextRequest) {
  const user = await getCurrentUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!["SUPER_ADMIN", "SCHOOL_ADMIN"].includes(user.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  if (!user.schoolId) {
    return NextResponse.json({ error: "No school associated with this account" }, { status: 400 });
  }

  const { searchParams } = new URL(request.url);
  const statusParam = searchParams.get("status") ?? "all";
  const pageParam = parseInt(searchParams.get("page") ?? "1", 10);
  const limitParam = parseInt(searchParams.get("limit") ?? "20", 10);

  const page = isNaN(pageParam) || pageParam < 1 ? 1 : pageParam;
  const limit = isNaN(limitParam) || limitParam < 1 ? 20 : Math.min(limitParam, 100);

  const validStatuses: RedemptionStatus[] = ["PENDING", "APPROVED", "DENIED", "FULFILLED"];

  const statusFilter =
    statusParam && statusParam !== "all" && validStatuses.includes(statusParam as RedemptionStatus)
      ? { status: statusParam as RedemptionStatus }
      : {};

  const whereClause = {
    reward: { schoolId: user.schoolId },
    ...statusFilter,
  };

  const [redemptions, total] = await Promise.all([
    db.redemption.findMany({
      where: whereClause,
      include: {
        student: {
          select: {
            id: true,
            name: true,
            phoneNumber: true,
            grade: true,
            totalPoints: true,
          },
        },
        reward: {
          select: {
            id: true,
            name: true,
            tier: true,
            pointsCost: true,
          },
        },
        approvedBy: {
          select: { name: true },
        },
      },
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * limit,
      take: limit,
    }),
    db.redemption.count({ where: whereClause }),
  ]);

  const totalPages = Math.ceil(total / limit);

  return NextResponse.json({ redemptions, total, page, totalPages });
}
