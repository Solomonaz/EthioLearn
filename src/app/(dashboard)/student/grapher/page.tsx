"use client";

import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { GrapherApp } from "@/components/student/grapher/grapher-app";

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
  return (
    <Suspense fallback={<div />}>
      <GrapherInner />
    </Suspense>
  );
}
