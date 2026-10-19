"use client";

import { NumberMemory } from "@/components/teacher/number-memory/number-memory";
import { PlayGameGate } from "@/components/play/play-game-gate";

/** Number Memory for a grades 1-8 student (a free game). */
export default function PlayMemoryPage() {
  return (
    <PlayGameGate game="memory">
      {() => (
        <div className="mx-auto h-[calc(100dvh-8rem)] max-w-4xl">
          <NumberMemory />
        </div>
      )}
    </PlayGameGate>
  );
}
