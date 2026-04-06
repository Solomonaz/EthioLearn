/**
 * DELETE /api/auth/sessions/[id]  — Revoke a specific session by its DB id.
 */
import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/get-session";
import { revokeSession } from "@/lib/session-store";

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
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
