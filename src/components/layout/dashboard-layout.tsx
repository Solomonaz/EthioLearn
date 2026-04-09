"use client";

import { useState, useEffect } from "react";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import { Navbar } from "./navbar";
import { Sidebar } from "./sidebar";
import { MobileNav } from "./mobile-nav";

interface DashboardLayoutProps {
  children: React.ReactNode;
}

export function DashboardLayout({ children }: DashboardLayoutProps) {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const { data: session, status } = useSession();
  const router = useRouter();

  useEffect(() => {
    if (status === "loading") return;
    if (!session) {
      router.replace("/login");
      return;
    }
    const user = session?.user as { profileIncomplete?: boolean } | undefined;
    if (user?.profileIncomplete) {
      router.replace("/complete-profile");
    }
  }, [status, session, router]);

  // Show nothing while checking auth or redirecting to login
  if (status === "loading" || !session) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <Navbar
        onMenuToggle={() => setSidebarOpen((prev) => !prev)}
        isSidebarOpen={sidebarOpen}
      />
      <Sidebar
        isOpen={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
      />

      <main className="pb-20 md:ml-64 md:pb-0">
        <div className="p-4 sm:p-6 lg:p-8">{children}</div>
      </main>

      <MobileNav />
    </div>
  );
}
