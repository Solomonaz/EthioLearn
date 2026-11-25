import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getCurrentUser } from "@/lib/get-session";
import { validateCsrfOrigin } from "@/lib/csrf";
import { createNotification } from "@/lib/notifications";
import { cleanSupportText, contactHref, isSupportStatus, SUPPORT_REPLY_MAX_CHARS } from "@/lib/support";

/**
 * Admin → Messages ("Contact us" inbox). Super admin only.
 *
 * GET   ?status=open|answered|closed|all → messages (newest first, 100 max)
 *       with who sent them, plus a count per status.
 * PATCH { id, reply?, status? } → answer (status becomes "answered" and the
 *       sender is notified, linked to their contact page), close, or reopen.
 */

async function requireSuperAdmin(req?: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (user.role !== "SUPER_ADMIN") return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  if (req && !validateCsrfOrigin(req)) return NextResponse.json({ error: "Invalid request origin" }, { status: 403 });
  return null;
}

export async function GET(req: Request) {
  const denied = await requireSuperAdmin();
  if (denied) return denied;
  const status = new URL(req.url).searchParams.get("status") ?? "open";
  if (status !== "all" && !isSupportStatus(status)) return NextResponse.json({ error: "Invalid status" }, { status: 400 });

  const [messages, grouped] = await Promise.all([
    db.supportMessage.findMany({
      where: status === "all" ? {} : { status },
      orderBy: { createdAt: "desc" },
      take: 100,
      select: {
        id: true, topic: true, body: true, status: true, reply: true, repliedAt: true, createdAt: true,
        user: {
          select: {
            id: true, name: true, username: true, email: true, role: true, grade: true,
            school: { select: { name: true } },
          },
        },
      },
    }),
    db.supportMessage.groupBy({ by: ["status"], _count: { _all: true } }),
  ]);
  const counts = { open: 0, answered: 0, closed: 0 } as Record<string, number>;
  for (const g of grouped) counts[g.status] = g._count._all;
  return NextResponse.json({ messages, counts });
}

export async function PATCH(req: Request) {
  const denied = await requireSuperAdmin(req);
  if (denied) return denied;
  const body = (await req.json().catch(() => null)) as { id?: unknown; reply?: unknown; status?: unknown } | null;
  if (typeof body?.id !== "string" || body.id.length > 40) return NextResponse.json({ error: "Invalid id" }, { status: 400 });
  if (body.status !== undefined && !isSupportStatus(body.status)) return NextResponse.json({ error: "Invalid status" }, { status: 400 });
  if (body.reply !== undefined && (typeof body.reply !== "string" || body.reply.length > SUPPORT_REPLY_MAX_CHARS * 2)) {
    return NextResponse.json({ error: "Invalid reply" }, { status: 400 });
  }
  const reply = body.reply !== undefined ? cleanSupportText(body.reply, SUPPORT_REPLY_MAX_CHARS) : undefined;
  if (reply !== undefined && !reply) return NextResponse.json({ error: "Write a reply first." }, { status: 400 });
  if (reply === undefined && body.status === undefined) return NextResponse.json({ error: "Nothing to change" }, { status: 400 });

  const msg = await db.supportMessage.findUnique({
    where: { id: body.id },
    select: { id: true, userId: true, user: { select: { role: true, grade: true } } },
  });
  if (!msg) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const updated = await db.supportMessage.update({
    where: { id: msg.id },
    data: {
      ...(reply !== undefined ? { reply, repliedAt: new Date(), status: "answered" } : {}),
      ...(body.status !== undefined && reply === undefined ? { status: body.status as string } : {}),
    },
    select: { id: true, status: true, reply: true, repliedAt: true },
  });

  if (reply !== undefined) {
    await createNotification(
      msg.userId,
      "support",
      "The Abugida team replied",
      reply.slice(0, 140),
      { href: contactHref(msg.user.role, msg.user.grade) },
    ).catch((e) => console.error("[support] notify user:", e));
  }
  return NextResponse.json({ message: updated });
}
