"use client";

import dynamic from "next/dynamic";
import { UpgradeNotice } from "@/components/student/upgrade-notice";
import { useEntitlements } from "@/hooks/use-entitlements";

// WebGL/three.js is client-only — load it without SSR.
const GeometryLab = dynamic(
  () => import("@/components/student/geometry/geometry-lab").then((m) => m.GeometryLab),
  {
    ssr: false,
    loading: () => (
      <div className="h-[80vh] min-h-[520px] w-full animate-pulse rounded-2xl border border-border bg-surface" />
    ),
  },
);

export default function GeometryPage() {
  const ent = useEntitlements();

  // Plan gating — the 3D geometry lab requires a plan that includes the math tools.
  if (!ent.loading && !ent.mathTools) {
    return <UpgradeNotice feature="3D Geometry" planName={ent.planName} />;
  }

  return (
    <div className="mx-auto max-w-6xl">
      <GeometryLab />
    </div>
  );
}
