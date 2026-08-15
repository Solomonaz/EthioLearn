/**
 * Tug of War — shared, framework-free game logic.
 *
 * Single-screen, teacher-hosted classroom game (grades 1–6). It is a REAL-TIME,
 * PARALLEL game: both teams play at the same time, each with their own question
 * and their own answer pad on their half of the shared touch screen. There are
 * no turns and no manual "next" — every answer pulls the rope and immediately
 * loads a fresh question for that team. All state is local (no networking, no
 * student devices), matching the "no student phones" classroom constraint.
 */

// ─── Content ────────────────────────────────────────────────

/** Where a match's questions come from. */
export type TugSource = "MATH" | "SET" | "MANUAL" | "AI";

/**
 * How a team answers:
 *   "keypad"  → type the number (Quick Math).
 *   "options" → tap one of the multiple-choice buttons (saved/manual/AI sets).
 */
export type TugInputMode = "keypad" | "options";

/**
 * Quick-Math content selector:
 *   "mix" → mixed elementary + − × ÷ (the default; no level to pick)
 *   "13"  → addition & subtraction only
 *   "46"  → multiplication & division only
 *   "78"  → percentages & one-step algebra
 */
export type MathBand = "mix" | "13" | "46" | "78";

/** A single normalised question. `correctIndex` points into `options`. */
export interface TugQuestion {
  id: string;
  text: string;
  options: string[];
  correctIndex: number;
}

/** The correct answer's display value (used by keypad comparison). */
export function correctValue(q: TugQuestion): string {
  return q.options[q.correctIndex] ?? "";
}

// ─── Match configuration & mechanics ────────────────────────

export interface TugConfig {
  team1Name: string;
  team2Name: string;
  /**
   * Net pulls one team must be ahead by to win by knockout — how far the flag
   * must travel from the centre to a team's edge. Larger = longer match.
   */
  target: number;
  /** Total match length in seconds; 0 = no clock (play to knockout). */
  matchSeconds: number;
}

/** Everything the play surface needs to run a match. */
export interface TugMatch {
  config: TugConfig;
  mode: TugInputMode;
  /** Present in keypad (math) mode — questions are generated on demand. */
  band?: MathBand;
  /** Present in options mode — the pool teams draw from. */
  deck?: TugQuestion[];
}

/** Tuning constants for the pull mechanics. Kept here so play/tests agree. */
export const TUG = {
  /** Consecutive correct answers that unlock a SUPER PULL. */
  SUPER_STREAK: 3,
  /** Flag steps moved by a normal correct answer. */
  NORMAL_PULL: 1,
  /** Flag steps moved when a streak triggers a super pull. */
  SUPER_PULL: 2,
  /** Sensible default match length (net pulls to knockout). */
  DEFAULT_TARGET: 6,
  /** Default match clock. */
  DEFAULT_MATCH_SECONDS: 90,
} as const;

export const MATCH_SECONDS_CHOICES = [60, 90, 120, 0] as const;
export const TARGET_CHOICES = [5, 6, 8, 10] as const;

// ─── Play state ─────────────────────────────────────────────

export type Team = 1 | 2;

export interface TugState {
  /**
   * Flag position along the rope, in net pull steps. Positive = team 1 (left)
   * is winning and has dragged the flag toward their edge; negative = team 2.
   * Knockout at `offset >= target` (team 1) or `offset <= -target` (team 2).
   */
  offset: number;
  /** Current consecutive-correct run, per team. */
  streak: Record<Team, number>;
  /** Total correct answers, per team (for the end-of-match scoreline). */
  correct: Record<Team, number>;
  /** Winner once decided; 0 = draw, null = in play. */
  winner: Team | 0 | null;
  endReason: "knockout" | "timeup" | "draw" | null;
}

export interface PullResult {
  state: TugState;
  /** True when this answer landed a super pull. */
  superPull: boolean;
}

export function initialTugState(): TugState {
  return {
    offset: 0,
    streak: { 1: 0, 2: 0 },
    correct: { 1: 0, 2: 0 },
    winner: null,
    endReason: null,
  };
}

/**
 * Register one answer from a team. Correct answers pull the flag that team's
 * way (a 3+ streak doubles into a SUPER PULL); wrong answers only reset the
 * team's streak — they never hand ground to the opponent, which keeps the game
 * kind for young players while still rewarding speed and accuracy. Because both
 * teams pull the same rope, the flag reflects the running difference in correct
 * answers. Never mutates its input.
 */
export function registerPull(
  state: TugState,
  team: Team,
  correct: boolean,
  target: number,
): PullResult {
  if (state.winner !== null) return { state, superPull: false };

  const streak = { ...state.streak };
  const correctCount = { ...state.correct };
  let offset = state.offset;
  let superPull = false;
  const dir = team === 1 ? 1 : -1;

  if (correct) {
    streak[team] += 1;
    correctCount[team] += 1;
    superPull = streak[team] >= TUG.SUPER_STREAK;
    offset += dir * (superPull ? TUG.SUPER_PULL : TUG.NORMAL_PULL);
  } else {
    streak[team] = 0;
  }

  let next: TugState = { ...state, offset, streak, correct: correctCount };
  if (offset >= target) next = { ...next, offset: target, winner: 1, endReason: "knockout" };
  else if (offset <= -target) next = { ...next, offset: -target, winner: 2, endReason: "knockout" };

  return { state: next, superPull };
}

