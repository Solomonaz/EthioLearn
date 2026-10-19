"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { Clock, Sparkles } from "lucide-react";
import type { EntitlementsInfo } from "@/hooks/use-entitlements";
import { PLAY_BILLING_HREF } from "@/lib/games/play";

const DAY_MS = 24 * 60 * 60 * 1000;
/** How long after a trial ends the "trial ended" note keeps showing. */
const TRIAL_ENDED_PROMPT_DAYS = 14;

/**
 * The play area's free-trial note: days left while the sign-up trial runs,
 * and for two weeks after it ends (when it took games away) an upgrade nudge.
 * The grades 9-12 banner (components/student/pro-promo) names features this
 * area doesn't have, so it isn't reused here.
 */
export function PlayTrialBanner({ ent }: { ent: EntitlementsInfo }) {
  const t = useTranslations("play");
  if (ent.loading || !ent.isIndependent || !ent.pricingEnabled || !ent.trialEndsAt) return null;

  const end = new Date(ent.trialEndsAt).getTime();
  const now = Date.now();

  if (ent.trialActive) {
    const days = Math.max(1, Math.ceil((end - now) / DAY_MS));
    return (
      <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-secondary/60 bg-secondary/15 px-4 py-3">
        <Clock className="h-5 w-5 shrink-0 text-secondary-dark" />
        <p className="min-w-0 flex-1 text-sm text-text-primary">
          <span className="font-semibold">{t("trialDaysLeft", { days })}</span> {t("trialAllGames")}
        </p>
        <Link href={PLAY_BILLING_HREF} className="text-sm font-semibold text-primary hover:underline">
          {t("seePlans")}
        </Link>
      </div>
    );
  }

  const since = now - end;
  if (!ent.games && since >= 0 && since < TRIAL_ENDED_PROMPT_DAYS * DAY_MS) {
    return (
      <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-secondary/60 bg-secondary/15 px-4 py-3">
        <Sparkles className="h-5 w-5 shrink-0 text-secondary-dark" />
        <p className="min-w-0 flex-1 text-sm text-text-primary">
          <span className="font-semibold">{t("trialEnded")}</span> {t("trialEndedDesc")}
        </p>
        <Link
          href={PLAY_BILLING_HREF}
          className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-white hover:bg-primary-dark"
        >
          {t("upgrade")}
        </Link>
      </div>
    );
  }

  return null;
}
