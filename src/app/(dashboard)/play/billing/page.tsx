"use client";

import { useTranslations } from "next-intl";
import { CreditCard, ShieldCheck } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { StudentBillingPanel } from "@/components/student/billing-panel";
import { useEntitlements } from "@/hooks/use-entitlements";
import { PlayTrialBanner } from "@/components/play/play-trial-banner";

/** Plans for a grades 1-8 student — the same student plans as grades 9-12. */
export default function PlayBillingPage() {
  const ent = useEntitlements();
  const t = useTranslations("play");

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div className="flex items-center gap-3">
        <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-primary/10">
          <CreditCard className="h-6 w-6 text-primary" />
        </div>
        <div>
          <h1 className="text-2xl font-bold text-text-primary">{t("plansTitle")}</h1>
          <p className="text-sm text-text-secondary">{t("plansSub")}</p>
        </div>
      </div>

      <PlayTrialBanner ent={ent} />

      {ent.isSchoolStudent ? (
        <Card>
          <CardContent className="flex items-start gap-3 py-6">
            <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-success" />
            <div>
              <p className="font-medium text-text-primary">{t("schoolManagedTitle")}</p>
              <p className="mt-1 text-sm text-text-secondary">{t("schoolManagedDesc")}</p>
            </div>
          </CardContent>
        </Card>
      ) : (
        <StudentBillingPanel elementary />
      )}
    </div>
  );
}
