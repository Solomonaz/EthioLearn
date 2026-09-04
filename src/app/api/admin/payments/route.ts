import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getCurrentUser } from "@/lib/get-session";

const STATUSES = ["PENDING", "APPROVED", "REJECTED"] as const;
type ReqStatus = (typeof STATUSES)[number];

// ─── GET: list manual payment requests (super-admin only) ──
export async function GET(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user || user.role !== "SUPER_ADMIN") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  }

  const { searchParams } = new URL(req.url);
  const statusParam = searchParams.get("status");
  const status = STATUSES.includes(statusParam as ReqStatus) ? (statusParam as ReqStatus) : undefined;

  const requests = await db.paymentRequest.findMany({
    where: status ? { status } : {},
    orderBy: [{ status: "asc" }, { createdAt: "desc" }], // PENDING sorts first alphabetically
    take: 200,
    select: {
      id: true,
      amount: true,
      currency: true,
      billingInterval: true,
      methodLabel: true,
      transactionRef: true,
      status: true,
      adminNote: true,
      reviewedAt: true,
      createdAt: true,
      receiptName: true,
      student: { select: { id: true, name: true, phoneNumber: true } },
      plan: { select: { id: true, name: true } },
    },
  });

  const pendingCount = await db.paymentRequest.count({ where: { status: "PENDING" } });
  return NextResponse.json({ requests, pendingCount });
}
