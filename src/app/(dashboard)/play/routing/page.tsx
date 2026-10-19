"use client";

import { RoutingAlgorithm } from "@/components/teacher/routing-algorithm/routing-algorithm";
import { PlayGameGate } from "@/components/play/play-game-gate";

/** Routing Robot for a grades 1-8 student: solo, or two players on this device. */
export default function PlayRoutingPage() {
  return (
    <PlayGameGate game="routing">
      {() => (
        <div className="mx-auto h-[calc(100dvh-8rem)] max-w-6xl">
          <RoutingAlgorithm />
        </div>
      )}
    </PlayGameGate>
  );
}
