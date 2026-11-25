/**
 * The feature registry — every user-facing feature a plan can include.
 *
 * One entry per feature: the admin plan editor lists these (grouped), plans
 * store `{ [key]: boolean }` in `PricingPlan.featureAccess`, getEntitlements()
 * resolves them per user, and API routes refuse with `featureDenial()`.
 * Adding a feature is one entry here plus a `featureDenial(user, "<key>")` in
 * its routes — no schema change.
 *
 * Safe to import on the client (no server imports).
 */

export const FEATURE_GROUPS = {
  ai: "AI features",
  study: "Study tools",
  games: "Games & social",
  teacher: "Teacher tools",
} as const;
export type FeatureGroup = keyof typeof FEATURE_GROUPS;

/** Who uses a feature. "student" = grades 9-12 (/student), "play" = grades 1-8 (/play). */
export type FeatureUser = "student" | "play" | "secondaryTeacher" | "teacher";

/** The plan columns that existed before per-feature access. */
export type LegacyFlag =
  | "allowAi"
  | "allowMultiplayer"
  | "allowRewards"
  | "allowLeaderboard"
  | "allowMathTools"
  | "allowGames";

/** The platform switches (Admin → Settings) that sit on top of plan access. */
export type PlatformSwitch = "aiTutor" | "aiQuizGen" | "aiAdaptive" | "aiMathTools" | "aiTeacherAssistant" | "rewards";

export interface FeatureDef {
  key: string;
  group: FeatureGroup;
  /** Admin-facing name (admin pages are English-only). */
  label: string;
  /** Admin-facing: what it covers, where it lives. */
  description: string;
  users: readonly FeatureUser[];
  /** Spends AI money. */
  ai: boolean;
  /**
   * The old plan columns this feature was part of (all must be on). A student
   * plan saved before per-feature access uses these; none = it was free.
   */
  legacy: readonly LegacyFlag[];
  /** Platform-wide kill switch on top of plan access, if any. */
  platform?: PlatformSwitch;
  /** Only school plans offer it (school students / teachers only). */
  schoolOnly?: boolean;
}

