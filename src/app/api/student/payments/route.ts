import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getCurrentUser } from "@/lib/get-session";
import { validateCsrfOrigin } from "@/lib/csrf";
import {
  studentIntervalPrice,
  STUDENT_BILLING_INTERVALS,
  type StudentBillingInterval,
} from "@/lib/pricing";

const LIVE_STATUSES = ["TRIAL", "ACTIVE", "PAST_DUE"] as const;
// ~3 MB image once base64-encoded.
const MAX_RECEIPT_CHARS = 4_000_000;
const ALLOWED_RECEIPT = /^data:image\/(png|jpe?g|webp|heic|heif);base64,/i;

function isIndependentStudent(user: { role: string; schoolId: string | null }) {
  return user.role === "STUDENT" && !user.schoolId;
}

// ─── GET: payee accounts + this student's payment requests ──
export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!isIndependentStudent(user)) return NextResponse.json({ eligible: false });

  const [accounts, requests] = await Promise.all([
    db.paymentAccount.findMany({
      where: { isActive: true },
      orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
      select: { id: true, method: true, accountName: true, accountNumber: true, instructions: true },
    }),
    db.paymentRequest.findMany({
      where: { studentId: user.id },
      orderBy: { createdAt: "desc" },
      take: 10,
      // Never ship the (base64) receipt back to the student's own list.
      select: {
        id: true,
        amount: true,
        currency: true,
        billingInterval: true,
        methodLabel: true,
        transactionRef: true,
        status: true,
        adminNote: true,
        createdAt: true,
        plan: { select: { name: true } },
      },
    }),
  ]);

  const pending = requests.find((r) => r.status === "PENDING") ?? null;
  return NextResponse.json({ eligible: true, accounts, requests, pending });
}

// ─── POST: submit a manual payment for a paid plan ──
export async function POST(req: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!isIndependentStudent(user)) {
    return NextResponse.json({ error: "Your plan is managed by your school." }, { status: 403 });
  }
  if (!validateCsrfOrigin(req)) {
    return NextResponse.json({ error: "Invalid request origin" }, { status: 403 });
  }

  let body: {
    planId?: string;
    billingInterval?: string;
    transactionRef?: string;
    receiptData?: string;
    receiptName?: string;
    receiptType?: string;
    methodLabel?: string;
    agreedPolicy?: boolean;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (!body.agreedPolicy) {
    return NextResponse.json({ error: "Please agree to the Fair Usage Policy." }, { status: 400 });
  }

  const planId = typeof body.planId === "string" ? body.planId : "";
  if (!planId) return NextResponse.json({ error: "planId is required" }, { status: 400 });

  const billingInterval: StudentBillingInterval =
    STUDENT_BILLING_INTERVALS.includes(body.billingInterval as StudentBillingInterval)
      ? (body.billingInterval as StudentBillingInterval)
      : "MONTHLY";

  const transactionRef = typeof body.transactionRef === "string" ? body.transactionRef.trim() : "";
  if (transactionRef.length < 3 || transactionRef.length > 120) {
    return NextResponse.json({ error: "Enter a valid transaction number / reference." }, { status: 400 });
  }

  const receiptData = typeof body.receiptData === "string" ? body.receiptData : "";
  if (!ALLOWED_RECEIPT.test(receiptData)) {
    return NextResponse.json({ error: "Upload a receipt image (PNG or JPG)." }, { status: 400 });
  }
  if (receiptData.length > MAX_RECEIPT_CHARS) {
    return NextResponse.json({ error: "Receipt image is too large (max ~3 MB)." }, { status: 413 });
  }

  const plan = await db.pricingPlan.findUnique({ where: { id: planId } });
  if (!plan || plan.audience !== "STUDENT" || !plan.isActive) {
    return NextResponse.json({ error: "That plan is not available." }, { status: 404 });
  }

  // Price is computed server-side — never trust a client-sent amount.
  const priced = studentIntervalPrice(
    plan.price,
    billingInterval,
    plan.quarterlyDiscountPct,
    plan.yearlyDiscountPct,
  );
  if (priced.total <= 0) {
    return NextResponse.json({ error: "The Free plan doesn't require payment." }, { status: 400 });
  }

  // Can't submit while a paid plan is still live (committed term).
  const liveSub = await db.subscription.findFirst({
    where: {
      studentId: user.id,
      status: { in: [...LIVE_STATUSES] },
      OR: [{ endDate: null }, { endDate: { gt: new Date() } }],
    },
    orderBy: { createdAt: "desc" },
  });
  if (liveSub && (liveSub.amount ?? 0) > 0) {
    return NextResponse.json(
      { error: "You already have an active paid plan. You can subscribe again once it ends." },
      { status: 409 },
    );
  }

  // Only one pending payment at a time.
  const existingPending = await db.paymentRequest.findFirst({
    where: { studentId: user.id, status: "PENDING" },
  });
  if (existingPending) {
    return NextResponse.json(
      { error: "You already have a payment under review. Please wait for it to be processed." },
      { status: 409 },
    );
  }

  const methodLabel =
    typeof body.methodLabel === "string" && body.methodLabel.trim()
      ? body.methodLabel.trim().slice(0, 60)
      : "Manual";

  const request = await db.paymentRequest.create({
    data: {
      studentId: user.id,
      planId: plan.id,
      billingInterval,
      amount: priced.total,
      currency: plan.currency,
      methodLabel,
      transactionRef,
      receiptData,
      receiptName: typeof body.receiptName === "string" ? body.receiptName.slice(0, 200) : null,
      receiptType: typeof body.receiptType === "string" ? body.receiptType.slice(0, 100) : null,
      status: "PENDING",
    },
    include: { plan: { select: { name: true } } },
  });

  // Don't echo the (large) receipt back.
  const { receiptData: _omit, ...safe } = request;
  return NextResponse.json({ request: safe }, { status: 201 });
}
