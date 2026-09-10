import { cache } from "react";
import { db } from "./db";

export interface PlatformSettings {
  aiEnabled: boolean;
  aiTutorEnabled: boolean;
  aiQuizGenEnabled: boolean;
  aiAdaptiveEnabled: boolean;
  aiMathToolsEnabled: boolean;
  pricingEnabled: boolean;
}

// Individual AI features are gated by BOTH the master switch and their own flag.
export interface EffectiveAiFlags {
  aiTutor: boolean;
  aiQuizGen: boolean;
  aiAdaptive: boolean;
  aiMathTools: boolean;
}

const SINGLETON_ID = "singleton";

const DEFAULTS: PlatformSettings = {
  aiEnabled: true,
  aiTutorEnabled: true,
  aiQuizGenEnabled: true,
  aiAdaptiveEnabled: true,
  aiMathToolsEnabled: true,
  pricingEnabled: true,
};

/**
 * Read the global platform settings, creating the singleton row on first use.
 * Wrapped in React `cache()` so repeated reads in one request share one query.
 * Never throws — falls back to permissive defaults if the DB is unreachable.
 */
export const getPlatformSettings = cache(async (): Promise<PlatformSettings> => {
  try {
    const row = await db.platformSettings.upsert({
      where: { id: SINGLETON_ID },
      update: {},
      create: { id: SINGLETON_ID },
      select: {
        aiEnabled: true,
        aiTutorEnabled: true,
              aiQuizGenEnabled: true,
        aiAdaptiveEnabled: true,
        aiMathToolsEnabled: true,
        pricingEnabled: true,
      },
    });
    return row;
  } catch {
    return DEFAULTS;
  }
});

/** Resolve effective per-feature AI flags (master AND per-feature). */
export function effectiveAiFlags(s: PlatformSettings): EffectiveAiFlags {
  return {
    aiTutor: s.aiEnabled && s.aiTutorEnabled,
    aiQuizGen: s.aiEnabled && s.aiQuizGenEnabled,
    aiAdaptive: s.aiEnabled && s.aiAdaptiveEnabled,
    aiMathTools: s.aiEnabled && s.aiMathToolsEnabled,
  };
}

/** Whether a specific AI feature is currently usable (master AND per-feature). */
export async function isAiFeatureEnabled(feature: keyof EffectiveAiFlags): Promise<boolean> {
  const settings = await getPlatformSettings();
  return effectiveAiFlags(settings)[feature];
}

export const PLATFORM_SETTINGS_SINGLETON_ID = SINGLETON_ID;

