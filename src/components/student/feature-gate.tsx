"use client";

import { useEntitlements } from "@/hooks/use-entitlements";
import { UpgradeNotice } from "@/components/student/upgrade-notice";
import type { FeatureKey } from "@/lib/features";

/**
 * Wraps a page (usually from its layout) so a user whose plan leaves the
 * feature out sees the locked screen instead. UX only — the page's API routes
 * refuse on their own (featureDenial).
 */
export function FeatureGate({ feature, children }: { feature: FeatureKey; children: React.ReactNode }) {
  const ent = useEntitlements();
  if (!ent.loading && !ent.features[feature]) {
    return <UpgradeNotice feature={feature} planName={ent.planName} />;
  }
  return <>{children}</>;
}
