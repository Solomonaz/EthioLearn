import type { Metadata } from "next";

// Staff-only sign-in: never indexed, never followed.
export const metadata: Metadata = { title: "Sign in", robots: { index: false, follow: false } };

export default function AdminSignInLayout({ children }: { children: React.ReactNode }) {
  return children;
}
