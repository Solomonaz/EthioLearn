/**
 * Per-question time budget for timed play (Timed mode + Battle).
 *
 * A flat 20–30 s is unfair to calculation and graph-reading questions, which
 * take longer to work out than a quick recall item. This gives each question a
 * budget scaled by its difficulty and whether it needs real working (numeric
 * calculation or reading a described graph), so fast play stays snappy while
 * heavier items get a fair amount of time.
 *
 * Pure and dependency-free so both the client (quiz store) and the battle
 * server can share it.
 */

export interface TimingQuestion {
  type?: string;
  difficulty?: string;
  questionText?: string;
  options?: (string | { text?: string })[];
}

// Signals that a question requires calculation (numbers + a unit/operator) …
const NUMERIC_RE =
  /(=|\+|×|·|\*|\/|\^|√|½|\bN\b|\bkg\b|\bm\/s|N\/C|\bJ\b|\bW\b|°C|μC|\bmol\b|Ω|Δ|\bm²|\bm\^2)/i;
// … or reading/interpreting a described graph or figure.
const GRAPHICAL_RE =
  /graph|slope|gradient|area under|intercept|velocity[-\s]?time|distance[-\s]?time|\bplot\b|\baxis\b/i;

/**
 * True if a question needs real working — a numeric calculation or reading a
 * described graph/figure — and so deserves more time under a countdown.
 */
export function isHeavyQuestion(q: TimingQuestion): boolean {
  const optText = (q.options ?? [])
    .map((o) => (typeof o === "string" ? o : o?.text ?? ""))
    .join(" ");
  const full = `${q.questionText ?? ""} ${optText}`;
  return (/\d/.test(full) && NUMERIC_RE.test(full)) || GRAPHICAL_RE.test(q.questionText ?? "");
}

/**
 * Full per-question budget for Timed (solo) play — scaled by difficulty, weight,
 * and input type. Battle uses a tighter budget (see BATTLE_* below) to stay fast.
 */
export function getQuestionSeconds(q: TimingQuestion): number {
  const diff = String(q.difficulty ?? "MEDIUM").toUpperCase();
  let secs = diff === "EASY" ? 20 : diff === "HARD" ? 45 : 30;

  if (isHeavyQuestion(q)) secs += 20;

  // Match/ordering take longer to input than a single tap.
  const type = String(q.type ?? "MCQ").toUpperCase();
  if (type === "MATCH_PAIRS" || type === "ORDERING") secs += 10;

  return Math.min(secs, 90);
}

// Battle (head-to-head) stays fast — normal questions keep the classic 20 s,
// only heavy calculation/graph questions get a longer window.
export const BATTLE_BASE_SECONDS = 20;
export const BATTLE_HEAVY_SECONDS = 35;

export function getBattleSeconds(q: TimingQuestion): number {
  return isHeavyQuestion(q) ? BATTLE_HEAVY_SECONDS : BATTLE_BASE_SECONDS;
}
