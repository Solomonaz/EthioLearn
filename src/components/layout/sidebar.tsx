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
  TrendingUp,
  BookMarked,
  Building2,
  ClipboardList,
  GraduationCap,
  CreditCard,
  PencilRuler,
  Shuffle,
  Grid3x3,
  Bot,
  Palette,
  Puzzle,
  LineChart,
  Boxes,
  Receipt,
  Coins,
  Cpu,
  Sparkles,
  PanelLeftClose,
  PanelLeftOpen,
  FileCheck2,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Logo } from "@/components/ui/logo";
import { ThemeToggle } from "@/components/ui/theme-toggle";
import { useEntitlements } from "@/hooks/use-entitlements";
import { lockedNavKeys, ProBadge } from "@/components/student/pro-promo";
import { FREE_PLAY_GAMES, type PlayGameKey } from "@/lib/games/play";

interface SidebarProps {
  isOpen: boolean;
  onClose?: () => void;
  /** Teacher surface only: icon-rail collapsed state (desktop). */
  collapsed?: boolean;
  onToggleCollapse?: () => void;
}

type NavItem = { labelKey: string; href: string; icon: typeof Home; exact?: boolean };

/** Bright per-item colours for the playful teacher sidebar (kid-friendly). */
const TEACHER_COLORS: Record<string, string> = {
  dashboard: "#1B5E20",
  tugOfWar: "#F43F5E",
  numberMemory: "#3B82F6",
  routing: "#06B6D4",
  findColor: "#EC4899",
  findPair: "#8B5CF6",
  teacherCreate: "#F59E0B",
  randomPicker: "#10B981",
  billing: "#F59E0B",
  settings: "#64748B",
};

const ELEMENTARY_SCHOOL_ADMIN_KEYS = new Set(["dashboard", "teachers", "subjects", "subscription"]);

