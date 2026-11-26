/**
 * DELETE /api/auth/sessions/[id]  — Revoke a specific session by its DB id.
 */
import { NextRequest, NextResponse } from "next/server";
import { validateCsrfOrigin } from "@/lib/csrf";
import { getCurrentUser } from "@/lib/get-session";
import { revokeSession } from "@/lib/session-store";

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!validateCsrfOrigin(req)) {
    return NextResponse.json({ error: "Invalid request origin" }, { status: 403 });
  }
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const revoked = await revokeSession(id, user.id);

  if (!revoked) {
    return NextResponse.json(
      { error: "Session not found or already revoked" },
      { status: 404 }
    );
  }

  return NextResponse.json({ success: true });
}
