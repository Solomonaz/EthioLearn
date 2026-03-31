import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

const protectedPaths = ["/student", "/admin"];
const authPaths = ["/login", "/register"];

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const token = request.cookies.get("next-auth.session-token")?.value;

  // Redirect authenticated users away from auth pages
  if (authPaths.some((path) => pathname.startsWith(path)) && token) {
    return NextResponse.redirect(new URL("/student", request.url));
  }

  // Redirect unauthenticated users to login
  if (protectedPaths.some((path) => pathname.startsWith(path)) && !token) {
    const loginUrl = new URL("/login", request.url);
    loginUrl.searchParams.set("callbackUrl", pathname);
    return NextResponse.redirect(loginUrl);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/student/:path*", "/admin/:path*", "/login", "/register"],
};
