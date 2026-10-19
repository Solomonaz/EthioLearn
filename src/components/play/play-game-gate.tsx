"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { Lock, Sparkles } from "lucide-react";
import { useEntitlements, type EntitlementsInfo } from "@/hooks/use-entitlements";
import { canPlayGame, PLAY_BILLING_HREF, type PlayGameKey } from "@/lib/games/play";

/**
 * Wraps a game in the play area. A game outside the student's plan shows an
 * upgrade card instead (the free games always play). Children are a render
 * function so the game can read the entitlements (e.g. whether AI questions
 * are included) without fetching them again.
 */
export function PlayGameGate({
  game,
  children,
}: {
  game: PlayGameKey;
  children: (ent: EntitlementsInfo) => React.ReactNode;
}) {
  const ent = useEntitlements();
  const t = useTranslations("play");

  // The hook optimistically reports full access while loading; wait for the
  // real answer so a free account never glimpses a game and loses it.
  if (ent.loading) {
    return (
      <div className="flex justify-center py-24">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
      </div>
    );
  }

  if (!canPlayGame(game, ent)) {
    return (
      <div className="mx-auto flex max-w-md flex-col items-center gap-4 rounded-3xl border border-border bg-surface px-6 py-12 text-center shadow-sm">
        <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-secondary/20 text-secondary-dark">
          <Lock className="h-8 w-8" />
        </div>
        <div>
          <h1 className="text-xl font-extrabold text-text-primary">{t("lockedTitle")}</h1>
          <p className="mt-1 text-text-secondary">{t("lockedDesc")}</p>
        </div>
        {ent.isIndependent && ent.pricingEnabled && (
          <Link
            href={PLAY_BILLING_HREF}
            className="inline-flex items-center gap-2 rounded-full bg-primary px-5 py-2.5 text-sm font-bold text-white shadow-sm transition hover:bg-primary-dark"
          >
            <Sparkles className="h-4 w-4" /> {t("seePlans")}
          </Link>
        )}
        <Link href="/play" className="text-sm font-semibold text-text-secondary hover:text-primary">
          {t("backHome")}
        </Link>
      </div>
    );
  }

  return <>{children(ent)}</>;
}
