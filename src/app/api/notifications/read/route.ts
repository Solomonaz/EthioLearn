import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/get-session";
import { db } from "@/lib/db";

export async function POST(req: Request) {
  const user = await getCurrentUser();
  if (!user)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  if (body.all === true) {
    await db.notification.updateMany({
      where: { userId: user.id, isRead: false },
      data: { isRead: true },
    });
  } else if (Array.isArray(body.notificationIds)) {
    // Validate and cap at 100 IDs to prevent DB overload
    const ids = body.notificationIds
      .filter((id: unknown): id is string => typeof id === "string" && id.length > 0)
      .slice(0, 100);
    if (ids.length > 0) {
      await db.notification.updateMany({
        where: { id: { in: ids }, userId: user.id },
        data: { isRead: true },
      });
    }
  }

  return NextResponse.json({ success: true });
}
