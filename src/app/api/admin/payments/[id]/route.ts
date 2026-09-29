import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getCurrentUser } from "@/lib/get-session";
import { validateCsrfOrigin } from "@/lib/csrf";
import { activateSubscription } from "@/lib/subscription";
import { notifyPaymentApproved, notifyPaymentRejected } from "@/lib/notifications";

interface RouteParams {
  params: Promise<{ id: string }>;
}

// ─── GET: a single request incl. the receipt image (super-admin only) ──
export async function GET(_req: NextRequest, { params }: RouteParams) {
  const user = await getCurrentUser();
  if (!user || user.role !== "SUPER_ADMIN") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  }
  const { id } = await params;
  const request = await db.paymentRequest.findUnique({
    where: { id },
    include: {
      student: { select: { id: true, name: true, phoneNumber: true, email: true, username: true } },
      plan: { select: { id: true, name: true } },
    },
  });
  if (!request) return NextResponse.json({ error: "Payment not found" }, { status: 404 });
  return NextResponse.json({ request });
}

// ─── PATCH: approve or reject a pending payment (super-admin only) ──
export async function PATCH(req: NextRequest, { params }: RouteParams) {
  const user = await getCurrentUser();
  if (!user || user.role !== "SUPER_ADMIN") {
    return NextResponse.json({ error: "Only a super admin can review payments" }, { status: 403 });
  }
  if (!validateCsrfOrigin(req)) {
    return NextResponse.json({ error: "Invalid request origin" }, { status: 403 });
  }

  const { id } = await params;

  let body: { action?: "approve" | "reject"; note?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const { action } = body;
  if (action !== "approve" && action !== "reject") {
    return NextResponse.json({ error: "action must be 'approve' or 'reject'" }, { status: 400 });
  }

  const request = await db.paymentRequest.findUnique({
    where: { id },
    include: { plan: true },
  });
  if (!request) return NextResponse.json({ error: "Payment not found" }, { status: 404 });
  if (request.status !== "PENDING") {
    return NextResponse.json(
      { error: `This payment is already ${request.status.toLowerCase()}.` },
      { status: 409 },
    );
  }

  // Record the reviewer only if they're a persisted user (the env super-admin
  // shortcut has no DB row, so setting reviewedById would break the FK).
  const reviewerExists = await db.user.findUnique({ where: { id: user.id }, select: { id: true } });
  const reviewedById = reviewerExists ? user.id : null;

  if (action === "reject") {
    const note = typeof body.note === "string" && body.note.trim() ? body.note.trim().slice(0, 300) : null;
    const updated = await db.paymentRequest.update({
      where: { id },
      data: { status: "REJECTED", adminNote: note, reviewedById, reviewedAt: new Date() },
      select: { id: true, status: true, adminNote: true, reviewedAt: true },
    });
    notifyPaymentRejected(request.studentId, request.plan.name, note).catch(console.error);
    return NextResponse.json({ request: updated });
  }

  // approve → activate the subscription for the paid term, then mark approved.
  const subscription = await activateSubscription({
    studentId: request.studentId,
    planId: request.planId,
    billingInterval: request.billingInterval,
    amount: request.amount,
    currency: request.currency,
    trialDays: request.plan.trialDays,
    createdById: reviewedById,
  });

  const updated = await db.paymentRequest.update({
    where: { id },
    data: {
      status: "APPROVED",
      reviewedById,
      reviewedAt: new Date(),
      subscriptionId: subscription.id,
    },
    select: { id: true, status: true, reviewedAt: true, subscriptionId: true },
  });

  notifyPaymentApproved(request.studentId, request.plan.name, subscription.endDate).catch(console.error);

  return NextResponse.json({ request: updated, subscription });
}
