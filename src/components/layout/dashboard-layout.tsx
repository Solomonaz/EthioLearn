"use client";

import { useState, useEffect } from "react";
import { useSession } from "next-auth/react";
import { useRouter, usePathname } from "next/navigation";
import { Navbar } from "./navbar";
import { Sidebar } from "./sidebar";
import { MobileNav, hasMobileBottomNav } from "./mobile-nav";
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
  // Only pad for the bottom bar on routes that actually render one.
  const bottomBarPad = hasMobileBottomNav(pathname);

  // Restore the sidebar collapsed preference (desktop only; default = open).
  useEffect(() => {
    try {
      setCollapsed(localStorage.getItem("sidebarCollapsed") === "1");
    } catch {
      /* ignore unavailable storage */
    }
  }, []);

  const toggleCollapsed = () => {
    setCollapsed((v) => {
      const next = !v;
      try {
        localStorage.setItem("sidebarCollapsed", next ? "1" : "0");
      } catch {
        /* ignore unavailable storage */
      }
      return next;
    });
  };

  // A page restored from the back/forward cache (Back/Forward after logout)
  // runs no server check at all — Safari restores even no-store pages. Ask the
  // server whether the session still exists, and leave if it does not.
  useEffect(() => {
    const onPageShow = async (e: PageTransitionEvent) => {
      if (!e.persisted) return;
      try {
        const res = await fetch("/api/auth/session", { cache: "no-store" });
        const data = await res.json();
        if (!data?.user) window.location.replace("/login");
      } catch {
        window.location.reload();
      }
    };
    window.addEventListener("pageshow", onPageShow);
    return () => window.removeEventListener("pageshow", onPageShow);
  }, []);

  useEffect(() => {
    if (status === "loading") return;
    if (!session) {
      // Hard navigation (not router.replace) so the client router cache of
      // dashboard pages is discarded along with the session.
      window.location.replace("/login");
      return;
    }
    const user = session?.user as
      | { profileIncomplete?: boolean; mustChangePassword?: boolean }
      | undefined;
    // A school-issued temporary password must be replaced before anything else.
    if (user?.mustChangePassword) {
      router.replace("/change-password");
    } else if (user?.profileIncomplete) {
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
          <div className={cn("px-3 pt-3 sm:px-5 sm:pt-5 md:pb-8 md:pr-5", bottomBarPad ? "pb-24" : "pb-6")}>
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
      <Sidebar
        isOpen={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
        collapsed={collapsed}
        onToggleCollapse={toggleCollapsed}
      />

      <main
        className={cn(
          "transition-[margin] duration-200 md:pb-0",
          bottomBarPad ? "pb-20" : "pb-6",
          collapsed ? "md:ml-20" : "md:ml-64",
        )}
      >
        <div className="p-4 sm:p-6 lg:p-8">{children}</div>
      </main>

      <MobileNav />
    </div>
  );
}
