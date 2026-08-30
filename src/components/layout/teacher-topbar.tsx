"use client";

import { Suspense, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useSession } from "next-auth/react";
import { useTranslations } from "next-intl";
import { useRouter, useSearchParams } from "next/navigation";
import { Search, Menu, X } from "lucide-react";
import { Avatar } from "@/components/ui/avatar";
import { ThemeToggle } from "@/components/ui/theme-toggle";
import { LanguageSwitcher } from "@/components/ui/language-switcher";
import { NotificationBell } from "@/components/ui/notification-bell";
import { SoundToggle } from "@/components/audio/sound-toggle";

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

      {/* useSearchParams must sit under a Suspense boundary (Next app router). */}
      <Suspense fallback={<SearchFieldFallback />}>
        <SearchField />
      </Suspense>

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
          href="/teacher/profile"
          title={t("profileTitle")}
          aria-label={t("profileTitle")}
          className="grid h-11 w-11 place-items-center rounded-2xl bg-surface shadow-sm ring-1 ring-border transition hover:ring-primary/40 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
        >
          <Avatar name={session?.user?.name || "Teacher"} src={session?.user?.image} size="sm" />
        </Link>
      </div>
    </div>
  );
}

const FIELD_CLASS =
  "w-full rounded-2xl border border-border bg-surface py-3 pl-11 pr-10 text-sm text-text-primary shadow-sm outline-none transition placeholder:text-text-muted focus:border-primary focus:ring-2 focus:ring-primary/20 [&::-webkit-search-cancel-button]:hidden";

/** Non-interactive placeholder shown while the Suspense boundary resolves. */
function SearchFieldFallback() {
  const t = useTranslations("teacher");
  return (
    <div className="relative min-w-0 max-w-xl flex-1">
      <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-text-muted" />
      <input type="search" disabled placeholder={t("searchPlaceholder")} className={FIELD_CLASS} />
    </div>
  );
}

/**
 * Controlled search field kept in sync with the `?q=` URL param. Typing routes
 * to the teacher dashboard (debounced), where the results are rendered.
 */
function SearchField() {
  const t = useTranslations("teacher");
  const router = useRouter();
  const searchParams = useSearchParams();

  const urlQuery = searchParams.get("q") ?? "";
  const [query, setQuery] = useState(urlQuery);

  // Reflect external URL changes (e.g. clearing results from the dashboard).
  useEffect(() => {
    setQuery(urlQuery);
  }, [urlQuery]);

  // Debounce navigation so we don't push a route on every keystroke.
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (query === urlQuery) return;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      const q = query.trim();
      router.replace(q ? `/teacher?q=${encodeURIComponent(q)}` : "/teacher");
    }, 250);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query]);

  const clear = () => {
    setQuery("");
    router.replace("/teacher");
  };

  return (
    <div className="relative min-w-0 max-w-xl flex-1">
      <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-text-muted" />
      <input
        type="search"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            const q = query.trim();
            router.replace(q ? `/teacher?q=${encodeURIComponent(q)}` : "/teacher");
          }
          if (e.key === "Escape") clear();
        }}
        placeholder={t("searchPlaceholder")}
        aria-label={t("searchPlaceholder")}
        className={FIELD_CLASS}
      />
      {query && (
        <button
          type="button"
          onClick={clear}
          aria-label={t("searchClear")}
          className="absolute right-3 top-1/2 flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded-full text-text-muted transition hover:bg-border/60 hover:text-text-primary"
        >
          <X className="h-4 w-4" />
        </button>
      )}
    </div>
  );
}
