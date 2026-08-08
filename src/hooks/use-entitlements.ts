"use client";

import { useEffect, useState } from "react";

export interface EntitlementsInfo {
  ai: boolean;
  multiplayer: boolean;
  rewards: boolean;
  leaderboard: boolean;
  isIndependent: boolean;
  isSchoolStudent: boolean;
  planName: string | null;
  /** Paid plans / billing enabled platform-wide. Off = hide billing UI. */
  pricingEnabled: boolean;
  /** Effective per-AI-feature switches (master AND per-feature). */
  aiFeatures: { aiTutor: boolean; aiVideo: boolean; aiQuizGen: boolean; aiAdaptive: boolean };
  loading: boolean;
}

// Optimistic default: assume full access while loading so full-access users
// (the common case) never see a flash of "locked" UI. The server is the real gate.
const DEFAULT: EntitlementsInfo = {
  ai: true,
  multiplayer: true,
  rewards: true,
  leaderboard: true,
  isIndependent: false,
  isSchoolStudent: false,
  planName: null,
  pricingEnabled: true,
  aiFeatures: { aiTutor: true, aiVideo: true, aiQuizGen: true, aiAdaptive: true },
  loading: true,
};

/**
 * Fetches the current user's entitlements once. For UX gating only — every
 * protected server route enforces entitlements on its own.
 */
export function useEntitlements(): EntitlementsInfo {
  const [state, setState] = useState<EntitlementsInfo>(DEFAULT);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/students/me/entitlements")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (cancelled) return;
        if (d) {
          setState({
            ai: !!d.ai,
            multiplayer: !!d.multiplayer,
            rewards: !!d.rewards,
            leaderboard: !!d.leaderboard,
            isIndependent: !!d.isIndependent,
            isSchoolStudent: !!d.isSchoolStudent,
            planName: d.planName ?? null,
            pricingEnabled: d.pricingEnabled !== false,
            aiFeatures: {
              aiTutor: d.aiFeatures?.aiTutor !== false,
              aiVideo: d.aiFeatures?.aiVideo !== false,
              aiQuizGen: d.aiFeatures?.aiQuizGen !== false,
              aiAdaptive: d.aiFeatures?.aiAdaptive !== false,
            },
            loading: false,
          });
        } else {
          setState((s) => ({ ...s, loading: false }));
        }
      })
      .catch(() => {
        if (!cancelled) setState((s) => ({ ...s, loading: false }));
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return state;
}
