"use client";

import { RoutingAlgorithm } from "@/components/teacher/routing-algorithm/routing-algorithm";

/** Routing Algorithm — drive the robot to the star; solo or two-player race. */
export default function RoutingAlgorithmPage() {
  return (
    <div className="mx-auto h-[calc(100vh-8rem)] max-w-6xl">
      <RoutingAlgorithm />
    </div>
  );
}
