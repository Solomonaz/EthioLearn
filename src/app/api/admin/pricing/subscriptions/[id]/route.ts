import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getCurrentUser } from "@/lib/get-session";
import { validateCsrfOrigin } from "@/lib/csrf";

const STATUSES = ["TRIAL", "ACTIVE", "PAST_DUE", "CANCELED", "EXPIRED"] as const;
type SubStatus = (typeof STATUSES)[number];

interface RouteParams {
  params: Promise<{ id: string }>;
}

// ─── PATCH: update status / dates / notes (super-admin only) ──
export async function PATCH(req: NextRequest, { params }: RouteParams) {
  const user = await getCurrentUser();
  if (!user || user.role !== "SUPER_ADMIN") {
    return NextResponse.json({ error: "Only a super admin can update subscriptions" }, { status: 403 });
  }
  if (!validateCsrfOrigin(req)) {
    return NextResponse.json({ error: "Invalid request origin" }, { status: 403 });
  }

  const { id } = await params;
  const existing = await db.subscription.findUnique({ where: { id } });
  if (!existing) return NextResponse.json({ error: "Subscription not found" }, { status: 404 });

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const data: {
    status?: SubStatus;
    endDate?: Date | null;
    notes?: string | null;
  } = {};

  if (body.status !== undefined) {
    if (!STATUSES.includes(body.status as SubStatus)) {
      return NextResponse.json({ error: "Invalid status" }, { status: 400 });
    }
    data.status = body.status as SubStatus;
  }

  if (body.endDate !== undefined) {
    if (body.endDate === null || body.endDate === "") {
      data.endDate = null;
    } else {
      const d = new Date(String(body.endDate));
      if (isNaN(d.getTime())) {
        return NextResponse.json({ error: "Invalid endDate" }, { status: 400 });
      }
      data.endDate = d;
    }
  }

  if (body.notes !== undefined) {
    data.notes = typeof body.notes === "string" && body.notes.trim() ? body.notes.trim() : null;
  }

  const subscription = await db.subscription.update({
    where: { id },
    data,
    include: { plan: { include: { tiers: { orderBy: { minStudents: "asc" } } } } },
  });

  return NextResponse.json({ subscription });
}

// ─── DELETE: remove a subscription record (super-admin only) ──
export async function DELETE(req: NextRequest, { params }: RouteParams) {
  const user = await getCurrentUser();
  if (!user || user.role !== "SUPER_ADMIN") {
    return NextResponse.json({ error: "Only a super admin can delete subscriptions" }, { status: 403 });
  }
  if (!validateCsrfOrigin(req)) {
    return NextResponse.json({ error: "Invalid request origin" }, { status: 403 });
  }

  const { id } = await params;
  const existing = await db.subscription.findUnique({ where: { id } });
  if (!existing) return NextResponse.json({ error: "Subscription not found" }, { status: 404 });

  await db.subscription.delete({ where: { id } });
  return NextResponse.json({ success: true });
}
