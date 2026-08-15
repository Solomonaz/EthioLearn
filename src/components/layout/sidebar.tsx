"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
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
  Building2,
  CreditCard,
  PencilRuler,
  Shuffle,
} from "lucide-react";
import { useSession } from "next-auth/react";
import { cn } from "@/lib/utils";
import { useEntitlements } from "@/hooks/use-entitlements";

interface SidebarProps {
  isOpen: boolean;
  onClose?: () => void;
}

type NavItem = { labelKey: string; href: string; icon: typeof Home; exact?: boolean };

export function Sidebar({ isOpen, onClose }: SidebarProps) {
  const pathname = usePathname();
  const { data: session } = useSession();
  const t = useTranslations("nav");
  const ent = useEntitlements();

  const isSchoolAdmin = pathname.startsWith("/school-admin");
  const isAdmin = pathname.startsWith("/admin");
  const isTeacher = pathname.startsWith("/teacher");

  const studentNavItems: NavItem[] = [
    { labelKey: "dashboard",   href: "/student",                icon: Home,          exact: true },
    { labelKey: "quiz",        href: "/student/quiz",           icon: BookOpen },
    { labelKey: "aiTutor",     href: "/student/tutor",          icon: MessageSquare },
    { labelKey: "battle",      href: "/student/battle",         icon: Swords },
    { labelKey: "leaderboard", href: "/student/leaderboard",    icon: Trophy },
    { labelKey: "rewards",     href: "/student/rewards",        icon: Gift },
    { labelKey: "notifications", href: "/student/notifications", icon: Bell },
    { labelKey: "profile",     href: "/student/profile",        icon: User },
    { labelKey: "myProgress",  href: "/student/progress",       icon: TrendingUp },
    { labelKey: "quizHistory", href: "/student/history",        icon: History },
    { labelKey: "billing",     href: "/student/billing",        icon: CreditCard },
    { labelKey: "settings",    href: "/student/settings",       icon: Settings },
  ].filter((item) => {
    if (item.labelKey === "aiTutor" && !(ent.ai && ent.aiFeatures.aiTutor)) return false;
    if (item.labelKey === "battle" && !ent.multiplayer) return false;
    if (item.labelKey === "rewards" && !ent.rewards) return false;
    if (item.labelKey === "leaderboard" && !ent.leaderboard) return false;
    if (item.labelKey === "billing" && !ent.pricingEnabled) return false;
    return true;
  });

  const superAdminNavItems: NavItem[] = [
    { labelKey: "dashboard",  href: "/admin",             icon: LayoutDashboard, exact: true },
    { labelKey: "schools",    href: "/admin/schools",      icon: Building2 },
    { labelKey: "students",   href: "/admin/students",     icon: Users },
    { labelKey: "textbooks",  href: "/admin/textbooks",    icon: Library },
    { labelKey: "subjects",   href: "/admin/subjects",     icon: BookMarked },
    { labelKey: "questions",  href: "/admin/questions",    icon: HelpCircle },
    { labelKey: "rewards",    href: "/admin/rewards",      icon: Gift },
    { labelKey: "pricing",    href: "/admin/pricing",      icon: CreditCard },
    { labelKey: "analytics",  href: "/admin/analytics",    icon: BarChart2 },
    { labelKey: "settings",   href: "/admin/settings",     icon: Settings },
  ];

  const schoolAdminNavItems: NavItem[] = [
    { labelKey: "dashboard",  href: "/school-admin",              icon: LayoutDashboard, exact: true },
    { labelKey: "students",   href: "/school-admin/students",     icon: Users },
    { labelKey: "textbooks",  href: "/school-admin/textbooks",    icon: Library },
    { labelKey: "subjects",   href: "/school-admin/subjects",     icon: BookMarked },
    { labelKey: "questions",  href: "/school-admin/questions",    icon: HelpCircle },
    { labelKey: "rewards",    href: "/school-admin/rewards",      icon: Gift },
    { labelKey: "analytics",  href: "/school-admin/analytics",    icon: BarChart2 },
    { labelKey: "settings",   href: "/school-admin/settings",     icon: Settings },
  ];

  const teacherNavItems: NavItem[] = [
    { labelKey: "dashboard",     href: "/teacher",              icon: Home, exact: true },
    { labelKey: "tugOfWar",      href: "/teacher/games/tug",    icon: Swords },
    { labelKey: "teacherCreate", href: "/teacher/games/create", icon: PencilRuler },
    { labelKey: "randomPicker",  href: "/teacher/games/picker", icon: Shuffle },
  ];

  let navItems: NavItem[] = studentNavItems;
  let sectionLabelKey = "sectionStudent";
  if (isSchoolAdmin) {
    navItems = schoolAdminNavItems;
    sectionLabelKey = "sectionSchoolAdmin";
  } else if (isAdmin) {
    navItems = superAdminNavItems;
    sectionLabelKey = "sectionAdmin";
  } else if (isTeacher) {
    navItems = teacherNavItems;
    sectionLabelKey = "sectionTeacher";
  }

  return (
    <>
      {/* Mobile overlay */}
      {isOpen && (
        <div className="fixed inset-0 z-30 bg-black/40 md:hidden" onClick={onClose} />
      )}

      <aside
        className={cn(
          "fixed left-0 top-16 z-30 h-[calc(100vh-4rem)] w-64 border-r border-border bg-surface transition-transform duration-200 md:translate-x-0",
          isOpen ? "translate-x-0" : "-translate-x-full",
        )}
      >
        <nav className="flex h-full flex-col gap-1 overflow-y-auto p-4 pb-6">
          <p className="mb-2 px-3 text-xs font-semibold uppercase tracking-wider text-text-muted">
            {t(sectionLabelKey as any)}
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
                {t(item.labelKey as any)}
              </Link>
            );
          })}
        </nav>
      </aside>
    </>
  );
}
