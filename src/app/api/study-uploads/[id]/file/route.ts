import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/get-session";
import { ownUpload } from "@/lib/study-uploads";

/**
 * GET /api/study-uploads/[id]/file — the file itself, for the student's own
 * eyes only (the page shows it beside the guide). Served with its checked
 * type and no sniffing (the site-wide CSP applies), never cached by shared caches.
 */
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await ctx.params;
  const up = await ownUpload(id, user.id);
  if (!up) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const data = Buffer.from(up.data);
  return new NextResponse(new Uint8Array(data), {
    headers: {
      "Content-Type": up.mime,
      "Content-Length": String(data.length),
      "Content-Disposition": "inline",
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "private, max-age=3600",
    },
  });
}
