"use client";

import { useState, useEffect } from "react";
import { useSession } from "next-auth/react";
import { useRouter, usePathname } from "next/navigation";
import { Navbar } from "./navbar";
import { Sidebar } from "./sidebar";
import { MobileNav } from "./mobile-nav";
import { TeacherTopBar } from "./teacher-topbar";

interface DashboardLayoutProps {
  children: React.ReactNode;
}

export function DashboardLayout({ children }: DashboardLayoutProps) {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const { data: session, status } = useSession();
  const router = useRouter();
  const pathname = usePathname();
  const isTeacher = pathname.startsWith("/teacher");

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

  // ── Teacher surface: no top navbar; a floating sidebar + a top row of
  //    controls, matching the playful kid-friendly design. ────────────────
  if (isTeacher) {
    return (
      <div className="min-h-screen bg-background">
        <Sidebar isOpen={sidebarOpen} onClose={() => setSidebarOpen(false)} />
        {/* content leaves room for the floating sidebar on desktop */}
        <div className="md:pl-[17.5rem]">
          <div className="px-3 pb-24 pt-3 sm:px-5 sm:pt-5 md:pb-8 md:pr-5">
            <TeacherTopBar onMenuToggle={() => setSidebarOpen((v) => !v)} />
            <main>{children}</main>
          </div>
        </div>
        <MobileNav />
      </div>
    );
  }

  // ── Every other role keeps the original shell (top navbar). ─────────────
  return (
    <div className="min-h-screen bg-background">
      <Navbar
        onMenuToggle={() => setSidebarOpen((prev) => !prev)}
        isSidebarOpen={sidebarOpen}
      />
      <Sidebar isOpen={sidebarOpen} onClose={() => setSidebarOpen(false)} />

      <main className="pb-20 md:ml-64 md:pb-0">
        <div className="p-4 sm:p-6 lg:p-8">{children}</div>
      </main>

      <MobileNav />
    </div>
  );
}
