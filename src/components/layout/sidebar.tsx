"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Home,
  BookOpen,
  MessageSquare,
  User,
  Trophy,
  Gift,
  Swords,
  LayoutDashboard,
  Library,
  Users,
  BarChart2,
  History,
  Settings,
  HelpCircle,
  Bell,
  TrendingUp,
  BookMarked,
} from "lucide-react";
import { cn } from "@/lib/utils";

const studentNavItems = [
  { label: "Dashboard", href: "/student", icon: Home, exact: true },
  { label: "Take Quiz", href: "/student/quiz", icon: BookOpen },
  { label: "AI Tutor", href: "/student/tutor", icon: MessageSquare },
  { label: "Battle Mode", href: "/student/battle", icon: Swords },
  { label: "Leaderboard", href: "/student/leaderboard", icon: Trophy },
  { label: "Rewards", href: "/student/rewards", icon: Gift },
  { label: "Notifications", href: "/student/notifications", icon: Bell },
  { label: "Profile", href: "/student/profile", icon: User },
  { label: "My Progress", href: "/student/progress", icon: TrendingUp },
  { label: "My Books", href: "/student/books", icon: BookMarked },
  { label: "Quiz History", href: "/student/history", icon: History },
  { label: "Settings", href: "/student/settings", icon: Settings },
];

const adminNavItems = [
  { label: "Dashboard", href: "/admin", icon: LayoutDashboard, exact: true },
  { label: "Students", href: "/admin/students", icon: Users },
  { label: "Textbooks", href: "/admin/textbooks", icon: Library },
  { label: "Subjects", href: "/admin/subjects", icon: BookMarked },
  { label: "Questions", href: "/admin/questions", icon: HelpCircle },
  { label: "Rewards", href: "/admin/rewards", icon: Gift },
  { label: "Analytics", href: "/admin/analytics", icon: BarChart2 },
  { label: "Settings", href: "/admin/settings", icon: Settings },
];

interface SidebarProps {
  isOpen: boolean;
  onClose?: () => void;
}

export function Sidebar({ isOpen, onClose }: SidebarProps) {
  const pathname = usePathname();
  const isAdmin = pathname.startsWith("/admin");
  const navItems = isAdmin ? adminNavItems : studentNavItems;

  return (
    <>
      {/* Mobile overlay */}
      {isOpen && (
        <div
          className="fixed inset-0 z-30 bg-black/40 md:hidden"
          onClick={onClose}
        />
      )}

      <aside
        className={cn(
          "fixed left-0 top-16 z-30 h-[calc(100vh-4rem)] w-64 border-r border-border bg-surface transition-transform duration-200 md:translate-x-0",
          isOpen ? "translate-x-0" : "-translate-x-full",
        )}
      >
        <nav className="flex flex-col gap-1 p-4">
          {/* Section label */}
          <p className="mb-2 px-3 text-xs font-semibold uppercase tracking-wider text-text-muted">
            {isAdmin ? "Administration" : "Student"}
          </p>

          {navItems.map((item) => {
            const isActive = item.exact
              ? pathname === item.href
              : pathname === item.href || pathname.startsWith(item.href + "/");

            return (
              <Link
                key={item.href}
                href={item.href}
                onClick={onClose}
                className={cn(
                  "flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm transition-colors",
                  isActive
                    ? "bg-primary/10 font-bold text-primary"
                    : "text-text-secondary hover:bg-border/50 hover:text-text-primary",
                )}
              >
                <item.icon className="h-5 w-5 shrink-0" />
                {item.label}
              </Link>
            );
          })}
        </nav>
      </aside>
    </>
  );
}
