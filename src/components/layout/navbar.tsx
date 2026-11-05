"use client";

import Link from "next/link";
import { useState } from "react";
import { useSession } from "next-auth/react";
import { logout } from "@/lib/logout";
import { Menu, X, LogOut } from "lucide-react";
import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { LanguageSwitcher } from "@/components/ui/language-switcher";
import { ThemeToggle } from "@/components/ui/theme-toggle";
import { NotificationBell } from "@/components/ui/notification-bell";
import { Logo } from "@/components/ui/logo";

interface NavbarProps {
  onMenuToggle?: () => void;
  isSidebarOpen?: boolean;
}

export function Navbar({ onMenuToggle, isSidebarOpen }: NavbarProps) {
  const { data: session, status } = useSession();
  const t  = useTranslations("common");
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  return (
    <header className="sticky top-0 z-40 border-b border-border bg-surface">
      <div className="flex h-16 items-center justify-between gap-2 px-3 sm:px-6">
        <div className="flex min-w-0 items-center gap-1 sm:gap-3">
          {session && (
            <button
              onClick={onMenuToggle}
              className="shrink-0 rounded-lg p-2 text-text-secondary hover:bg-border/50 md:hidden"
              aria-label="Toggle sidebar"
            >
              {isSidebarOpen ? (
                <X className="h-5 w-5" />
              ) : (
                <Menu className="h-5 w-5" />
              )}
            </button>
          )}
          <Link href="/" aria-label={t("appName")} className="min-w-0">
            {/* Phones get the mark alone; the wordmark returns at sm. */}
            <span className="sm:hidden">
              <Logo size="sm" iconOnly />
            </span>
            <span className="hidden sm:inline-flex">
              <Logo size="sm" />
            </span>
          </Link>
        </div>

        {status === "loading" ? null : session ? (
          <div className="flex shrink-0 items-center gap-1 sm:gap-3">
            {/* The 3-way theme control is ~84px, which a 375px row cannot
                spare. It moves into the drawer on phones (see Sidebar) and
                comes back here from sm up. The language switcher stays: an
                EN/አማ audience needs it one tap away, not two. */}
            <span className="hidden sm:inline-flex">
              <ThemeToggle />
            </span>
            <LanguageSwitcher />
            <NotificationBell
              viewAllHref={(session.user as { role?: string }).role === "STUDENT" ? "/student/notifications" : undefined}
            />
            {/* Students only — XP is the student points economy, and a
                teacher's header showed "XP Level 1". It also read a `xp`
                field the session never carries (with `?? 0 / 100` binding
                the division to the 0), so every student saw Level 1 too.
                `xpLevel` is what the profile page shows. */}
            {(session.user as { role?: string }).role === "STUDENT" && (
              <Badge variant="success" className="hidden sm:inline-flex">
                XP Level {(session.user as { xpLevel?: number }).xpLevel ?? 1}
              </Badge>
            )}
            <span className="hidden text-sm font-medium text-text-primary sm:block">
              {session.user?.name}
            </span>
            <Avatar
              name={session.user?.name || "User"}
              src={session.user?.image}
              size="sm"
            />
            <button
              onClick={logout}
              className="rounded-lg p-2 text-text-secondary hover:bg-border/50"
              aria-label="Sign out"
            >
              <LogOut className="h-5 w-5" />
            </button>
          </div>
        ) : (
          <>
            {/* Desktop auth links */}
            <div className="hidden shrink-0 items-center gap-3 sm:flex">
              <ThemeToggle />
              <LanguageSwitcher />
              <Link
                href="/login"
                className="text-sm font-medium text-text-secondary hover:text-primary"
              >
                {t("signIn")}
              </Link>
              <Link href="/register">
                <Button size="sm">{t("getStarted")}</Button>
              </Link>
            </div>

            {/* Mobile hamburger for unauthenticated */}
            <button
              onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
              className="rounded-lg p-2 text-text-secondary hover:bg-border/50 sm:hidden"
              aria-label="Toggle menu"
            >
              {mobileMenuOpen ? (
                <X className="h-5 w-5" />
              ) : (
                <Menu className="h-5 w-5" />
              )}
            </button>
          </>
        )}
      </div>

      {/* Mobile dropdown for unauthenticated users */}
      {status !== "loading" && !session && mobileMenuOpen && (
        <div className="border-t border-border px-4 py-3 sm:hidden">
          <Link
            href="/login"
            className="block py-2 text-sm font-medium text-text-secondary hover:text-primary"
            onClick={() => setMobileMenuOpen(false)}
          >
            {t("signIn")}
          </Link>
          <Link
            href="/register"
            className="block py-2 text-sm font-medium text-primary"
            onClick={() => setMobileMenuOpen(false)}
          >
            {t("getStarted")}
          </Link>
        </div>
      )}
    </header>
  );
}
