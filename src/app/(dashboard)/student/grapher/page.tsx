"use client";

import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { LineChart } from "lucide-react";
import { GraphPlotter } from "@/components/student/grapher/graph-plotter";

function GrapherInner() {
  const params = useSearchParams();
  // Equations handed off from "My Note" (?eq=...&eq=...).
  const initial = params.getAll("eq").filter(Boolean);

  return (
    <div className="mx-auto max-w-6xl space-y-5">
      <div className="flex items-center gap-3">
        <div
          className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl text-white shadow-sm"
          style={{ backgroundImage: "linear-gradient(135deg,#1565C0,#42A5F5)" }}
        >
          <LineChart className="h-6 w-6" />
        </div>
        <div>
          <h1 className="text-2xl font-bold text-text-primary">Graphing Calculator</h1>
          <p className="text-sm text-text-secondary">
            Type an equation to see its 2D graph. Drag to pan, scroll to zoom.
          </p>
        </div>
      </div>

      <GraphPlotter initial={initial} />
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
