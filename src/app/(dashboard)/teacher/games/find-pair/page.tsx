"use client";

import { Suspense, useState } from "react";
import { useSearchParams } from "next/navigation";
import { FindPairSetup } from "@/components/teacher/find-pair/find-pair-setup";
import { FindPairGame } from "@/components/teacher/find-pair/find-pair-game";
import type { PairMatch } from "@/lib/games/find-pair";

/**
 * Find the Pair — teacher surface. Shows the flexible setup (content source,
 * flip/match mode, column labels, round options), then the single-screen play
 * board. A `?set=<id>` param (from Create Games "Play") preselects that set.
 */
function FindPairInner() {
  const params = useSearchParams();
  const initialSetId = params.get("set") ?? undefined;

  const [match, setMatch] = useState<PairMatch | null>(null);

  if (match) {
    return (
      <div className="mx-auto h-[calc(100vh-8rem)] max-w-6xl">
        <FindPairGame match={match} onExit={() => setMatch(null)} />
      </div>
    );
  }

  return <FindPairSetup initialSetId={initialSetId} onStart={setMatch} />;
}

export default function FindPairPage() {
  return (
    <Suspense fallback={null}>
      <FindPairInner />
    </Suspense>
  );
}
