import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getCurrentUser } from "@/lib/get-session";
import { validateCsrfOrigin } from "@/lib/csrf";

interface RouteParams {
  params: Promise<{ id: string }>;
}

// ─── PATCH: update a payee account (super-admin only) ──
export async function PATCH(req: NextRequest, { params }: RouteParams) {
  const user = await getCurrentUser();
  if (!user || user.role !== "SUPER_ADMIN") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  }
  if (!validateCsrfOrigin(req)) {
    return NextResponse.json({ error: "Invalid request origin" }, { status: 403 });
  }
  const { id } = await params;
  const existing = await db.paymentAccount.findUnique({ where: { id } });
  if (!existing) return NextResponse.json({ error: "Account not found" }, { status: 404 });

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const data: Record<string, unknown> = {};
  if (typeof body.method === "string" && body.method.trim()) data.method = body.method.trim().slice(0, 60);
  if (typeof body.accountName === "string" && body.accountName.trim())
    data.accountName = body.accountName.trim().slice(0, 120);
  if (typeof body.accountNumber === "string" && body.accountNumber.trim())
    data.accountNumber = body.accountNumber.trim().slice(0, 120);
  if (body.instructions !== undefined)
    data.instructions =
      typeof body.instructions === "string" && body.instructions.trim()
        ? body.instructions.trim().slice(0, 400)
        : null;
  if (body.isActive !== undefined) data.isActive = Boolean(body.isActive);
  if (body.sortOrder !== undefined && Number.isFinite(Number(body.sortOrder)))
    data.sortOrder = Math.floor(Number(body.sortOrder));

  const account = await db.paymentAccount.update({ where: { id }, data });
  return NextResponse.json({ account });
}

// ─── DELETE: remove a payee account (super-admin only) ──
export async function DELETE(req: NextRequest, { params }: RouteParams) {
  const user = await getCurrentUser();
  if (!user || user.role !== "SUPER_ADMIN") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  }
  if (!validateCsrfOrigin(req)) {
    return NextResponse.json({ error: "Invalid request origin" }, { status: 403 });
  }
  const { id } = await params;
  const existing = await db.paymentAccount.findUnique({ where: { id } });
  if (!existing) return NextResponse.json({ error: "Account not found" }, { status: 404 });
  await db.paymentAccount.delete({ where: { id } });
  return NextResponse.json({ success: true });
}
