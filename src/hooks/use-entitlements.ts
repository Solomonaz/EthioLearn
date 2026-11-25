"use client";

import { useEffect, useState } from "react";
import { FEATURE_KEYS, allFeatures, type FeatureKey, type FeatureMap } from "@/lib/features";

export interface EntitlementsInfo {
  /** What the user may use now (plan access AND the platform switches). */
  features: FeatureMap;
  /** Platform switches alone: false = turned off for everyone (hide it, don't sell it). */
  available: FeatureMap;
  /** Anti-cheat tracking (tab-switch penalties, clipboard restriction). */
  antiCheat: boolean;
  isIndependent: boolean;
  isSchoolStudent: boolean;
  /** Access comes from the user's school plan (school students, teachers). */
  viaSchool: boolean;
  planName: string | null;
  /** Paid plans / billing enabled platform-wide. Off = hide billing UI. */
  pricingEnabled: boolean;
  /** Rewards store enabled platform-wide. Off = show inactive banner. */
  rewardsEnabled: boolean;
  /** Effective per-AI-feature switches (master AND per-feature). */
  aiFeatures: { aiTutor: boolean; aiQuizGen: boolean; aiAdaptive: boolean; aiMathTools: boolean };
  /** The user's school level; null when they have no school. */
  schoolLevel: "ELEMENTARY" | "SECONDARY" | null;
  /** End of the sign-up free trial (ISO), or null when there is none. */
  trialEndsAt: string | null;
  /** The sign-up free trial is running now. */
  trialActive: boolean;
  loading: boolean;
}

/** True when the plan leaves this feature out but it could be bought (not switched off). */
export function isLocked(ent: EntitlementsInfo, key: FeatureKey): boolean {
  return !ent.loading && ent.available[key] && !ent.features[key];
}

// Optimistic default: assume full access while loading so full-access users
// (the common case) never see a flash of "locked" UI. The server is the real gate.
const DEFAULT: EntitlementsInfo = {
  features: allFeatures(true),
  available: allFeatures(true),
  antiCheat: true,
  isIndependent: false,
  isSchoolStudent: false,
  viaSchool: false,
  planName: null,
  pricingEnabled: true,
  rewardsEnabled: true,
  aiFeatures: { aiTutor: true, aiQuizGen: true, aiAdaptive: true, aiMathTools: true },
  schoolLevel: null,
  trialEndsAt: null,
  trialActive: false,
  loading: true,
};

function readMap(raw: unknown, fallback: boolean): FeatureMap {
  const src = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  return Object.fromEntries(
    FEATURE_KEYS.map((k) => [k, typeof src[k] === "boolean" ? (src[k] as boolean) : fallback]),
  ) as FeatureMap;
}

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
            features: readMap(d.features, false),
            available: readMap(d.available, true),
            antiCheat: d.antiCheat !== false,
            isIndependent: !!d.isIndependent,
            isSchoolStudent: !!d.isSchoolStudent,
            viaSchool: !!d.viaSchool,
            planName: d.planName ?? null,
            pricingEnabled: d.pricingEnabled !== false,
            rewardsEnabled: d.rewardsEnabled !== false,
            aiFeatures: {
              aiTutor: d.aiFeatures?.aiTutor !== false,
              aiQuizGen: d.aiFeatures?.aiQuizGen !== false,
              aiAdaptive: d.aiFeatures?.aiAdaptive !== false,
              aiMathTools: d.aiFeatures?.aiMathTools !== false,
            },
            schoolLevel: d.schoolLevel ?? null,
            trialEndsAt: typeof d.trialEndsAt === "string" ? d.trialEndsAt : null,
            trialActive: !!d.trialActive,
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
