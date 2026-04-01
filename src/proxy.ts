import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { getToken } from "next-auth/jwt";

const protectedPaths = ["/student", "/admin"];
const authPaths = ["/login", "/register"];

function isAdminRole(role?: string | unknown) {
  return role === "SUPER_ADMIN" || role === "SCHOOL_ADMIN";
}

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  const token = await getToken({
    req: request,
    secret: process.env.NEXTAUTH_SECRET,
  });

  const isAuthenticated = !!token;
  const adminUser = isAdminRole(token?.role);

  // Authenticated users on auth pages → redirect to their dashboard
  if (authPaths.some((path) => pathname.startsWith(path)) && isAuthenticated) {
    return NextResponse.redirect(
      new URL(adminUser ? "/admin" : "/student", request.url)
    );
  }

  // Unauthenticated users on protected pages → redirect to login
  if (protectedPaths.some((path) => pathname.startsWith(path)) && !isAuthenticated) {
    const loginUrl = new URL("/login", request.url);
    loginUrl.searchParams.set("callbackUrl", pathname);
    return NextResponse.redirect(loginUrl);
  }

  // Student trying to access admin routes → redirect to student dashboard
  if (pathname.startsWith("/admin") && isAuthenticated && !adminUser) {
    return NextResponse.redirect(new URL("/student", request.url));
  }

  // Admin trying to access student routes → redirect to admin dashboard
  if (pathname.startsWith("/student") && isAuthenticated && adminUser) {
    return NextResponse.redirect(new URL("/admin", request.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/student/:path*", "/admin/:path*", "/login", "/register"],
};
