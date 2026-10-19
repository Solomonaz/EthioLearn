"use client";

import { FindColor } from "@/components/teacher/find-color/find-color";
import { PlayGameGate } from "@/components/play/play-game-gate";

/** Find the Different Color for a grades 1-8 student (a free game). */
export default function PlayFindColorPage() {
  return (
    <PlayGameGate game="find-color">
      {() => (
        <div className="mx-auto h-[calc(100dvh-8rem)] max-w-4xl">
          <FindColor />
        </div>
      )}
    </PlayGameGate>
  );
}
