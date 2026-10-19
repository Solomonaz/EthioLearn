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

/**
 * Public pages a signed-in user never sees: they go straight to their
 * dashboard. Includes the landing page, so Back from a dashboard to "/" lands
 * back on the dashboard instead of a page offering "Sign in".
 */
const SIGNED_OUT_ONLY_PATHS = ["/", ...AUTH_PATHS];

/** Every surface that requires a session. Each is also some role's home. */
const PROTECTED_PATHS = [
  "/student",
  "/play",
  "/admin",
  "/school-admin",
  "/teacher",
  "/secondary-teacher",
];

/**
 * A student may be inside either student surface: /student (grades 9-12) or
 * /play (grades 1-8). Which one is theirs depends on their grade, and the
 * grade in the token can be stale (only an admin changes it, and the token is
 * not refreshed), so the proxy never chooses between the two — the student
 * and play layouts read the grade from the database and redirect. Choosing
 * here too could bounce a student between two disagreeing checks forever.
 */
const STUDENT_SURFACES = ["/student", "/play"];

/**
 * Prefix match on a path boundary. Plain `startsWith` is not safe here:
 * "/teacher" is a prefix of "/secondary-teacher" only by accident, and
 * "/admin" is a prefix of "/admin_abugida" — neither should match.
 */
function isUnder(pathname: string, base: string): boolean {
  return pathname === base || pathname.startsWith(base + "/");
}

/**
 * Forbid the browser from keeping a copy of a session-dependent page. Without
 * this, Back/Forward after logout can restore a dashboard from the
 * back/forward cache without ever asking the server, and the login page can
 * reappear for a user who is already signed in.
 */
function noStore(res: NextResponse): NextResponse {
  res.headers.set("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0");
  res.headers.set("Pragma", "no-cache");
  res.headers.set("Expires", "0");
  return res;
}

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  const token = await getToken({
    req: request,
    secret: process.env.NEXTAUTH_SECRET,
  });

  const isAuthenticated = !!token;
  const role = token?.role as string | undefined;
  const home = homeRouteForRole(role, token?.grade as number | null | undefined);

  // `rejected=1` on the login page means a dashboard layout just refused this
  // session — the account was deactivated or removed while its JWT was still
  // valid. Bouncing such a user back to their dashboard would loop: proxy
  // trusts the token, the layout checks the database and disagrees. Let the
  // login page render instead, so they can sign in again.
  //
  // Deliberately NOT keyed on `callbackUrl`: the ordinary signed-out redirect
  // below adds one too, and that history entry must still send a signed-in
  // user (arriving via Back/Forward) to their dashboard, not a login form.
  const rejectedBySurface = request.nextUrl.searchParams.get("rejected") === "1";

  // Signed-in users on the landing, login or register page → their own
  // dashboard. "/" is matched exactly — isUnder("/") would match every path.
  if (
    isAuthenticated &&
    !rejectedBySurface &&
    SIGNED_OUT_ONLY_PATHS.some((p) => (p === "/" ? pathname === "/" : isUnder(pathname, p)))
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
    const ownSurface =
      protectedBase === home ||
      (role === "STUDENT" && STUDENT_SURFACES.includes(protectedBase));
    if (!ownSurface) {
      return NextResponse.redirect(new URL(home, request.url));
    }
  }

  // Everything this proxy matches is a protected surface, an auth page or the
  // landing page — all depend on the session, so none may be cached.
  return noStore(NextResponse.next());
}

export const config = {
  matcher: [
    "/",
    "/student/:path*",
    "/play/:path*",
    "/admin/:path*",
    "/school-admin/:path*",
    "/teacher/:path*",
    "/secondary-teacher/:path*",
    "/login",
    "/register",
  ],
};
