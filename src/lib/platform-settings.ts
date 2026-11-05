import { cache } from "react";
import { db } from "./db";

export interface PlatformSettings {
  aiEnabled: boolean;
  aiTutorEnabled: boolean;
  aiQuizGenEnabled: boolean;
  aiAdaptiveEnabled: boolean;
  aiMathToolsEnabled: boolean;
  aiTeacherAssistantEnabled: boolean;
  pricingEnabled: boolean;
  rewardsEnabled: boolean;
  antiCheatEnabled: boolean;
  /** Secondary teachers' monthly AI credits when no plan sets one; null = no cap. */
  teacherAiDefaultMonthlyCredits: number | null;
  /** AI tutor messages per user per day (Addis Ababa day); null = no cap. */
  tutorDailyMessageLimit: number | null;
  /** Free full-access days for new self-registered students; null = no trial. */
  studentTrialDays: number | null;
}

// Individual AI features are gated by BOTH the master switch and their own flag.
export interface EffectiveAiFlags {
  aiTutor: boolean;
  aiQuizGen: boolean;
  aiAdaptive: boolean;
  aiMathTools: boolean;
  /**
   * The teachers' assistant. It used to ride on `aiTutor`, so switching off
   * the STUDENT tutor silently switched off a paid teacher tool as well.
   */
  aiTeacherAssistant: boolean;
}

const SINGLETON_ID = "singleton";

const DEFAULTS: PlatformSettings = {
  aiEnabled: true,
  aiTutorEnabled: true,
  aiQuizGenEnabled: true,
  aiAdaptiveEnabled: true,
  aiMathToolsEnabled: true,
  aiTeacherAssistantEnabled: true,
  pricingEnabled: true,
  rewardsEnabled: true,
  antiCheatEnabled: true,
  teacherAiDefaultMonthlyCredits: 300,
  tutorDailyMessageLimit: 20,
  studentTrialDays: null,
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
        aiTeacherAssistantEnabled: true,
        pricingEnabled: true,
        rewardsEnabled: true,
        antiCheatEnabled: true,
        teacherAiDefaultMonthlyCredits: true,
        tutorDailyMessageLimit: true,
        studentTrialDays: true,
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
    aiTeacherAssistant: s.aiEnabled && s.aiTeacherAssistantEnabled,
  };
}

/** Whether a specific AI feature is currently usable (master AND per-feature). */
export async function isAiFeatureEnabled(feature: keyof EffectiveAiFlags): Promise<boolean> {
  const settings = await getPlatformSettings();
  return effectiveAiFlags(settings)[feature];
}

/**
 * Resolves whether anti-cheat tracking should be active.
 *
 * Rule: Anti-cheat tracking is only active when BOTH the rewards system is enabled
 * AND anti-cheat tracking is explicitly turned on. If rewards are off, anti-cheat
 * tracking is automatically dormant.
 */
export function isAntiCheatActive(settings: PlatformSettings): boolean {
  return settings.rewardsEnabled && settings.antiCheatEnabled;
}

export const PLATFORM_SETTINGS_SINGLETON_ID = SINGLETON_ID;

