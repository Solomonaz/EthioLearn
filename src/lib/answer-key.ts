/**
 * Splitting a generated worksheet into the half a student may see and the
 * half only their teacher may see.
 *
 * A worksheet is far more useful to a teacher with worked solutions and a
 * marking guide attached. It is useless to a student with them attached. So
 * the model is asked for both, and they are separated here — once, before
 * anything is stored — so that the student-facing column physically cannot
 * contain the answers.
 *
 * Two ways of finding the boundary, in order:
 *
 *  1. The FENCE the prompt asks for. A literal `<<<ANSWER_KEY>>>` on its own
 *     line is unambiguous and survives whatever heading style the model felt
 *     like using.
 *  2. A HEADING that announces answers. Models do not always follow
 *     instructions, and "no fence" must not mean "ship the answers".
 *
 * When neither is found, `detected` is false and the caller must treat the
 * whole document as unreviewed — see the note on `SplitResult`.
 */

export const ANSWER_KEY_FENCE = "<<<ANSWER_KEY>>>";

/**
 * Headings that mean "answers follow".
 *
 * Deliberately broad. A false positive costs the teacher a section that
 * appears under "answer key" instead of in the worksheet, which they can see
 * and fix at review. A false negative hands students the answers.
 */
const HEADING_PATTERNS = [
  /^\s{0,3}#{1,6}\s*\**\s*(answer\s*key|answers?|marking\s*(guide|scheme)|solutions?|worked\s*(solutions?|answers?))\b/i,
  /^\s{0,3}\**\s*(answer\s*key|marking\s*(guide|scheme)|solutions?)\b[^\n]{0,60}\**\s*$/i,
];

/**
 * Deliberately NOT treated as an answer key: "Worked example".
 *
 * A worked example is teaching content — the model solves a problem to show
 * the method, and the student is meant to read it before attempting their
 * own. Cutting there would take the lesson away and leave only the exercises.
 * A real answer key answers the STUDENT'S problems; a worked example answers
 * a different one on purpose.
 */

export interface SplitResult {
  /** What the student receives. Never contains the answer section. */
  body: string;
  /** Worked solutions and marking guide, or null when there were none. */
  answerKey: string | null;
  /**
   * Whether a boundary was actually found.
   *
   * False means one of two things — the model wrote no answers at all, or it
   * wrote them somewhere this could not see. The caller cannot tell which, so
   * it must say so to the teacher rather than assume the happy case.
   */
  detected: boolean;
}

export function splitAnswerKey(markdown: string): SplitResult {
  const text = (markdown ?? "").trim();
  if (!text) return { body: "", answerKey: null, detected: false };

  // ── 1. The explicit fence ───────────────────────────────────────────
  const fenceAt = text.indexOf(ANSWER_KEY_FENCE);
  if (fenceAt !== -1) {
    const body = text.slice(0, fenceAt).trim();
    const key = text.slice(fenceAt + ANSWER_KEY_FENCE.length).trim();
    // A fence with nothing after it is just noise to strip.
    return {
      body,
      answerKey: key.length > 0 ? key : null,
      detected: key.length > 0,
    };
  }

  // ── 2. A heading that announces answers ─────────────────────────────
  const lines = text.split("\n");
  for (let i = 0; i < lines.length; i++) {
    if (!HEADING_PATTERNS.some((re) => re.test(lines[i]))) continue;

    // A heading in the first few lines is the document's own title
    // ("Worksheet with answer key"), not the start of the answers.
    if (i < 2) continue;

    const body = lines.slice(0, i).join("\n").trim();
    const key = lines.slice(i).join("\n").trim();

    // Refuse a split that would leave the student almost nothing — that
    // means the match was a false positive, not the real boundary.
    if (body.length < 40) continue;

    return { body, answerKey: key, detected: true };
  }

  return { body: text, answerKey: null, detected: false };
}

/**
 * Does this text still look like it contains answers?
 *
 * A last check on the student-facing half, used to warn the teacher at
 * review. It is a safety net for a model that scattered solutions through the
 * problems instead of gathering them at the end — which no split can fix, and
 * only a human reading it can catch.
 */
export function looksLikeItContainsAnswers(body: string): boolean {
  return HEADING_PATTERNS.some((re) =>
    body.split("\n").some((line) => re.test(line)),
  );
}
