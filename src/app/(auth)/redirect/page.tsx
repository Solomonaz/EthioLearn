"use client";

/**
 * /auth/redirect
 *
 * Landing page after social sign-in (Google, Telegram).
 * Reads the user's role from the session and routes them to the correct
 * dashboard — the same logic the OTP login page uses.
 */
import { useEffect } from "react";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import { Spinner } from "@/components/ui/spinner";
import { homeRouteForRole } from "@/lib/teacher-band";

export default function AuthRedirectPage() {
  const { data: session, status } = useSession();
  const router = useRouter();

  useEffect(() => {
    if (status === "loading") return;

    if (status === "unauthenticated") {
      router.replace("/login");
      return;
    }

    const role = (session?.user as { role?: string } | undefined)?.role;
    router.replace(homeRouteForRole(role));
  }, [session, status, router]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-background">
      <div className="flex flex-col items-center gap-4">
        <Spinner size="lg" className="text-primary" />
        <p className="text-sm text-text-secondary">Signing you in…</p>
      </div>
    </div>
  );
}
