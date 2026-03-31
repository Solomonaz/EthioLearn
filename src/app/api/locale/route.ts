import { cookies } from "next/headers";
import { NextResponse } from "next/server";

export async function POST(req: Request) {
  const { locale } = await req.json();
  if (!["en", "am"].includes(locale)) {
    return NextResponse.json({ error: "Invalid locale" }, { status: 400 });
  }
  const cookieStore = await cookies();
  cookieStore.set("locale", locale, { maxAge: 60 * 60 * 24 * 365, path: "/" });
  return NextResponse.json({ success: true });
}
