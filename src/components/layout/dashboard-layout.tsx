"use client";

import { useState, useEffect } from "react";
import { useSession } from "next-auth/react";
import { useRouter, usePathname } from "next/navigation";
import { Navbar } from "./navbar";
import { Sidebar } from "./sidebar";
import { MobileNav } from "./mobile-nav";
import { TeacherTopBar } from "./teacher-topbar";
import { cn } from "@/lib/utils";

interface DashboardLayoutProps {
  children: React.ReactNode;
}

export function DashboardLayout({ children }: DashboardLayoutProps) {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const { data: session, status } = useSession();
  const router = useRouter();
  const pathname = usePathname();
  const isTeacher = pathname.startsWith("/teacher");

  // Restore the teacher sidebar collapsed preference (desktop only).
  useEffect(() => {
    try {
      setCollapsed(localStorage.getItem("teacherSidebarCollapsed") === "1");
    } catch {
      /* ignore unavailable storage */
    }
  }, []);

  const toggleCollapsed = () => {
    setCollapsed((v) => {
      const next = !v;
      try {
        localStorage.setItem("teacherSidebarCollapsed", next ? "1" : "0");
      } catch {
        /* ignore unavailable storage */
      }
      return next;
    });
  };

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
        <Sidebar
          isOpen={sidebarOpen}
          onClose={() => setSidebarOpen(false)}
          collapsed={collapsed}
          onToggleCollapse={toggleCollapsed}
        />
        {/* content leaves room for the floating sidebar on desktop */}
        <div
          className={cn(
            "transition-[padding] duration-200",
            collapsed ? "md:pl-[6.5rem]" : "md:pl-[17.5rem]",
          )}
        >
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