export const FEATURES = [
  // ── AI features ──
  {
    key: "textbookChat",
    group: "ai",
    label: "Textbook Chat (AI tutor)",
    description: "Ask the AI tutor anything about the textbook — AI Study → Textbook Chat.",
    users: ["student"],
    ai: true,
    legacy: ["allowAi"],
    platform: "aiTutor",
  },
  {
    key: "whiteboard",
    group: "ai",
    label: "Whiteboard lessons",
    description: "Quiz-mistake lessons, photo/PDF homework uploads, practice questions and spoken practice — AI Study → Whiteboard.",
    users: ["student"],
    ai: true,
    legacy: ["allowAi"],
    platform: "aiTutor",
  },
  {
    key: "whiteboardVoice",
    group: "ai",
    label: "Cloud read-aloud voice",
    description: "Whiteboard lessons read by the paid voice service. Off = the device's own (free) voice.",
    users: ["student"],
    ai: true,
    legacy: ["allowAi"],
    platform: "aiTutor",
  },
  {
    key: "whyWrong",
    group: "ai",
    label: "“Why was I wrong?”",
    description: "AI explanation of one wrong answer on the quiz results page.",
    users: ["student"],
    ai: true,
    legacy: ["allowAi"],
    platform: "aiTutor",
  },
  {
    key: "aiQuizzes",
    group: "ai",
    label: "AI-generated quizzes",
    description: "The “AI” question source on the quiz page (new questions written from the textbook).",
    users: ["student"],
    ai: true,
    legacy: ["allowAi"],
    platform: "aiQuizGen",
  },
  {
    key: "adaptive",
    group: "ai",
    label: "Adaptive difficulty & study recommendations",
    description: "The “Adaptive” quiz difficulty and the personal study recommendations on the dashboard and progress page.",
    users: ["student"],
    ai: true,
    legacy: ["allowAi"],
    platform: "aiAdaptive",
  },
  {
    key: "aiMathTools",
    group: "ai",
    label: "AI math helpers",
    description: "AI inside the grapher and 3D lab: explain a graph, describe-to-graph, handwriting and shape photos, geometry questions.",
    users: ["student", "secondaryTeacher"],
    ai: true,
    legacy: ["allowMathTools"],
    platform: "aiMathTools",
  },
  {
    key: "aiGameQuestions",
    group: "ai",
    label: "AI questions in grades 1-8 games",
    description: "AI-written questions for Tug of War and Find the Pair (grades 1-8).",
    users: ["play"],
    ai: true,
    legacy: ["allowGames", "allowAi"],
    platform: "aiQuizGen",
  },

  // ── Study tools ──
  {
    key: "nationalExam",
    group: "study",
    label: "National exam practice",
    description: "Past national exam papers with explanations.",
    users: ["student"],
    ai: false,
    legacy: [],
  },
  {
    key: "library",
    group: "study",
    label: "Library & textbook reader",
    description: "Browse and read the textbooks.",
    users: ["student"],
    ai: false,
    legacy: [],
  },
  {
    key: "studyNotes",
    group: "study",
    label: "Study notes",
    description: "Notes the student keeps while reading a textbook.",
    users: ["student"],
    ai: false,
    legacy: [],
  },
  {
    key: "dailyChallenge",
    group: "study",
    label: "Daily challenge",
    description: "Five questions a day with bonus points.",
    users: ["student"],
    ai: false,
    legacy: [],
  },
  {
    key: "reminders",
    group: "study",
    label: "Study reminders",
    description: "Telegram / push reminders to keep the streak going.",
    users: ["student"],
    ai: false,
    legacy: [],
  },
  {
    key: "graphing",
    group: "study",
    label: "Graphing calculator",
    description: "The graphing calculator (students 9-12 and secondary teachers).",
    users: ["student", "secondaryTeacher"],
    ai: false,
    legacy: ["allowMathTools"],
  },
  {
    key: "geometry3d",
    group: "study",
    label: "3D Geometry lab",
    description: "Build and rotate 3D shapes (students 9-12 and secondary teachers).",
    users: ["student", "secondaryTeacher"],
    ai: false,
    legacy: ["allowMathTools"],
  },
  {
    key: "classActivities",
    group: "study",
    label: "Class activities & homework",
    description: "Homework and tests a secondary teacher sets; students see them under My Work.",
    users: ["student", "secondaryTeacher"],
    ai: false,
    legacy: [],
    schoolOnly: true,
  },

  // ── Games & social ──
  {
    key: "battle",
    group: "games",
    label: "Battle mode (multiplayer)",
    description: "Live quizzes against other students. Solo quizzes are always allowed.",
    users: ["student"],
    ai: false,
    legacy: ["allowMultiplayer"],
  },
  {
    key: "rewards",
    group: "games",
    label: "Rewards",
    description: "Earn and redeem rewards.",
    users: ["student"],
    ai: false,
    legacy: ["allowRewards"],
    platform: "rewards",
  },
  {
    key: "leaderboard",
    group: "games",
    label: "Leaderboard",
    description: "Rankings against other students.",
    users: ["student"],
    ai: false,
    legacy: ["allowLeaderboard"],
  },
  {
    key: "playGames",
    group: "games",
    label: "All grades 1-8 games",
    description: "Every game in the grades 1-8 play area. Without it, the free games stay open.",
    users: ["play"],
    ai: false,
    legacy: ["allowGames"],
  },

  // ── Teacher tools (school plans) ──
  {
    key: "teacherAssistant",
    group: "teacher",
    label: "Teacher AI assistant",
    description: "The secondary teachers' AI assistant, AI-written worked examples and merging materials. Uses the teacher's monthly AI credits.",
    users: ["secondaryTeacher"],
    ai: true,
    legacy: [],
    platform: "aiTeacherAssistant",
    schoolOnly: true,
  },
  {
    key: "teacherQuestionGen",
    group: "teacher",
    label: "AI question generation (teachers)",
    description: "AI-written questions for class activities (9-12) and custom classroom games (1-8). Uses monthly AI credits.",
    users: ["secondaryTeacher", "teacher"],
    ai: true,
    legacy: [],
    platform: "aiQuizGen",
    schoolOnly: true,
  },
  {
    key: "studentProgress",
    group: "teacher",
    label: "Per-student progress",
    description: "Secondary teachers open one student's quizzes, activities and weak chapters.",
    users: ["secondaryTeacher"],
    ai: false,
    legacy: [],
    schoolOnly: true,
  },
  {
    key: "classroomGames",
    group: "teacher",
    label: "Classroom games (grades 1-8 teachers)",
    description: "The grades 1-8 teachers' whole-class games, random picker and their own custom games.",
    users: ["teacher"],
    ai: false,
    legacy: [],
    schoolOnly: true,
  },
] as const satisfies readonly FeatureDef[];

