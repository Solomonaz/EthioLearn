import { signOut } from "next-auth/react";

/**
 * Sign out and land on /login — the one logout path for every surface.
 *
 * `signOut({ redirect: false })` clears the session cookie (and fires the
 * server-side revoke event) without navigating; the hard `location.replace`
 * then:
 *   • swaps the current dashboard entry for /login in the history, so Back
 *     does not step into the page the user just left, and
 *   • starts a fresh document, dropping Next's client router cache — a soft
 *     navigation would keep rendered dashboard pages reachable via Back/Forward.
 */
export async function logout(): Promise<void> {
  try {
    await signOut({ redirect: false });
  } finally {
    window.location.replace("/login");
  }
}
