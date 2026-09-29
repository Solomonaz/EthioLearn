"use client";

import { useEffect } from "react";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import { Spinner } from "@/components/ui/spinner";
import { homeRouteForRole } from "@/lib/teacher-band";

/**
 * Post-login redirect hub.
 * - Incomplete profile (Telegram new user) → /complete-profile
 * - Admin roles → /admin
 * - Students → /student
 */
export default function AuthRedirectPage() {
  const { data: session, status } = useSession();
  const router = useRouter();

  useEffect(() => {
    if (status === "loading") return;

    if (status === "unauthenticated") {
      router.replace("/login");
      return;
    }

    const user = session?.user as
      | { profileIncomplete?: boolean; mustChangePassword?: boolean; role?: string }
      | undefined;

    if (user?.mustChangePassword) {
      router.replace("/change-password");
      return;
    }

    if (user?.profileIncomplete) {
      router.replace("/complete-profile");
      return;
    }

    const role = user?.role;
    router.replace(homeRouteForRole(role));
  }, [status, session, router]);

  return (
    <div className="flex min-h-screen items-center justify-center">
      <Spinner size="lg" className="text-primary" />
    </div>
  );
}
