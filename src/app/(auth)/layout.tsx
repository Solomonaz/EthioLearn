/**
 * Auth pages depend on the session (a signed-in user is sent to their
 * dashboard), so they must never be served from a cache. Forcing dynamic
 * rendering makes Next send `Cache-Control: no-store` in production — a
 * statically prerendered login page would be cacheable, and Back/Forward could
 * restore it for a user who is already signed in.
 */
export const dynamic = "force-dynamic";

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return children;
}