/** Decide the match on the current rope position (used when the clock runs out). */
export function finishByPosition(state: TugState): TugState {
  if (state.winner !== null) return state;
  if (state.offset > 0) return { ...state, winner: 1, endReason: "timeup" };
  if (state.offset < 0) return { ...state, winner: 2, endReason: "timeup" };
  return { ...state, winner: 0, endReason: "draw" };
}

// ─── Quick-Math question generator ──────────────────────────

function randInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/**
 * Build a 4-option MCQ from a numeric answer with plausible near-miss
 * distractors, all unique and non-negative. In keypad mode only `correctValue`
 * is used, but the options keep the type uniform across sources.
 */
function numericQuestion(id: string, text: string, answer: number): TugQuestion {
  const candidates = new Set<number>([answer]);
  const jitters = shuffle([1, 2, 3, 5, 10, -1, -2, -3]);
  let j = 0;
  while (candidates.size < 4 && j < jitters.length) {
    const v = answer + jitters[j++];
    if (v >= 0) candidates.add(v);
  }
  let extra = answer + 4;
  while (candidates.size < 4) {
    if (extra >= 0) candidates.add(extra);
    extra += 1;
  }
  const options = shuffle([...candidates]).map(String);
  return { id, text, options, correctIndex: options.indexOf(String(answer)) };
}

function mathQuestion13(id: string): TugQuestion {
  if (Math.random() < 0.5) {
    const a = randInt(1, 12);
    const b = randInt(1, 12);
    return numericQuestion(id, `${a} + ${b} = ?`, a + b);
  }
  const a = randInt(2, 18);
  const b = randInt(1, a);
  return numericQuestion(id, `${a} − ${b} = ?`, a - b);
}

function mathQuestion46(id: string): TugQuestion {
  if (Math.random() < 0.5) {
    const a = randInt(2, 12);
    const b = randInt(2, 12);
    return numericQuestion(id, `${a} × ${b} = ?`, a * b);
  }
  const b = randInt(2, 12);
  const q = randInt(2, 12);
  const a = b * q; // ensures whole-number division
  return numericQuestion(id, `${a} ÷ ${b} = ?`, q);
}

function mathQuestion78(id: string): TugQuestion {
  const roll = Math.random();
  if (roll < 0.4) {
    const pct = [10, 20, 25, 50][randInt(0, 3)];
    const base = randInt(1, 20) * 10;
    return numericQuestion(id, `${pct}% of ${base} = ?`, Math.round((pct / 100) * base));
  }
  if (roll < 0.7) {
    const a = randInt(2, 20);
    const x = randInt(1, 20);
    return numericQuestion(id, `x + ${a} = ${a + x},  x = ?`, x);
  }
  const a = randInt(2, 9);
  const x = randInt(2, 12);
  return numericQuestion(id, `${a}x = ${a * x},  x = ?`, x);
}

/** Generate one fresh math question for the given band. */
export function makeMathQuestion(band: MathBand): TugQuestion {
  const id = `math-${band}-${randInt(100000, 999999)}`;
  if (band === "mix") {
    // Elementary mix: mostly + − with some × ÷ so it fits any grade-1–6 class.
    return Math.random() < 0.55 ? mathQuestion13(id) : mathQuestion46(id);
  }
  if (band === "13") return mathQuestion13(id);
  if (band === "46") return mathQuestion46(id);
  return mathQuestion78(id);
}

/** Generate `count` fresh math questions for the given band. */
export function generateMathQuestions(band: MathBand, count: number): TugQuestion[] {
  return Array.from({ length: count }, () => makeMathQuestion(band));
}

// ─── Normalising saved / AI / manual content into TugQuestions ──

/** Shape of an MCQ entry stored in a GameContent(MCQ) payload. */
export interface StoredMcq {
  question: string;
  options: string[];
  correctAnswer: string;
}

/**
 * Convert stored MCQ rows (from a teacher's saved set or an AI generation)
 * into play-ready questions. Rows whose correct answer is missing from their
 * options are dropped rather than silently mis-scored.
 */
export function questionsFromStored(rows: StoredMcq[], keyPrefix = "set"): TugQuestion[] {
  const out: TugQuestion[] = [];
  rows.forEach((row, i) => {
    const options = (row.options ?? []).map((o) => String(o).trim()).filter(Boolean);
    const correctIndex = options.findIndex((o) => o === String(row.correctAnswer).trim());
    if (options.length >= 2 && correctIndex >= 0) {
      out.push({ id: `${keyPrefix}-${i}`, text: String(row.question).trim(), options, correctIndex });
    }
  });
  return out;
}

/** Draw a random question from a pool (options mode). */
export function drawFromDeck(deck: TugQuestion[]): TugQuestion {
  return deck[Math.floor(Math.random() * deck.length)];
}
