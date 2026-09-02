"use client";

import dynamic from "next/dynamic";

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
  return (
    <div className="mx-auto max-w-6xl">
      <GeometryLab />
    </div>
  );
}
