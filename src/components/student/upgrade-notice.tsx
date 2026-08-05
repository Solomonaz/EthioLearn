"use client";

import Link from "next/link";
import { Lock } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";

/**
 * Shown when a student's plan doesn't include a feature. Points them to the
 * Settings page where independent students can switch to a full-access plan.
 */
export function UpgradeNotice({
  feature,
  planName,
  description,
}: {
  feature: string;
  planName?: string | null;
  description?: string;
}) {
  return (
    <div className="mx-auto flex min-h-[50vh] max-w-lg items-center p-4">
      <Card className="w-full">
        <CardContent className="flex flex-col items-center gap-3 py-10 text-center">
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-primary/10">
            <Lock className="h-6 w-6 text-primary" />
          </div>
          <h2 className="text-lg font-semibold text-text-primary">
            {feature} isn’t in your plan
          </h2>
          <p className="text-sm text-text-secondary">
            {description ??
              `${planName ? `Your current plan (${planName})` : "Your current plan"} doesn’t include ${feature.toLowerCase()}.`}{" "}
            Upgrade to a full-access plan to unlock it.
          </p>
          <Link
            href="/student/settings"
            className="mt-1 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-white hover:bg-primary-dark"
          >
            View plans
          </Link>
        </CardContent>
      </Card>
    </div>
  );
}
