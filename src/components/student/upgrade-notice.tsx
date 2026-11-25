"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { Lock, Check, Building2, PowerOff } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { useEntitlements } from "@/hooks/use-entitlements";
import { PRO_FEATURES } from "@/components/student/pro-promo";
import type { FeatureKey } from "@/lib/features";

/**
 * Shown when the user may not use a feature. Three cases:
 *   • switched off platform-wide → "turned off for now" (nothing to buy);
 *   • access comes from a school plan → "ask your school" (nothing to buy);
 *   • otherwise → what the feature does, everything Pro includes, the plans page.
 */
export function UpgradeNotice({
  feature,
  planName,
  description,
}: {
  feature: FeatureKey;
  planName?: string | null;
  description?: string;
}) {
  const t = useTranslations("features");
  const ent = useEntitlements();
  const name = t(`names.${feature}`);
  const pitch = description ?? (t.has(`pitch.${feature}`) ? t(`pitch.${feature}`) : null);

  if (!ent.loading && !ent.available[feature]) {
    return (
      <Notice icon={PowerOff} title={t("offTitle", { feature: name })}>
        <p className="text-sm text-text-secondary">{t("offDesc")}</p>
      </Notice>
    );
  }

  if (ent.viaSchool) {
    return (
      <Notice icon={Building2} title={t("schoolTitle", { feature: name })}>
        {pitch && <p className="text-sm text-text-secondary">{pitch}</p>}
        <p className="text-xs text-text-muted">{t("schoolDesc")}</p>
      </Notice>
    );
  }

  const trialEnded = !!ent.trialEndsAt && !ent.trialActive;
  return (
    <Notice icon={Lock} title={t("lockedTitle", { feature: name })}>
      {pitch && <p className="text-sm text-text-secondary">{pitch}</p>}
      <p className="text-xs text-text-muted">
        {trialEnded ? t("trialEnded") : planName ? t("planLacks", { plan: planName }) : t("planLacksNoName")}
      </p>

      <div className="mt-2 w-full rounded-lg bg-background p-4 text-left">
        <p className="text-sm font-semibold text-text-primary">{t("proIncludes")}</p>
        <ul className="mt-2 space-y-1.5">
          {PRO_FEATURES.map((f) => (
            <li key={f.key} className="flex items-start gap-2 text-sm text-text-secondary">
              <Check className="mt-0.5 h-4 w-4 shrink-0 text-success" />
              <span>
                <span className="font-medium text-text-primary">{f.title}</span> — {f.desc}
              </span>
            </li>
          ))}
        </ul>
      </div>

      <Link
        href="/student/billing"
        className="mt-1 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-white hover:bg-primary-dark"
      >
        {t("viewPlans")}
      </Link>
    </Notice>
  );
}

function Notice({
  icon: Icon,
  title,
  children,
}: {
  icon: typeof Lock;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="mx-auto flex min-h-[50vh] max-w-lg items-center p-4">
      <Card className="w-full">
        <CardContent className="flex flex-col items-center gap-3 py-10 text-center">
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-primary/10">
            <Icon className="h-6 w-6 text-primary" />
          </div>
          <h2 className="text-lg font-semibold text-text-primary">{title}</h2>
          {children}
        </CardContent>
      </Card>
    </div>
  );
}
