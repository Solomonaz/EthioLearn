"use client";

import { useEffect, useState } from "react";

export interface EntitlementsInfo {
  ai: boolean;
  multiplayer: boolean;
  rewards: boolean;
  leaderboard: boolean;
  mathTools: boolean;
  /** Anti-cheat tracking (tab-switch penalties, clipboard restriction). */
  antiCheat: boolean;
  isIndependent: boolean;
  isSchoolStudent: boolean;
  planName: string | null;
  /** Paid plans / billing enabled platform-wide. Off = hide billing UI. */
  pricingEnabled: boolean;
  /** Rewards store enabled platform-wide. Off = show inactive banner. */
  rewardsEnabled: boolean;
  /** Effective per-AI-feature switches (master AND per-feature). */
  aiFeatures: { aiTutor: boolean; aiQuizGen: boolean; aiAdaptive: boolean; aiMathTools: boolean };
  loading: boolean;
}

// Optimistic default: assume full access while loading so full-access users
// (the common case) never see a flash of "locked" UI. The server is the real gate.
const DEFAULT: EntitlementsInfo = {
  ai: true,
  multiplayer: true,
  rewards: true,
  leaderboard: true,
  mathTools: true,
  antiCheat: true,
  isIndependent: false,
  isSchoolStudent: false,
  planName: null,
  pricingEnabled: true,
  rewardsEnabled: true,
  aiFeatures: { aiTutor: true, aiQuizGen: true, aiAdaptive: true, aiMathTools: true },
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
            mathTools: !!d.mathTools,
            antiCheat: d.antiCheat !== false,
            isIndependent: !!d.isIndependent,
            isSchoolStudent: !!d.isSchoolStudent,
            planName: d.planName ?? null,
            pricingEnabled: d.pricingEnabled !== false,
            rewardsEnabled: d.rewardsEnabled !== false,
            aiFeatures: {
              aiTutor: d.aiFeatures?.aiTutor !== false,
              aiQuizGen: d.aiFeatures?.aiQuizGen !== false,
              aiAdaptive: d.aiFeatures?.aiAdaptive !== false,
              aiMathTools: d.aiFeatures?.aiMathTools !== false,
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
