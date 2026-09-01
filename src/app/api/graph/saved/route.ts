import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getCurrentUser } from "@/lib/get-session";
import { validateCsrfOrigin } from "@/lib/csrf";

/**
 * Saved graphs — a student's stored sets of functions (+ viewing window) so they
 * can revisit or re-open a graph later. Any signed-in user may use it.
 */

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const graphs = await db.savedGraph.findMany({
    where: { userId: user.id },
    orderBy: { updatedAt: "desc" },
    take: 50,
    select: { id: true, title: true, expressions: true, view: true, updatedAt: true },
  });
  return NextResponse.json({ graphs });
}

export async function POST(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!validateCsrfOrigin(request)) {
    return NextResponse.json({ error: "Invalid request origin" }, { status: 403 });
  }

  const body = await request.json().catch(() => null);
  const title = String(body?.title ?? "").trim().slice(0, 60) || "Untitled graph";
  const rawExprs = Array.isArray(body?.expressions) ? body.expressions : [];
  const expressions = rawExprs
    .filter((s: unknown) => typeof s === "string")
    .map((s: string) => s.trim())
    .filter(Boolean)
    .slice(0, 10)
    .map((s: string) => s.slice(0, 200));

  if (expressions.length === 0) {
    return NextResponse.json({ error: "Nothing to save" }, { status: 400 });
  }

  // Keep only a plain {xMin,xMax,yMin,yMax} object if provided.
  let view: Record<string, number> | undefined;
  const v = body?.view;
  if (v && typeof v === "object") {
    const keys = ["xMin", "xMax", "yMin", "yMax"] as const;
    if (keys.every((k) => Number.isFinite(v[k]))) {
      view = { xMin: v.xMin, xMax: v.xMax, yMin: v.yMin, yMax: v.yMax };
    }
  }

  const created = await db.savedGraph.create({
    data: { userId: user.id, title, expressions, view: view ?? undefined },
    select: { id: true, title: true, expressions: true, view: true, updatedAt: true },
  });
  return NextResponse.json({ graph: created }, { status: 201 });
}
