"use client";

import { useEffect } from "react";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import { Spinner } from "@/components/ui/spinner";

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

    const user = session?.user as ({ profileIncomplete?: boolean; role?: string } | undefined);

    if (user?.profileIncomplete) {
      router.replace("/complete-profile");
      return;
    }

    const role = user?.role;
    if (role === "SUPER_ADMIN") {
      router.replace("/admin");
    } else if (role === "SCHOOL_ADMIN") {
      router.replace("/school-admin");
    } else {
      router.replace("/student");
    }
  }, [status, session, router]);

  return (
    <div className="flex min-h-screen items-center justify-center">
      <Spinner size="lg" className="text-primary" />
    </div>
  );
}
