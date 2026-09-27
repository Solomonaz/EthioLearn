import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/get-session";
import { db } from "@/lib/db";

export async function GET(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const unreadOnly = searchParams.get("unreadOnly") === "true";
  const limit = parseInt(searchParams.get("limit") || "20");

  const [stored, storedUnread] = await Promise.all([
    db.notification.findMany({
      where: { userId: user.id, ...(unreadOnly ? { isRead: false } : {}) },
      orderBy: { createdAt: "desc" },
      take: limit,
    }),
    db.notification.count({ where: { userId: user.id, isRead: false } }),
  ]);

  // Super admins also get one action item per school textbook request waiting
  // for review. These are computed, not stored — the env super admin has no
  // users row for a Notification to reference — so they stay unread until the
  // request is approved or rejected, like a to-do, and "mark read" skips them.
  const actions = user.role === "SUPER_ADMIN" ? await pendingTextbookRequestItems() : [];

  const notifications = [...actions, ...stored]
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
    .slice(0, Math.max(limit, actions.length));

  return NextResponse.json({ notifications, unreadCount: storedUnread + actions.length });
}

async function pendingTextbookRequestItems() {
  const pending = await db.textbook.findMany({
    where: { approvalStatus: "PENDING" },
    orderBy: { createdAt: "desc" },
    take: 50,
    select: { id: true, title: true, grade: true, subject: true, createdAt: true, school: { select: { name: true } } },
  });
  return pending.map((tb) => ({
    id: `action:textbook-request:${tb.id}`,
    type: "textbook_request",
    title: "Textbook request needs review",
    message: `${tb.school?.name ?? "A school"} requested "${tb.title}" (Grade ${tb.grade} ${tb.subject}).`,
    isRead: false,
    actionable: true,
    data: { href: "/admin/textbooks", textbookId: tb.id },
    createdAt: tb.createdAt,
  }));
}
