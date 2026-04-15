"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import { Home, BookOpen, User, Trophy, Swords } from "lucide-react";
import { cn } from "@/lib/utils";

const studentNavKeys = [
  { labelKey: "home",        href: "/student",              icon: Home,     exact: true },
  { labelKey: "quiz_short",  href: "/student/quiz",         icon: BookOpen },
  { labelKey: "battle_short",href: "/student/battle",       icon: Swords },
  { labelKey: "ranks",       href: "/student/leaderboard",  icon: Trophy },
  { labelKey: "profile",     href: "/student/profile",      icon: User },
];

export function MobileNav() {
  const pathname = usePathname();
  const t = useTranslations("nav");

  if (pathname.startsWith("/admin") || pathname.startsWith("/school-admin")) return null;

  return (
    <nav className="fixed bottom-0 left-0 right-0 z-40 border-t border-border bg-surface md:hidden">
      <div className="flex items-center justify-around py-2">
        {studentNavKeys.map((item) => {
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
