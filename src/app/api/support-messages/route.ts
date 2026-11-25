import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getCurrentUser } from "@/lib/get-session";
import { validateCsrfOrigin } from "@/lib/csrf";
import { rateLimit } from "@/lib/rate-limit";
import { createNotification } from "@/lib/notifications";
import { sendMail } from "@/lib/mailer";
import { LEGAL_CONTACT_EMAIL } from "@/components/legal/legal-page";
import {
  cleanSupportText,
  isSupportTopic,
  SUPPORT_DAILY_LIMIT,
  SUPPORT_MAX_CHARS,
  SUPPORT_MIN_CHARS,
} from "@/lib/support";

/**
 * "Contact us".
 *
 * GET  → the signed-in user's own messages (newest first) with any reply.
 * POST { topic, body } → send one to the Abugida team. Same-site only, a
 *      burst limit and a daily cap; the super admin hears about it in-app and
 *      by email. Super admins don't write here — they answer in Admin → Messages.
 */

const MAX_LIST = 30;

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (user.role === "SUPER_ADMIN") return NextResponse.json({ messages: [] });
  const messages = await db.supportMessage.findMany({
    where: { userId: user.id },
    orderBy: { createdAt: "desc" },
    take: MAX_LIST,
    select: { id: true, topic: true, body: true, status: true, reply: true, repliedAt: true, createdAt: true },
  });
  return NextResponse.json({ messages });
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

export async function POST(req: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!validateCsrfOrigin(req)) return NextResponse.json({ error: "Invalid request origin" }, { status: 403 });
  if (user.role === "SUPER_ADMIN") {
    return NextResponse.json({ error: "Admins answer messages in Admin → Messages." }, { status: 403 });
  }

  const raw = (await req.json().catch(() => null)) as { topic?: unknown; body?: unknown } | null;
  if (!isSupportTopic(raw?.topic)) return NextResponse.json({ error: "Choose a topic.", code: "BAD_TOPIC" }, { status: 400 });
  if (typeof raw?.body !== "string" || raw.body.length > SUPPORT_MAX_CHARS * 2) {
    return NextResponse.json({ error: "Message too long.", code: "BAD_BODY" }, { status: 400 });
  }
  const body = cleanSupportText(raw.body, SUPPORT_MAX_CHARS);
  if (body.length < SUPPORT_MIN_CHARS) {
    return NextResponse.json({ error: "Please write a little more.", code: "TOO_SHORT" }, { status: 400 });
  }
  if (raw.body.trim().length > SUPPORT_MAX_CHARS) {
    return NextResponse.json({ error: `Keep it under ${SUPPORT_MAX_CHARS} characters.`, code: "TOO_LONG" }, { status: 400 });
  }

  // Counted only for messages that would be sent, so a rejected try never locks anyone out.
  const rl = rateLimit(`support:${user.id}`, 3, 10 * 60_000);
  if (!rl.success) {
    return NextResponse.json(
      { error: "You've sent a few messages just now. Please wait a few minutes.", code: "RATE_LIMITED" },
      { status: 429, headers: { "Retry-After": String(rl.retryAfter) } },
    );
  }

  const today = await db.supportMessage.count({
    where: { userId: user.id, createdAt: { gte: new Date(Date.now() - 86_400_000) } },
  });
  if (today >= SUPPORT_DAILY_LIMIT) {
    return NextResponse.json(
      { error: "You've sent the most messages for today. We'll get back to you.", code: "DAILY_LIMIT" },
      { status: 429 },
    );
  }

  const msg = await db.supportMessage.create({
    data: { userId: user.id, topic: raw.topic, body },
    select: { id: true, topic: true, body: true, status: true, reply: true, repliedAt: true, createdAt: true },
  });

  // Let the team know — never fail the student's send over it.
  const who = `${user.name}${user.username ? ` (@${user.username})` : ""} · ${user.role}${user.grade ? ` · Grade ${user.grade}` : ""}`;
  db.user
    .findMany({ where: { role: "SUPER_ADMIN", isActive: true }, select: { id: true } })
    .then((admins) =>
      Promise.all(
        admins.map((a) =>
          createNotification(a.id, "support", "New message", `${who}: ${body.slice(0, 120)}`, { href: "/admin/messages" }),
        ),
      ),
    )
    .catch((e) => console.error("[support] notify admins:", e));
  const inbox = process.env.SUPPORT_INBOX_EMAIL || process.env.SUPER_ADMIN_EMAIL || LEGAL_CONTACT_EMAIL;
  sendMail(
    inbox,
    `Abugida — new ${raw.topic} message`,
    `<p><strong>${escapeHtml(who)}</strong> wrote (${escapeHtml(raw.topic)}):</p><p style="white-space:pre-wrap">${escapeHtml(body)}</p><p>Answer it in Admin → Messages.</p>`,
    `${who} wrote (${raw.topic}):\n\n${body}\n\nAnswer it in Admin → Messages.`,
  ).catch((e) => console.error("[support] email:", e instanceof Error ? e.message : e));

  return NextResponse.json({ message: msg }, { status: 201 });
}
