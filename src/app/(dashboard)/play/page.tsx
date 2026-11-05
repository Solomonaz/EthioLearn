"use client";

import Link from "next/link";
import { useSession } from "next-auth/react";
import { useTranslations } from "next-intl";
import { ArrowRight, Bot, Grid3x3, Lock, Palette, Puzzle, Swords, type LucideIcon } from "lucide-react";
import { useSound } from "@/hooks/use-sound";
import { useEntitlements } from "@/hooks/use-entitlements";
import { canPlayGame, type PlayGameKey } from "@/lib/games/play";
import { PlayTrialBanner } from "@/components/play/play-trial-banner";

const GRAD = {
  green: "linear-gradient(135deg,#1B5E20,#43A047)",
  blue: "linear-gradient(135deg,#2563EB,#60A5FA)",
  teal: "linear-gradient(135deg,#0891B2,#22D3EE)",
  rose: "linear-gradient(135deg,#E11D48,#FB7185)",
  violet: "linear-gradient(135deg,#7C3AED,#A78BFA)",
} as const;

/**
 * Play area home for grades 1-8 students: a playful hub of the games, each
 * playable on the child's own device — alone, against the computer, or with a
 * friend sharing the screen.
 */
export default function PlayHomePage() {
  const { data: session } = useSession();
  const t = useTranslations("play");
  const nav = useTranslations("nav");
  const g = useTranslations("games");
  const { playSfx } = useSound();
  const ent = useEntitlements();

  const user = session?.user as { name?: string | null; grade?: number | null } | undefined;
  const firstName = (user?.name ?? "").trim().split(/\s+/)[0] ?? "";

  const tiles: {
    game: PlayGameKey;
    href: string;
    icon: LucideIcon;
    name: string;
    desc: string;
    how: string;
    emoji: string;
    grad: string;
  }[] = [
    { game: "tug", href: "/play/tug", icon: Swords, name: nav("tugOfWar"), desc: t("tugDesc"), how: t("howCpuOrFriend"), emoji: "💪", grad: GRAD.green },
    { game: "find-pair", href: "/play/find-pair", icon: Puzzle, name: nav("findPair"), desc: g("fpSubtitle"), how: t("howAlone"), emoji: "🧩", grad: GRAD.violet },
    { game: "routing", href: "/play/routing", icon: Bot, name: nav("routing"), desc: g("routeSub"), how: t("howAloneOrFriend"), emoji: "🤖", grad: GRAD.teal },
    { game: "memory", href: "/play/memory", icon: Grid3x3, name: nav("numberMemory"), desc: g("numWatchSub"), how: t("howAlone"), emoji: "🧠", grad: GRAD.blue },
    { game: "find-color", href: "/play/find-color", icon: Palette, name: nav("findColor"), desc: g("colorSub"), how: t("howAlone"), emoji: "🎨", grad: GRAD.rose },
  ];

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      {/* ── Hero ─────────────────────────────────────────── */}
      <div
        className="relative overflow-hidden rounded-3xl p-6 shadow-md sm:p-8"
        style={{ backgroundImage: GRAD.green }}
      >
        <div className="pointer-events-none absolute -right-10 -top-10 h-44 w-44 rounded-full bg-white/10" />
        <div className="pointer-events-none absolute -bottom-16 right-24 h-40 w-40 rounded-full bg-black/10" />
        <div className="pointer-events-none absolute right-10 top-8 hidden select-none text-4xl sm:block">🎈</div>
        <div className="relative">
          {user?.grade ? (
            <span className="inline-flex items-center rounded-full bg-white/15 px-3 py-1 text-xs font-bold text-white ring-1 ring-inset ring-white/25">
              {t("gradeBadge", { grade: user.grade })}
            </span>
          ) : null}
          <h1 className="mt-3 text-2xl font-extrabold leading-tight text-white sm:text-4xl">
            {firstName ? t("greeting", { name: firstName }) : t("greetingNoName")} <span className="inline-block">🎉</span>
          </h1>
          <p className="mt-2 max-w-xl text-base font-medium text-white/85">{t("heroLine")}</p>
          <Link
            href="/play/tug"
            onClick={() => playSfx("click")}
            className="mt-5 inline-flex items-center gap-2 rounded-full bg-secondary-dark px-5 py-2.5 text-sm font-bold text-white shadow-sm transition hover:brightness-105 active:scale-95"
          >
            <Swords className="h-4 w-4" /> {t("startTug")}
          </Link>
        </div>
      </div>

      <PlayTrialBanner ent={ent} />

      {/* ── Games ────────────────────────────────────────── */}
      <section>
        <h2 className="mb-3 flex items-center gap-2 text-lg font-extrabold text-text-primary">
          <span className="text-xl">🎮</span> {t("gamesHeading")}
        </h2>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {tiles.map((tile) => {
            const locked = !ent.loading && !canPlayGame(tile.game, ent);
            return (
              <Link
                key={tile.href}
                href={tile.href}
                onClick={() => playSfx("click")}
                style={{ backgroundImage: tile.grad }}
                className="group relative flex flex-col overflow-hidden rounded-3xl p-5 shadow-md transition-all duration-200 hover:-translate-y-1 hover:shadow-xl focus:outline-none focus-visible:ring-4 focus-visible:ring-primary/30"
              >
                <div className="pointer-events-none absolute -right-6 -top-6 h-24 w-24 rounded-full bg-white/15 transition-transform duration-300 group-hover:scale-125" />
                <div className="pointer-events-none absolute -bottom-8 -left-4 h-20 w-20 rounded-full bg-black/10" />
                <div className="relative flex items-center gap-3">
                  <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-white/25 backdrop-blur-sm">
                    <tile.icon className="h-6 w-6 text-white" />
                  </div>
                  <span className="text-2xl" aria-hidden>
                    {tile.emoji}
                  </span>
                  {locked && (
                    <span className="ml-auto inline-flex items-center gap-1 rounded-full bg-white/90 px-2.5 py-1 text-[11px] font-extrabold uppercase tracking-wide text-text-primary">
                      <Lock className="h-3 w-3" /> Pro
                    </span>
                  )}
                </div>
                <h3 className="relative mt-3 text-lg font-extrabold text-white">{tile.name}</h3>
                <p className="relative mt-1 line-clamp-2 text-sm font-medium text-white/85">{tile.desc}</p>
                <p className="relative mt-2 text-xs font-bold text-white/90">{tile.how}</p>
                <span className="relative mt-4 inline-flex items-center gap-1 text-sm font-bold text-white">
                  {g("play")}
                  <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-1" />
                </span>
              </Link>
            );
          })}
        </div>
      </section>
    </div>
  );
}
