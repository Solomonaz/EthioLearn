"use client";

import Link from "next/link";
import { useSession } from "next-auth/react";
import { useTranslations } from "next-intl";
import { Menu } from "lucide-react";
import { Avatar } from "@/components/ui/avatar";
import { ThemeToggle } from "@/components/ui/theme-toggle";
import { LanguageSwitcher } from "@/components/ui/language-switcher";
import { NotificationBell } from "@/components/ui/notification-bell";
import { SoundToggle } from "@/components/audio/sound-toggle";

/**
 * Top row for the grades 1-8 play area — the teacher top bar's look without
 * its question-set search (students have no saved sets). The avatar opens
 * the student's settings.
 */
export function PlayTopBar({ onMenuToggle }: { onMenuToggle?: () => void }) {
  const { data: session } = useSession();
  const t = useTranslations("play");

  return (
    <div className="mb-5 flex items-center gap-2.5">
      <button
        onClick={onMenuToggle}
        aria-label="Menu"
        className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-surface text-text-secondary shadow-sm ring-1 ring-border md:hidden"
      >
        <Menu className="h-5 w-5" />
      </button>

      <div className="ml-auto flex shrink-0 items-center gap-2">
        <span className="inline-flex rounded-2xl bg-surface p-1 shadow-sm ring-1 ring-border">
          <SoundToggle />
        </span>
        <span className="hidden rounded-2xl bg-surface p-1 shadow-sm ring-1 ring-border sm:inline-flex">
          <ThemeToggle />
        </span>
        <span className="hidden rounded-2xl bg-surface p-1 shadow-sm ring-1 ring-border sm:inline-flex">
          <LanguageSwitcher />
        </span>
        <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-surface shadow-sm ring-1 ring-border">
          <NotificationBell />
        </span>
        <Link
          href="/play/settings"
          title={t("settingsTitle")}
          aria-label={t("settingsTitle")}
          className="grid h-11 w-11 place-items-center rounded-2xl bg-surface shadow-sm ring-1 ring-border transition hover:ring-primary/40 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
        >
          <Avatar name={session?.user?.name || "Student"} src={session?.user?.image} size="sm" />
        </Link>
      </div>
    </div>
  );
}