export function Sidebar({ isOpen, onClose, collapsed = false, onToggleCollapse }: SidebarProps) {
  const pathname = usePathname();
  const t = useTranslations("nav");
  const ent = useEntitlements();
  // Paid features a free student could buy: listed with a "Pro" lock (their page
  // shows the upgrade screen) instead of hidden, so students know they exist.
  const lockedKeys = lockedNavKeys(ent);

  const isSchoolAdmin = pathname.startsWith("/school-admin");
  const isAdmin = pathname.startsWith("/admin");
  const isTeacher = pathname.startsWith("/teacher");
  // Grades 1-8 students' play area: the same playful chrome as the teacher.
  const isPlay = pathname === "/play" || pathname.startsWith("/play/");
  const playful = isTeacher || isPlay;
  // "/secondary-teacher" does not start with "/teacher", so the grades 1-8
  // playful teacher chrome below is correctly NOT applied to this surface.
  const isSecondaryTeacher = pathname.startsWith("/secondary-teacher");

  const studentNavItems: NavItem[] = [
    { labelKey: "dashboard",   href: "/student",                icon: Home,          exact: true },
    { labelKey: "quiz",        href: "/student/quiz",           icon: BookOpen },
    { labelKey: "nationalExam", href: "/student/national-exam", icon: FileCheck2 },
    { labelKey: "library",     href: "/student/library",        icon: Library },
    { labelKey: "myWork",      href: "/student/activities",     icon: ClipboardList },
    { labelKey: "grapher",     href: "/student/grapher",        icon: LineChart },
    { labelKey: "geometry",    href: "/student/geometry",       icon: Boxes },
    { labelKey: "aiTutor",     href: "/student/tutor",          icon: MessageSquare },
    { labelKey: "battle",      href: "/student/battle",         icon: Swords },
    { labelKey: "leaderboard", href: "/student/leaderboard",    icon: Trophy },
    { labelKey: "rewards",     href: "/student/rewards",        icon: Gift },
    { labelKey: "profile",     href: "/student/profile",        icon: User },
    { labelKey: "myProgress",  href: "/student/progress",       icon: TrendingUp },
    { labelKey: "quizHistory", href: "/student/history",        icon: History },
    { labelKey: "billing",     href: "/student/billing",        icon: CreditCard },
    { labelKey: "settings",    href: "/student/settings",       icon: Settings },
  ].filter((item) => {
    if (lockedKeys.has(item.labelKey)) return true;
    if (item.labelKey === "aiTutor" && !(ent.ai && ent.aiFeatures.aiTutor)) return false;
    if ((item.labelKey === "grapher" || item.labelKey === "geometry") && !ent.mathTools) return false;
    if (item.labelKey === "battle" && !ent.multiplayer) return false;
    if (item.labelKey === "rewards" && !ent.rewards) return false;
    if (item.labelKey === "leaderboard" && !ent.leaderboard) return false;
    if (item.labelKey === "billing" && !ent.pricingEnabled) return false;
    // Homework only comes from school teachers; self-registered students have none.
    if (item.labelKey === "myWork" && ent.isIndependent) return false;
    return true;
  });

  const superAdminNavItems: NavItem[] = [
    { labelKey: "dashboard",  href: "/admin",             icon: LayoutDashboard, exact: true },
    { labelKey: "schools",    href: "/admin/schools",      icon: Building2 },
    { labelKey: "students",   href: "/admin/students",     icon: Users },
    { labelKey: "teachers",   href: "/admin/teachers",     icon: GraduationCap },
    { labelKey: "textbooks",  href: "/admin/textbooks",    icon: Library },
    { labelKey: "subjects",   href: "/admin/subjects",     icon: BookMarked },
    { labelKey: "questions",  href: "/admin/questions",    icon: HelpCircle },
    { labelKey: "nationalExams", href: "/admin/national-exams", icon: FileCheck2 },
    { labelKey: "rewards",    href: "/admin/rewards",      icon: Gift },
    { labelKey: "pricing",    href: "/admin/pricing",      icon: CreditCard },
    { labelKey: "payments",   href: "/admin/payments",     icon: Receipt },
    { labelKey: "analytics",  href: "/admin/analytics",    icon: BarChart2 },
    { labelKey: "aiUsage",    href: "/admin/usage",        icon: Coins },
    { labelKey: "aiModels",   href: "/admin/ai-models",    icon: Cpu },
    { labelKey: "settings",   href: "/admin/settings",     icon: Settings },
  ];

  const schoolAdminNavItems: NavItem[] = [
    { labelKey: "dashboard",  href: "/school-admin",              icon: LayoutDashboard, exact: true },
    { labelKey: "students",   href: "/school-admin/students",     icon: Users },
    { labelKey: "teachers",   href: "/school-admin/teachers",     icon: GraduationCap },
    { labelKey: "textbooks",  href: "/school-admin/textbooks",    icon: Library },
    { labelKey: "subjects",   href: "/school-admin/subjects",     icon: BookMarked },
    { labelKey: "questions",  href: "/school-admin/questions",    icon: HelpCircle },
    { labelKey: "rewards",    href: "/school-admin/rewards",      icon: Gift },
    { labelKey: "analytics",  href: "/school-admin/analytics",    icon: BarChart2 },
    { labelKey: "subscription", href: "/school-admin/subscription", icon: CreditCard },
    { labelKey: "settings",   href: "/school-admin/settings",     icon: Settings },
  ].filter(
    // An elementary school has no students on the school side, so its admin
    // manages teachers, its subject list and the subscription only.
    (item) => ent.schoolLevel !== "ELEMENTARY" || ELEMENTARY_SCHOOL_ADMIN_KEYS.has(item.labelKey),
  );

  const teacherNavItems: NavItem[] = [
    { labelKey: "dashboard",     href: "/teacher",              icon: Home, exact: true },
    { labelKey: "tugOfWar",      href: "/teacher/games/tug",    icon: Swords },
    { labelKey: "numberMemory",  href: "/teacher/games/memory", icon: Grid3x3 },
    { labelKey: "routing",       href: "/teacher/games/routing", icon: Bot },
    { labelKey: "findColor",     href: "/teacher/games/find-color", icon: Palette },
    { labelKey: "findPair",      href: "/teacher/games/find-pair", icon: Puzzle },
    { labelKey: "teacherCreate", href: "/teacher/games/create", icon: PencilRuler },
    { labelKey: "randomPicker",  href: "/teacher/games/picker", icon: Shuffle },
  ];

  // A game's nav item, keyed for its colour, its href and its free/Pro status.
  const playGames: (NavItem & { game: PlayGameKey })[] = [
    { labelKey: "tugOfWar",     href: "/play/tug",        icon: Swords,  game: "tug" },
    { labelKey: "findPair",     href: "/play/find-pair",  icon: Puzzle,  game: "find-pair" },
    { labelKey: "routing",      href: "/play/routing",    icon: Bot,     game: "routing" },
    { labelKey: "numberMemory", href: "/play/memory",     icon: Grid3x3, game: "memory" },
    { labelKey: "findColor",    href: "/play/find-color", icon: Palette, game: "find-color" },
  ];
  const playNavItems: NavItem[] = [
    { labelKey: "dashboard", href: "/play", icon: Home, exact: true },
    ...playGames,
    { labelKey: "billing",   href: "/play/billing",  icon: CreditCard },
    { labelKey: "settings",  href: "/play/settings", icon: Settings },
  ].filter((item) => item.labelKey !== "billing" || (ent.pricingEnabled && ent.isIndependent));
  // Paid games show a Pro lock for a free account (the page offers the upgrade).
  const playLockedKeys = new Set(
    ent.loading || ent.games
      ? []
      : playGames.filter((g) => !FREE_PLAY_GAMES.has(g.game)).map((g) => g.labelKey),
  );

  const secondaryTeacherNavItems: NavItem[] = [
    { labelKey: "dashboard",  href: "/secondary-teacher",            icon: LayoutDashboard, exact: true },
    { labelKey: "myClasses",  href: "/secondary-teacher/classes",    icon: Users },
    { labelKey: "activities", href: "/secondary-teacher/activities", icon: ClipboardList },
    { labelKey: "assistant",   href: "/secondary-teacher/assistant",  icon: Sparkles },
    { labelKey: "myMaterials", href: "/secondary-teacher/resources",  icon: BookMarked },
    { labelKey: "grapher",    href: "/secondary-teacher/grapher",    icon: LineChart },
    { labelKey: "geometry",   href: "/secondary-teacher/geometry",   icon: Boxes },
    { labelKey: "profile",    href: "/secondary-teacher/profile",    icon: User },
  ];

  let navItems: NavItem[] = studentNavItems;
  let sectionLabelKey = "sectionStudent";
  if (isSchoolAdmin) {
    navItems = schoolAdminNavItems;
    sectionLabelKey = "sectionSchoolAdmin";
  } else if (isAdmin) {
    navItems = superAdminNavItems;
    sectionLabelKey = "sectionAdmin";
  } else if (isSecondaryTeacher) {
    navItems = secondaryTeacherNavItems;
    sectionLabelKey = "sectionSecondaryTeacher";
  } else if (isTeacher) {
    navItems = teacherNavItems;
    sectionLabelKey = "sectionTeacher";
  } else if (isPlay) {
    navItems = playNavItems;
    sectionLabelKey = "sectionPlay";
  }

  return (
    <>
      {/* Mobile overlay */}
      {isOpen && (
        <div className="fixed inset-0 z-30 bg-black/40 md:hidden" onClick={onClose} />
      )}

      <aside
        className={cn(
          "fixed z-30 transition-[transform,width] duration-200 md:translate-x-0",
          // The floating (playful) drawer sits 0.75rem in from the edge, so it
          // must slide that much further to hide completely.
          isOpen ? "translate-x-0" : playful ? "-translate-x-[calc(100%+1rem)]" : "-translate-x-full",
          // Collapsed rail only applies on desktop; the mobile drawer stays full width.
          collapsed ? "w-64 md:w-20" : "w-64",
          playful
            ? "bottom-3 left-3 top-3 rounded-3xl bg-surface shadow-xl ring-1 ring-border/60"
            : "left-0 top-16 h-[calc(100vh-4rem)] border-r border-border bg-surface",
        )}
      >
        {playful ? (
          <TeacherSidebar
            items={navItems}
            homeHref={isPlay ? "/play" : "/teacher"}
            lockedKeys={isPlay ? playLockedKeys : undefined}
            pathname={pathname}
            onClose={onClose}
            t={t}
            sectionLabelKey={sectionLabelKey}
            collapsed={collapsed}
            onToggleCollapse={onToggleCollapse}
          />
        ) : (
          <nav className="scrollbar-slim flex h-full flex-col gap-1 overflow-y-auto p-4 pb-6">
            {/* section label + collapse toggle (toggle is desktop-only) */}
            <div
              className={cn(
                "mb-2 flex items-center",
                collapsed ? "justify-between md:justify-center" : "justify-between",
              )}
            >
              <p
                className={cn(
                  "px-3 text-xs font-semibold uppercase tracking-wider text-text-muted",
                  collapsed && "md:hidden",
                )}
              >
                {t(sectionLabelKey as any)}
              </p>
              {onToggleCollapse && (
                <button
                  type="button"
                  onClick={onToggleCollapse}
                  aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
                  title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
                  className="hidden h-8 w-8 shrink-0 items-center justify-center rounded-lg text-text-muted transition-colors hover:bg-border/50 hover:text-text-primary md:inline-flex"
                >
                  {collapsed ? (
                    <PanelLeftOpen className="h-5 w-5" />
                  ) : (
                    <PanelLeftClose className="h-5 w-5" />
                  )}
                </button>
              )}
            </div>

            {navItems.map((item) => {
              const isActive = item.exact
                ? pathname === item.href
                : pathname === item.href || pathname.startsWith(item.href + "/");
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  onClick={onClose}
                  title={collapsed ? t(item.labelKey as any) : undefined}
                  className={cn(
                    "flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm transition-colors",
                    collapsed && "md:justify-center md:px-0",
                    isActive
                      ? "bg-primary/10 font-bold text-primary"
                      : "text-text-secondary hover:bg-border/50 hover:text-text-primary",
                  )}
                >
                  <item.icon className="h-5 w-5 shrink-0" />
                  <span className={cn(collapsed && "md:hidden")}>{t(item.labelKey as any)}</span>
                  {lockedKeys.has(item.labelKey) && (
                    <span className={cn("ml-auto", collapsed && "md:hidden")}>
                      <ProBadge />
                    </span>
                  )}
                </Link>
              );
            })}

            {/* Theme control lives here on phones, where the top bar has no
                room for it. Hidden from md up, where the navbar shows it. */}
            <div className="mt-auto flex items-center justify-between gap-3 border-t border-border pt-4 md:hidden">
              <span className="px-3 text-xs font-semibold uppercase tracking-wider text-text-muted">
                {t("theme" as any)}
              </span>
              <ThemeToggle />
            </div>
          </nav>
        )}
      </aside>
    </>
  );
}

