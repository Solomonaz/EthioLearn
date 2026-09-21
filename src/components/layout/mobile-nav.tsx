"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import { Home, BookOpen, User, Trophy, Swords } from "lucide-react";
import { cn } from "@/lib/utils";
import { useEntitlements } from "@/hooks/use-entitlements";

const studentNavKeys = [
  { labelKey: "home",        href: "/student",              icon: Home,     exact: true },
  { labelKey: "quiz_short",  href: "/student/quiz",         icon: BookOpen },
  { labelKey: "battle_short",href: "/student/battle",       icon: Swords },
  { labelKey: "ranks",       href: "/student/leaderboard",  icon: Trophy },
  { labelKey: "profile",     href: "/student/profile",      icon: User },
];

/**
 * Whether a route gets the mobile bottom bar. Only students do — admins,
 * school-admins and teachers navigate from the drawer sidebar.
 *
 * Exported so the layout can reserve bottom padding on exactly the routes that
 * actually have a bar. It used to pad every mobile route, leaving 5rem of dead
 * space under admin and teacher pages where no bar is rendered.
 */
export function hasMobileBottomNav(pathname: string): boolean {
  return !(
    pathname.startsWith("/admin") ||
    pathname.startsWith("/school-admin") ||
    pathname.startsWith("/teacher") ||
    pathname.startsWith("/secondary-teacher")
  );
}

export function MobileNav() {
  const pathname = usePathname();
  const t = useTranslations("nav");
  const ent = useEntitlements();

  if (!hasMobileBottomNav(pathname)) return null;

  // Hide plan-locked destinations (Battle → multiplayer, Ranks → leaderboard).
  const navKeys = studentNavKeys.filter((item) => {
    if (item.labelKey === "battle_short" && !ent.multiplayer) return false;
    if (item.labelKey === "ranks" && !ent.leaderboard) return false;
    return true;
  });

  return (
    <nav className="fixed bottom-0 left-0 right-0 z-40 border-t border-border bg-surface md:hidden">
      <div className="flex items-center justify-around py-2">
        {navKeys.map((item) => {
          const isActive = item.exact
            ? pathname === item.href
            : pathname === item.href || pathname.startsWith(item.href + "/");

          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "flex flex-col items-center gap-0.5 px-2 py-1 text-xs transition-colors",
                isActive
                  ? "font-semibold text-primary"
                  : "text-text-muted hover:text-text-secondary",
              )}
            >
              <item.icon className={cn("h-5 w-5", isActive && "text-primary")} />
              {t(item.labelKey as any)}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
