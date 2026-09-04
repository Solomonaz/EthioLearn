import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getCurrentUser } from "@/lib/get-session";
import { validateCsrfOrigin } from "@/lib/csrf";

function parseAccount(body: Record<string, unknown>) {
  const method = typeof body.method === "string" ? body.method.trim() : "";
  const accountName = typeof body.accountName === "string" ? body.accountName.trim() : "";
  const accountNumber = typeof body.accountNumber === "string" ? body.accountNumber.trim() : "";
  if (!method) return { error: "Method is required (e.g. Telebirr)" };
  if (!accountName) return { error: "Account name is required" };
  if (!accountNumber) return { error: "Account number is required" };
  return {
    data: {
      method: method.slice(0, 60),
      accountName: accountName.slice(0, 120),
      accountNumber: accountNumber.slice(0, 120),
      instructions:
        typeof body.instructions === "string" && body.instructions.trim()
          ? body.instructions.trim().slice(0, 400)
          : null,
      isActive: body.isActive === undefined ? true : Boolean(body.isActive),
      sortOrder: Number.isFinite(Number(body.sortOrder)) ? Math.floor(Number(body.sortOrder)) : 0,
    },
  };
}

// ─── GET: all payee accounts (super-admin only) ──
export async function GET() {
  const user = await getCurrentUser();
  if (!user || user.role !== "SUPER_ADMIN") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  }
  const accounts = await db.paymentAccount.findMany({
    orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
  });
  return NextResponse.json({ accounts });
}

// ─── POST: create a payee account (super-admin only) ──
export async function POST(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user || user.role !== "SUPER_ADMIN") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  }
  if (!validateCsrfOrigin(req)) {
    return NextResponse.json({ error: "Invalid request origin" }, { status: 403 });
  }
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const parsed = parseAccount(body);
  if ("error" in parsed) return NextResponse.json({ error: parsed.error }, { status: 400 });
  const account = await db.paymentAccount.create({ data: parsed.data });
  return NextResponse.json({ account }, { status: 201 });
}
