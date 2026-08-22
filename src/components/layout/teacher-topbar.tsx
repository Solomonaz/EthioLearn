"use client";

import { useSession } from "next-auth/react";
import { useTranslations } from "next-intl";
import { Search, Menu } from "lucide-react";
import { Avatar } from "@/components/ui/avatar";
import { ThemeToggle } from "@/components/ui/theme-toggle";
import { LanguageSwitcher } from "@/components/ui/language-switcher";
import { NotificationBell } from "@/components/ui/notification-bell";

/**
 * Floating top row for the teacher surface — a search field plus theme,
 * language, notifications and the avatar as rounded "pills". Replaces the
 * shared top navbar for teachers only (the navbar stays for every other role).
 */
export function TeacherTopBar({ onMenuToggle }: { onMenuToggle?: () => void }) {
  const { data: session } = useSession();
  const t = useTranslations("teacher");

  return (
    <div className="mb-5 flex items-center gap-2.5">
      <button
        onClick={onMenuToggle}
        aria-label="Menu"
        className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-surface text-text-secondary shadow-sm ring-1 ring-border md:hidden"
      >
        <Menu className="h-5 w-5" />
      </button>

      <div className="relative min-w-0 max-w-xl flex-1">
        <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-text-muted" />
        <input
          type="search"
          placeholder={t("searchPlaceholder")}
          className="w-full rounded-2xl border border-border bg-surface py-3 pl-11 pr-4 text-sm text-text-primary shadow-sm outline-none transition placeholder:text-text-muted focus:border-primary focus:ring-2 focus:ring-primary/20"
        />
      </div>

      <div className="ml-auto flex shrink-0 items-center gap-2">
        <span className="hidden rounded-2xl bg-surface p-1 shadow-sm ring-1 ring-border sm:inline-flex">
          <ThemeToggle />
        </span>
        <span className="hidden rounded-2xl bg-surface p-1 shadow-sm ring-1 ring-border sm:inline-flex">
          <LanguageSwitcher />
        </span>
        <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-surface shadow-sm ring-1 ring-border">
          <NotificationBell />
        </span>
        <span className="grid h-11 w-11 place-items-center rounded-2xl bg-surface shadow-sm ring-1 ring-border">
          <Avatar name={session?.user?.name || "Teacher"} src={session?.user?.image} size="sm" />
        </span>
      </div>
    </div>
  );
}
