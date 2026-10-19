"use client";

import { useEffect, useState, useTransition } from "react";
import Link from "next/link";
import { useLocale } from "next-intl";
import { useSession } from "next-auth/react";
import { ArrowRight, Menu, Moon, Sun, X } from "lucide-react";
import { useTheme } from "@/components/providers/theme-provider";
import { Logo } from "@/components/ui/logo";
import { homeRouteForRole } from "@/lib/teacher-band";
import { cn } from "@/lib/utils";

export type LandingNavLink = { href: string; label: string };

type Props = {
  links: LandingNavLink[];
  signIn: string;
  getStarted: string;
  appName: string;
  menuLabel: string;
};

/**
 * Landing-page top bar. Transparent over the hero, then settles onto a solid
 * surface with a hairline once the page scrolls. Below `lg` the section links,
 * language and theme controls move into a drop-down panel.
 */
export function LandingNav({ links, signIn, getStarted, appName, menuLabel }: Props) {
  const [scrolled, setScrolled] = useState(false);
  const [open, setOpen] = useState(false);

  // Signed-in users never see the landing page — proxy.ts redirects them. But
  // Back from a dashboard can show a cached copy that never reached the proxy
  // (HTTP cache or back/forward cache), so check on the client too.
  const { data: session, status } = useSession();
  useEffect(() => {
    if (status === "authenticated") {
      const u = session?.user as { role?: string; grade?: number | null } | undefined;
      window.location.replace(homeRouteForRole(u?.role, u?.grade));
    }
  }, [status, session]);

  // A back/forward-cache restore keeps the old (signed-out) session state, so
  // ask the server afresh.
  useEffect(() => {
    const onPageShow = async (e: PageTransitionEvent) => {
      if (!e.persisted) return;
      try {
        const res = await fetch("/api/auth/session", { cache: "no-store" });
        const data = await res.json();
        if (data?.user) window.location.replace(homeRouteForRole(data.user.role, data.user.grade));
      } catch {
        /* offline: stay on the landing page */
      }
    };
    window.addEventListener("pageshow", onPageShow);
    return () => window.removeEventListener("pageshow", onPageShow);
  }, []);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  // Close the mobile panel on Escape, and whenever the viewport grows past lg.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    const mq = window.matchMedia("(min-width: 1024px)");
    const onMq = () => mq.matches && setOpen(false);
    window.addEventListener("keydown", onKey);
    mq.addEventListener("change", onMq);
    return () => {
      window.removeEventListener("keydown", onKey);
      mq.removeEventListener("change", onMq);
    };
  }, [open]);

  const solid = scrolled || open;

  return (
    <header
      className={cn(
        "sticky top-0 z-50 transition-[background-color,border-color,box-shadow] duration-300",
        solid
          ? "border-b border-[var(--lp-rule)] bg-[var(--lp-bg)]/90 shadow-[0_8px_24px_-18px_rgba(19,32,26,0.35)] backdrop-blur-md"
          : "border-b border-transparent",
      )}
    >
      <div
        className={cn(
          "mx-auto flex max-w-6xl items-center gap-4 px-4 transition-[padding] duration-300 sm:px-6",
          scrolled ? "py-2.5" : "py-4",
        )}
      >
        <Link href="/" aria-label={appName} className="shrink-0">
          <span className="dark:hidden"><Logo size="md" /></span>
          <span className="hidden dark:block"><Logo size="md" onDark /></span>
        </Link>

        {/* Section links */}
        <nav aria-label="Sections" className="mx-auto hidden lg:block">
          <ul className="flex items-center gap-1 rounded-full border border-[var(--lp-rule)] bg-[var(--lp-surface)]/70 p-1">
            {links.map((l) => (
              <li key={l.href}>
                <a
                  href={l.href}
                  className="block whitespace-nowrap rounded-full px-3.5 py-1.5 text-sm font-medium text-[var(--lp-muted)] transition-colors hover:bg-[var(--lp-sunk)] hover:text-[var(--lp-ink)]"
                >
                  {l.label}
                </a>
              </li>
            ))}
          </ul>
        </nav>

        {/* Right cluster */}
        <div className="ml-auto flex items-center gap-2 lg:ml-0">
          <div className="hidden items-center gap-1 lg:flex">
            <LocaleToggle />
            <ThemeButton />
          </div>
          <span aria-hidden className="mx-1 hidden h-5 w-px bg-[var(--lp-rule)] lg:block" />
          <Link
            href="/login"
            className="hidden whitespace-nowrap rounded-full px-3 py-2 text-sm font-semibold text-[var(--lp-ink)] transition-colors hover:bg-[var(--lp-sunk)] lg:block"
          >
            {signIn}
          </Link>
          <Link
            href="/register"
            className="group inline-flex items-center gap-1.5 whitespace-nowrap rounded-full bg-[var(--lp-green)] px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-[#0d3b12]"
          >
            {getStarted}
            <ArrowRight className="hidden h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5 sm:block" />
          </Link>
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            aria-expanded={open}
            aria-controls="lp-mobile-menu"
            aria-label={menuLabel}
            className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-[var(--lp-rule)] text-[var(--lp-ink)] lg:hidden"
          >
            {open ? <X className="h-4 w-4" /> : <Menu className="h-4 w-4" />}
          </button>
        </div>
      </div>

      {/* Mobile panel */}
      {open && (
        <div id="lp-mobile-menu" className="border-t border-[var(--lp-rule)] px-4 pb-5 pt-2 sm:px-6 lg:hidden">
          <ul className="divide-y divide-[var(--lp-rule)]">
            {links.map((l) => (
              <li key={l.href}>
                <a
                  href={l.href}
                  onClick={() => setOpen(false)}
                  className="flex items-center justify-between py-3.5 text-base font-medium"
                >
                  {l.label}
                  <ArrowRight className="h-4 w-4 text-[var(--lp-faint)]" />
                </a>
              </li>
            ))}
          </ul>
          <div className="mt-4 flex items-center justify-between gap-3">
            <div className="flex items-center gap-1">
              <LocaleToggle />
              <ThemeButton />
            </div>
            <Link
              href="/login"
              className="rounded-full border border-[var(--lp-rule)] px-5 py-2 text-sm font-semibold"
            >
              {signIn}
            </Link>
          </div>
        </div>
      )}
    </header>
  );
}

