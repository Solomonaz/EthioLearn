"use client";

import { useState } from "react";
import { useSession } from "next-auth/react";
import { TugSetup } from "@/components/teacher/tug-of-war/tug-setup";
import { TugGame } from "@/components/teacher/tug-of-war/tug-game";
import { PlayGameGate } from "@/components/play/play-game-gate";
import type { TugMatch } from "@/lib/games/tug-of-war";

/**
 * Tug of War for a grades 1-8 student: against the computer, or with a
 * friend sharing this device.
 */
export default function PlayTugPage() {
  const { data: session } = useSession();
  const grade = (session?.user as { grade?: number | null } | undefined)?.grade ?? null;
  const [match, setMatch] = useState<TugMatch | null>(null);

  return (
    <PlayGameGate game="tug">
      {(ent) =>
        match ? (
          <div className="mx-auto h-[calc(100dvh-8rem)] max-w-6xl">
            <TugGame match={match} onExit={() => setMatch(null)} />
          </div>
        ) : (
          <TugSetup
            audience="student"
            grade={grade}
            aiLocked={!(ent.ai && ent.aiFeatures.aiQuizGen)}
            onStart={setMatch}
          />
        )
      }
    </PlayGameGate>
  );
}
