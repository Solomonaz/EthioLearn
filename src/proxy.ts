import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { getToken } from "next-auth/jwt";
import { homeRouteForRole } from "@/lib/teacher-band";

/**
 * Next 16 middleware (renamed from `middleware.ts` to `proxy.ts`).
 *
 * Every role-gated surface has its own home route, and a signed-in user is
 * only ever allowed inside their own. `homeRouteForRole` is the single source
 * of truth shared with the login redirect hubs and the dashboard layouts, so a
 * new role can never be silently funnelled somewhere it does not belong.
 */

const AUTH_PATHS = ["/login", "/register"];

/** Every surface that requires a session. Each is also some role's home. */
const PROTECTED_PATHS = [
  "/student",
  "/admin",
  "/school-admin",
  "/teacher",
  "/secondary-teacher",
];

/**
 * Prefix match on a path boundary. Plain `startsWith` is not safe here:
 * "/teacher" is a prefix of "/secondary-teacher" only by accident, and
 * "/admin" is a prefix of "/admin_ethiolearn" — neither should match.
 */
function isUnder(pathname: string, base: string): boolean {
  return pathname === base || pathname.startsWith(base + "/");
}

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  const token = await getToken({
    req: request,
    secret: process.env.NEXTAUTH_SECRET,
  });

  const isAuthenticated = !!token;
  const home = homeRouteForRole(token?.role as string | undefined);

  // A `callbackUrl` on the login page means a server component just refused
  // this session — the account was deactivated or removed while its JWT was
  // still valid. Bouncing such a user back to their dashboard would loop:
  // proxy trusts the token, the layout checks the database and disagrees.
  // Let the login page render instead, so they can sign in again.
  const rejectedBySurface = request.nextUrl.searchParams.has("callbackUrl");

  // Signed-in users on the login/register pages → their own dashboard.
  if (
    isAuthenticated &&
    !rejectedBySurface &&
    AUTH_PATHS.some((p) => isUnder(pathname, p))
  ) {
    return NextResponse.redirect(new URL(home, request.url));
  }

  const protectedBase = PROTECTED_PATHS.find((p) => isUnder(pathname, p));
  if (protectedBase) {
    // Signed out → login, remembering where they were headed.
    if (!isAuthenticated) {
      const loginUrl = new URL("/login", request.url);
      loginUrl.searchParams.set("callbackUrl", pathname);
      return NextResponse.redirect(loginUrl);
    }

    // Signed in, but this is somebody else's surface → their own home.
    // The layouts enforce this too; doing it here just saves a render.
    if (protectedBase !== home) {
      return NextResponse.redirect(new URL(home, request.url));
    }
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    "/student/:path*",
    "/admin/:path*",
    "/school-admin/:path*",
    "/teacher/:path*",
    "/secondary-teacher/:path*",
    "/login",
    "/register",
  ],
};