/** Two-state EN / አማ switch, styled for the landing palette. */
function LocaleToggle() {
  const active = useLocale() === "am" ? "am" : "en";
  const [pending, startTransition] = useTransition();

  const switchTo = (locale: "en" | "am") => {
    if (locale === active) return;
    startTransition(async () => {
      await fetch("/api/locale", { method: "POST", body: JSON.stringify({ locale }) });
      window.location.reload();
    });
  };

  return (
    <div
      role="group"
      aria-label="Language"
      className="flex items-center rounded-full border border-[var(--lp-rule)] p-0.5 text-xs font-semibold"
    >
      {(["en", "am"] as const).map((l) => (
        <button
          key={l}
          type="button"
          onClick={() => switchTo(l)}
          disabled={pending}
          aria-pressed={active === l}
          className={cn(
            "rounded-full px-2.5 py-1 transition-colors",
            active === l
              ? "bg-[var(--lp-ink)] text-[var(--lp-bg)]"
              : "text-[var(--lp-muted)] hover:text-[var(--lp-ink)]",
          )}
        >
          {l === "en" ? "EN" : "አማ"}
        </button>
      ))}
    </div>
  );
}

/** Single light/dark switch — the full three-way control lives in settings. */
function ThemeButton() {
  const { resolvedTheme, setTheme } = useTheme();
  const isDark = resolvedTheme === "dark";
  return (
    <button
      type="button"
      onClick={() => setTheme(isDark ? "light" : "dark")}
      aria-label={isDark ? "Switch to light mode" : "Switch to dark mode"}
      title={isDark ? "Light mode" : "Dark mode"}
      className="inline-flex h-8 w-8 items-center justify-center rounded-full text-[var(--lp-muted)] transition-colors hover:bg-[var(--lp-sunk)] hover:text-[var(--lp-ink)]"
    >
      {isDark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
    </button>
  );
}
