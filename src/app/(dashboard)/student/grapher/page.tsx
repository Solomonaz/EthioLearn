"use client";

import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { GrapherApp } from "@/components/student/grapher/grapher-app";
import { UpgradeNotice } from "@/components/student/upgrade-notice";
import { useEntitlements } from "@/hooks/use-entitlements";

function GrapherInner() {
  const params = useSearchParams();
  const initial = params.getAll("eq").filter(Boolean);

  return (
    <div className="mx-auto max-w-6xl">
      <GrapherApp initial={initial} />
    </div>
  );
}

export default function GrapherPage() {
  const ent = useEntitlements();

  // Plan gating — graphing requires a plan that includes the math tools.
  if (!ent.loading && !ent.mathTools) {
    return <UpgradeNotice feature="Graphing" planName={ent.planName} />;
  }

  return (
    <Suspense fallback={<div />}>
      <GrapherInner />
    </Suspense>
  );
}
