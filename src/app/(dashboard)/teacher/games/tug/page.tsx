"use client";

import { Suspense, useState } from "react";
import { useSearchParams } from "next/navigation";
import { TugSetup } from "@/components/teacher/tug-of-war/tug-setup";
import { TugGame } from "@/components/teacher/tug-of-war/tug-game";
import type { TugMatch } from "@/lib/games/tug-of-war";

/**
 * Tug of War — teacher surface. Shows the match setup, then the single-screen
 * real-time play stage. A `?set=<id>` param (from the Create Games "Play"
 * button) preselects that saved question set.
 */
function TugOfWarInner() {
  const params = useSearchParams();
  const initialSetId = params.get("set") ?? undefined;

  const [match, setMatch] = useState<TugMatch | null>(null);

  if (match) {
    // The stage fills the available height; the dashboard already provides padding.
    return (
      <div className="mx-auto h-[calc(100vh-8rem)] max-w-6xl">
        <TugGame match={match} onExit={() => setMatch(null)} />
      </div>
    );
  }

  return <TugSetup initialSetId={initialSetId} onStart={setMatch} />;
}

export default function TugOfWarPage() {
  return (
    <Suspense fallback={null}>
      <TugOfWarInner />
    </Suspense>
  );
}