/** Playful, colourful navigation: the teacher's, and grades 1-8 students'. */
function TeacherSidebar({
  items,
  homeHref,
  lockedKeys,
  pathname,
  onClose,
  t,
  sectionLabelKey,
  collapsed = false,
  onToggleCollapse,
}: {
  items: NavItem[];
  homeHref: string;
  /** Items to mark with a Pro lock. */
  lockedKeys?: Set<string>;
  pathname: string;
  onClose?: () => void;
  t: ReturnType<typeof useTranslations>;
  sectionLabelKey: string;
  collapsed?: boolean;
  onToggleCollapse?: () => void;
}) {
  // `collapsed` only takes effect on desktop (md+); the mobile drawer always
  // shows the full labels, so collapse styles are gated behind `md:`.
  return (
    <div className="flex h-full flex-col p-3">
      {/* Header: logo + collapse toggle */}
      <div
        className={cn(
          "mb-3 flex items-center gap-2 px-1 pt-1",
          collapsed ? "justify-between md:justify-center" : "justify-between",
        )}
      >
        <Link
          href={homeHref}
          onClick={onClose}
          className={cn("block", collapsed && "md:hidden")}
          aria-label="Abugida"
        >
          <Logo size="sm" />
        </Link>
        {onToggleCollapse && (
          <button
            type="button"
            onClick={onToggleCollapse}
            aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            className="hidden h-9 w-9 shrink-0 items-center justify-center rounded-xl text-text-muted transition-colors hover:bg-border/60 hover:text-text-primary md:inline-flex"
          >
            {collapsed ? (
              <PanelLeftOpen className="h-5 w-5" />
            ) : (
              <PanelLeftClose className="h-5 w-5" />
            )}
          </button>
        )}
      </div>

      <p
        className={cn(
          "mb-2 px-3 text-xs font-bold uppercase tracking-wider text-text-muted",
          collapsed && "md:hidden",
        )}
      >
        {t(sectionLabelKey as any)}
      </p>

      <nav className="scrollbar-slim flex flex-1 flex-col gap-1.5 overflow-y-auto pb-2 pr-1">
        {items.map((item) => {
          const isActive = item.exact
            ? pathname === item.href
            : pathname === item.href || pathname.startsWith(item.href + "/");
          const color = TEACHER_COLORS[item.labelKey] ?? "#1B5E20";
          return (
            <Link
              key={item.href}
              href={item.href}
              onClick={onClose}
              title={collapsed ? t(item.labelKey as any) : undefined}
              className={cn(
                "group flex items-center gap-3 rounded-2xl px-2.5 py-2.5 text-sm font-semibold shadow-sm transition-all",
                collapsed && "md:justify-center md:px-0",
                isActive
                  ? "bg-primary/10 text-primary ring-1 ring-inset ring-primary/25"
                  : "bg-surface text-text-primary hover:shadow-md",
              )}
            >
              <span
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl transition-transform group-hover:scale-105"
                style={
                  isActive
                    ? { backgroundColor: "var(--color-primary)" }
                    : { backgroundColor: `${color}1f`, color }
                }
              >
                <item.icon className={cn("h-[18px] w-[18px]", isActive && "text-white")} />
              </span>
              <span className={cn(collapsed && "md:hidden")}>{t(item.labelKey as any)}</span>
              {lockedKeys?.has(item.labelKey) && (
                <span className={cn("ml-auto", collapsed && "md:hidden")}>
                  <ProBadge />
                </span>
              )}
            </Link>
          );
        })}
      </nav>
    </div>
  );
}
