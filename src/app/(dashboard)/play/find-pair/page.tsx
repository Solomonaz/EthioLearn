"use client";

import { useState } from "react";
import { FindPairSetup } from "@/components/teacher/find-pair/find-pair-setup";
import { FindPairGame } from "@/components/teacher/find-pair/find-pair-game";
import { PlayGameGate } from "@/components/play/play-game-gate";
import type { PairMatch } from "@/lib/games/find-pair";

/** Find the Pair for a grades 1-8 student, played alone on their own device. */
export default function PlayFindPairPage() {
  const [match, setMatch] = useState<PairMatch | null>(null);

  return (
    <PlayGameGate game="find-pair">
      {(ent) =>
        match ? (
          <div className="mx-auto h-[calc(100dvh-8rem)] max-w-6xl">
            <FindPairGame match={match} onExit={() => setMatch(null)} />
          </div>
        ) : (
          <FindPairSetup
            audience="student"
            aiLocked={!(ent.ai && ent.aiFeatures.aiQuizGen)}
            onStart={setMatch}
          />
        )
      }
    </PlayGameGate>
  );
}
