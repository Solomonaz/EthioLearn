import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { validateCsrfOrigin } from "@/lib/csrf";

export async function POST(req: Request) {
  if (!validateCsrfOrigin(req)) {
    return NextResponse.json({ error: "Invalid request origin" }, { status: 403 });
  }
  const body = (await req.json().catch(() => null)) as { locale?: unknown } | null;
  const locale = body?.locale;
  if (typeof locale !== "string" || !["en", "am"].includes(locale)) {
    return NextResponse.json({ error: "Invalid locale" }, { status: 400 });
  }
  const cookieStore = await cookies();
  // Readable by the page (no httpOnly) on purpose: it is only a language choice.
  cookieStore.set("locale", locale, { maxAge: 60 * 60 * 24 * 365, path: "/", sameSite: "lax", secure: process.env.NODE_ENV === "production" });
  return NextResponse.json({ success: true });
}
