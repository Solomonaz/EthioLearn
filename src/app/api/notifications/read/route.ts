import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/get-session";
import { db } from "@/lib/db";

export async function POST(req: Request) {
  const user = await getCurrentUser();
  if (!user)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json();

  if (body.all) {
    await db.notification.updateMany({
      where: { userId: user.id, isRead: false },
      data: { isRead: true },
    });
  } else if (body.notificationIds?.length) {
    await db.notification.updateMany({
      where: { id: { in: body.notificationIds }, userId: user.id },
      data: { isRead: true },
    });
  }

  return NextResponse.json({ success: true });
}
