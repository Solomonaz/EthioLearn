/**
 * The grades 1-8 games outside the classroom.
 *
 * The same games run in two places: on the teacher's classroom screen
 * (/teacher) and in the play area of a grades 1-8 student (/play), on the
 * child's own phone, tablet or computer — alone, against the computer, or two
 * players sharing the one device. The setup screens take an `audience` so a
 * student never sees teacher-only sources (saved class sets) and their AI
 * requests go to the student endpoint, which bills their plan, not a school.
 */

import type { MathBand } from "./tug-of-war";

/** Who is setting a game up. */
export type GameAudience = "teacher" | "student";

/** Where each audience's AI question generation goes. */
export const AI_GENERATE_URL: Record<GameAudience, string> = {
  teacher: "/api/teacher/games/generate",
  student: "/api/play/generate",
};

/** Where a student upgrades their plan from the play area. */
export const PLAY_BILLING_HREF = "/play/billing";

/**
 * Quick Math content for a student's own grade: adding and taking away in
 * grades 1-3, all four operations in 4-6, percentages and simple equations
 * in 7-8. (The classroom uses the "mix" band for any grade 1-6 class.)
 */
export function mathBandForGrade(grade: number | null | undefined): MathBand {
  if (!grade || grade <= 3) return "13";
  if (grade <= 6) return "mix";
  return "78";
}

export type PlayGameKey = "tug" | "find-pair" | "routing" | "memory" | "find-color";

/**
 * Games a grades 1-8 student may play without a plan that includes games
 * (the `games` entitlement). Kept to the two simple brain trainers so a free
 * account always has something to do, while the curriculum games are paid.
 */
export const FREE_PLAY_GAMES: ReadonlySet<PlayGameKey> = new Set<PlayGameKey>([
  "find-color",
  "memory",
]);

/** Whether a student with these entitlements may play `game`. */
export function canPlayGame(game: PlayGameKey, ent: { games: boolean }): boolean {
  return ent.games || FREE_PLAY_GAMES.has(game);
}