export type FeatureKey = (typeof FEATURES)[number]["key"];
export type FeatureMap = Record<FeatureKey, boolean>;

export const FEATURE_KEYS: FeatureKey[] = FEATURES.map((f) => f.key);
export const FEATURE_BY_KEY: Record<FeatureKey, FeatureDef> = Object.fromEntries(
  FEATURES.map((f) => [f.key, f]),
) as unknown as Record<FeatureKey, FeatureDef>;

export function isFeatureKey(k: unknown): k is FeatureKey {
  return typeof k === "string" && k in FEATURE_BY_KEY;
}

/** Features a plan of this audience offers (student plans skip school-only ones). */
export function featuresForAudience(audience: "STUDENT" | "SCHOOL"): FeatureDef[] {
  return FEATURES.filter((f: FeatureDef) => audience === "SCHOOL" || !f.schoolOnly);
}

export function allFeatures(value: boolean): FeatureMap {
  return Object.fromEntries(FEATURE_KEYS.map((k) => [k, value])) as FeatureMap;
}

/**
 * What students without a paid plan had before per-feature access: no AI, no
 * battle/rewards/leaderboard/math tools/paid games; every feature that was
 * never paid (national exams, library, notes, …) stays on.
 */
export const LEGACY_FREE_TIER: FeatureMap = Object.fromEntries(
  FEATURES.map((f: FeatureDef) => [f.key, f.legacy.length === 0 && !f.schoolOnly]),
) as FeatureMap;

type PlanLike = {
  audience: "STUDENT" | "SCHOOL";
  featureAccess?: unknown;
} & Partial<Record<LegacyFlag, boolean>>;

/** The stored per-feature map, ignoring junk keys/values. */
export function storedFeatureAccess(raw: unknown): Partial<FeatureMap> {
  const out: Partial<FeatureMap> = {};
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return out;
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (isFeatureKey(k) && typeof v === "boolean") out[k] = v;
  }
  return out;
}

/**
 * A plan's feature map: the stored value per feature, else the fallback —
 * `fallback` when given (the free tier), else the legacy columns for a student
 * plan, else on (school plans: their allow* columns were never enforced).
 */
export function planFeatureMap(plan: PlanLike, fallback?: FeatureMap): FeatureMap {
  const stored = storedFeatureAccess(plan.featureAccess);
  const out = {} as FeatureMap;
  for (const f of FEATURES as readonly FeatureDef[]) {
    const key = f.key as FeatureKey;
    if (stored[key] !== undefined) out[key] = stored[key]!;
    else if (fallback) out[key] = fallback[key];
    else if (plan.audience === "SCHOOL") out[key] = true;
    else out[key] = f.legacy.every((flag) => plan[flag] !== false);
  }
  // Student plans never include school-only features.
  if (plan.audience === "STUDENT") {
    for (const f of FEATURES as readonly FeatureDef[]) if (f.schoolOnly) out[f.key as FeatureKey] = false;
  }
  return out;
}

/** The allow* columns that summarise a feature map (kept in sync for older readers). */
export function legacyFlagsFrom(map: FeatureMap): Record<LegacyFlag, boolean> {
  return {
    allowAi: map.textbookChat || map.whiteboard || map.whyWrong || map.aiQuizzes || map.adaptive,
    allowMultiplayer: map.battle,
    allowRewards: map.rewards,
    allowLeaderboard: map.leaderboard,
    allowMathTools: map.graphing || map.geometry3d,
    allowGames: map.playGames,
  };
}
