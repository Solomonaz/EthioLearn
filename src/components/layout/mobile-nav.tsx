"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Home, BookOpen, User, Trophy, Gift, Swords } from "lucide-react";
import { cn } from "@/lib/utils";

// Mobile nav shows the 5 most important student routes
const studentNavItems = [
  { label: "Home", href: "/student", icon: Home, exact: true },
  { label: "Quiz", href: "/student/quiz", icon: BookOpen },
  { label: "Battle", href: "/student/battle", icon: Swords },
  { label: "Ranks", href: "/student/leaderboard", icon: Trophy },
  { label: "Profile", href: "/student/profile", icon: User },
];

// Rewards accessible from sidebar on desktop; on mobile via Profile or separate entry
// We cap at 5 items for mobile UX

export function MobileNav() {
  const pathname = usePathname();

  // Don't show mobile nav on admin routes
  if (pathname.startsWith("/admin") || pathname.startsWith("/school-admin")) return null;

  return (
    <nav className="fixed bottom-0 left-0 right-0 z-40 border-t border-border bg-surface md:hidden">
      <div className="flex items-center justify-around py-2">
        {studentNavItems.map((item) => {
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
              {item.label}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
