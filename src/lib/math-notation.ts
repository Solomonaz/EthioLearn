/**
 * Maths notation in question text: LaTeX ↔ plain Unicode.
 *
 * Models write maths as LaTeX (`\(7^5\)`, `$H_2O$`). Plain Unicode (7⁵, H₂O)
 * is better wherever it can express the maths: it is ordinary text, so it
 * shows correctly in a <select>, a notification, a typed answer, a dedupe
 * embedding — anywhere, with no renderer. LaTeX stays only for what Unicode
 * cannot write (fractions, roots of expressions, nested exponents), and
 * MathText renders that on screen.
 *
 * `normalizeMathText` converts every maths segment it can and leaves the rest
 * untouched; `answerKey` folds both notations to one comparable form for
 * grading typed answers.
 */

/**
 * \( \) and $ $ inline, \[ \] and $$ $$ display. A single `$` pair counts as
 * maths only when it hugs its content (`$x^2$`, not `$5 and $10`) and is not
 * followed by a digit, so prices stay text.
 */
export const MATH_DELIMITERS =
  /\\\(([\s\S]+?)\\\)|\\\[([\s\S]+?)\\\]|\$\$([\s\S]+?)\$\$|\$(?!\s)([^$\n]+?)(?<!\s)\$(?!\d)/g;

export type MathSegment = { text: string } | { math: string; display: boolean; raw: string };

export function splitMath(input: string): MathSegment[] {
  const out: MathSegment[] = [];
  let last = 0;
  for (const m of input.matchAll(MATH_DELIMITERS)) {
    const at = m.index ?? 0;
    if (at > last) out.push({ text: input.slice(last, at) });
    const [raw, paren, bracket, dollars, dollar] = m;
    out.push({
      math: (paren ?? bracket ?? dollars ?? dollar ?? "").trim(),
      display: bracket !== undefined || dollars !== undefined,
      raw,
    });
    last = at + raw.length;
  }
  if (last < input.length) out.push({ text: input.slice(last) });
  return out;
}

const SUPERSCRIPT: Record<string, string> = {
  "0": "⁰", "1": "¹", "2": "²", "3": "³", "4": "⁴", "5": "⁵", "6": "⁶", "7": "⁷", "8": "⁸", "9": "⁹",
  "+": "⁺", "-": "⁻", "=": "⁼", "(": "⁽", ")": "⁾", n: "ⁿ", i: "ⁱ", x: "ˣ", y: "ʸ",
};
const SUBSCRIPT: Record<string, string> = {
  "0": "₀", "1": "₁", "2": "₂", "3": "₃", "4": "₄", "5": "₅", "6": "₆", "7": "₇", "8": "₈", "9": "₉",
  "+": "₊", "-": "₋", "=": "₌", "(": "₍", ")": "₎",
  a: "ₐ", e: "ₑ", o: "ₒ", x: "ₓ", h: "ₕ", k: "ₖ", l: "ₗ", m: "ₘ", n: "ₙ", p: "ₚ", s: "ₛ", t: "ₜ",
};

const COMMANDS: Record<string, string> = {
  times: "×", div: "÷", cdot: "·", pm: "±", mp: "∓",
  leq: "≤", le: "≤", geq: "≥", ge: "≥", neq: "≠", ne: "≠", approx: "≈", equiv: "≡",
  infty: "∞", circ: "°", degree: "°", to: "→", rightarrow: "→", leftarrow: "←",
  Rightarrow: "⇒", rightleftharpoons: "⇌", leftrightarrow: "↔",
  alpha: "α", beta: "β", gamma: "γ", delta: "δ", Delta: "Δ", epsilon: "ε", theta: "θ",
  lambda: "λ", mu: "μ", pi: "π", rho: "ρ", sigma: "σ", Sigma: "Σ", tau: "τ",
  phi: "φ", omega: "ω", Omega: "Ω", angle: "∠", triangle: "△", perp: "⊥", parallel: "∥",
  ldots: "…", cdots: "⋯", "%": "%", ",": " ", ";": " ", ":": " ", " ": " ", "!": "",
};

function mapAll(s: string, table: Record<string, string>): string | null {
  let out = "";
  for (const ch of s) {
    const mapped = table[ch];
    if (mapped === undefined) return null;
    out += mapped;
  }
  return out;
}

/**
 * One maths expression as plain Unicode, or null when Unicode cannot write it
 * faithfully (fractions, roots of expressions, exponents with letters Unicode
 * has no superscript for). Null means "keep the LaTeX".
 */
export function latexToUnicode(expr: string): string | null {
  let s = expr;

  // Text wrappers carry plain words.
  s = s.replace(/\\(?:text|mathrm|mathbf|textbf|operatorname)\{([^{}]*)\}/g, "$1");
  // Degrees: 30^\circ, 30^{\circ}
  s = s.replace(/\^\{?\\circ\}?/g, "°");
  // √ of a single number or letter only — √(a+b) needs a real root bar.
  s = s.replace(/\\sqrt\{([0-9]+|[a-zA-Z])\}/g, "√$1");
  // Named commands and escaped symbols.
  s = s.replace(/\\([a-zA-Z]+|[%,;: !])/g, (whole, name: string) => COMMANDS[name] ?? whole);
  // Exponents and subscripts: x^2, x^{10}, H_2, x_{n+1}
  let failed = false;
  s = s.replace(/([\^_])(\{([^{}]*)\}|[0-9a-zA-Z+\-])/g, (_, mark: string, group: string, braced: string | undefined) => {
    const body = braced ?? group;
    const mapped = mapAll(body, mark === "^" ? SUPERSCRIPT : SUBSCRIPT);
    if (mapped === null) failed = true;
    return mapped ?? "";
  });
  if (failed) return null;

  // Anything LaTeX-shaped left over (\frac, \sqrt{a+b}, stray braces) cannot
  // be written in plain text.
  if (/[\\{}^_]/.test(s)) return null;
  return s.replace(/\s+/g, " ").trim();
}

/**
 * Convert every maths segment that plain Unicode can express, and bare
 * exponents written without delimiters (`7^5`, `x^{2}`). Segments Unicode
 * cannot express keep their original LaTeX, delimiters and all.
 */
export function normalizeMathText(input: string): string {
  if (!input) return input;
  return splitMath(input)
    .map((seg) => {
      if ("text" in seg) {
        // Bare exponents outside delimiters. Underscores are left alone:
        // outside maths they are fill-in blanks, not subscripts.
        // Covers 7^5, 10^-3, x^{2}, 4^(-2); leaves 27^(2/3) and a^(m-n),
        // which Unicode cannot write.
        return seg.text.replace(
          /(?<=[0-9a-zA-Z)\]])\^(?:\{([0-9+\-n]+)\}|\(([+\-]?[0-9]+)\)|([+\-]?[0-9]+))/g,
          (whole, braced?: string, paren?: string, plain?: string) =>
            mapAll(braced ?? paren ?? plain ?? "", SUPERSCRIPT) ?? whole
        );
      }
      return latexToUnicode(seg.math) ?? seg.raw;
    })
    .join("");
}

/** Maths notation still left after conversion — a caret or LaTeX delimiters. */
const UNCONVERTED = /\^|\\\(|\\\[/;

/**
 * Convert a question's options and answer TOGETHER. Options must all look
 * alike: converting 10^14 to 10¹⁴ while 10^-3 in the next option stays as-is
 * would mark options apart and give the answer away. So if any option keeps
 * notation that could not be converted, every option (and the answer, which
 * must keep matching them) is left exactly as it was.
 */
export function normalizeOptionSet(options: string[], answer: string): { options: string[]; answer: string } {
  const next = options.map(normalizeMathText);
  const changed = next.some((o, i) => o !== options[i]);
  if (changed && next.some((o) => UNCONVERTED.test(o))) return { options, answer };
  return { options: next, answer: normalizeMathText(answer) };
}

const SUPER_BACK: Record<string, string> = Object.fromEntries(Object.entries(SUPERSCRIPT).map(([k, v]) => [v, k]));
const SUB_BACK: Record<string, string> = Object.fromEntries(Object.entries(SUBSCRIPT).map(([k, v]) => [v, k]));

/**
 * A form of an answer that compares equal across notations, for grading typed
 * answers: `\(7^5\)`, `7^5` and `7⁵` all become `7^5`; `H₂O` and `H2O` both
 * become `h2o`. Case, spaces and trailing punctuation are ignored.
 */
export function answerKey(input: string): string {
  let out = "";
  let inSuper = false;
  for (const ch of normalizeMathText(input)) {
    const sup = SUPER_BACK[ch];
    if (sup !== undefined) {
      out += (inSuper ? "" : "^") + sup;
      inSuper = true;
      continue;
    }
    inSuper = false;
    out += SUB_BACK[ch] ?? ch;
  }
  return out.toLowerCase().replace(/[.,!?;:]/g, "").replace(/\s+/g, "").trim();
}

// ─── Display: plain-text maths Unicode cannot typeset ─────────────────────
//
// Two things survive as plain text but read badly: a fractional or symbolic
// exponent (`x^(1/2)`, which Unicode has no superscript for) and a Unicode root
// (`√x + 1`, where nothing shows whether the root covers the `+ 1`). For
// display only, these are turned into LaTeX so KaTeX draws a real superscript
// and a root bar over exactly its operand. Stored text is not changed.

/** What a root covers when unparenthesised: one number or one run of letters. */
const ROOT_OPERAND = /^(?:[0-9]+(?:\.[0-9]+)?|[A-Za-z]+)/;
/** What an exponent covers when unbracketed: one signed number or one letter. */
const EXP_OPERAND = /^[+\-−]?(?:[0-9]+(?:\.[0-9]+)?|[A-Za-z])/;
const BASE_CHAR = /[A-Za-z0-9.\u00B2\u00B3\u00B9\u2070-\u209C]/;

/** Index just past the bracket matching the one at `i`, or -1. */
function matchForward(s: string, i: number): number {
  const open = s[i];
  const close = open === "(" ? ")" : "}";
  let depth = 0;
  for (let j = i; j < s.length; j++) {
    if (s[j] === open) depth++;
    else if (s[j] === close && --depth === 0) return j + 1;
  }
  return -1;
}

/** The operand after a `√` or `^` at `i - 1`: its inner text and end index. */
function readOperand(s: string, i: number, root: boolean): { inner: string; end: number } | null {
  if (s[i] === "(" || s[i] === "{") {
    const end = matchForward(s, i);
    return end > 0 ? { inner: s.slice(i + 1, end - 1), end } : null;
  }
  const m = (root ? ROOT_OPERAND : EXP_OPERAND).exec(s.slice(i));
  return m ? { inner: m[0], end: i + m[0].length } : null;
}

const LATEX_ESCAPE: Record<string, string> = {
  "\\": "\\backslash ", "{": "\\{", "}": "\\}", "%": "\\%", "#": "\\#", "&": "\\&",
  $: "\\$", _: "\\_", "~": "\\sim ", "*": "\\cdot ", "×": "\\times ", "÷": "\\div ", "−": "-",
};

/** A plain-text maths fragment as LaTeX: √ → \sqrt{}, ^ → ^{}, Unicode scripts → ^{} / _{}. */
function plainToLatex(s: string): string {
  let out = "";
  for (let i = 0; i < s.length; ) {
    const ch = s[i];
    if (ch === "√" || ch === "^") {
      const op = readOperand(s, i + 1, ch === "√");
      if (op) {
        out += ch === "√" ? `\\sqrt{${plainToLatex(op.inner)}}` : `^{${plainToLatex(op.inner)}}`;
        i = op.end;
        continue;
      }
    }
    if (SUPER_BACK[ch] !== undefined || SUB_BACK[ch] !== undefined) {
      const sup = SUPER_BACK[ch] !== undefined;
      const table = sup ? SUPER_BACK : SUB_BACK;
      let run = "";
      while (i < s.length && table[s[i]] !== undefined) run += table[s[i++]];
      out += `${sup ? "^" : "_"}{${run}}`;
      continue;
    }
    out += LATEX_ESCAPE[ch] ?? ch;
    i++;
  }
  return out;
}

/** Where a `^` at `i` starts its base: a bracketed group or a run of word characters. */
function baseStart(s: string, i: number, floor: number): number {
  let j = i;
  if (s[j - 1] === ")") {
    let depth = 0;
    for (let k = j - 1; k >= floor; k--) {
      if (s[k] === ")") depth++;
      else if (s[k] === "(" && --depth === 0) return k;
    }
    return i;
  }
  while (j > floor && BASE_CHAR.test(s[j - 1])) j--;
  return j;
}

/** Split plain text into text and LaTeX segments for √ and non-Unicode exponents. */
function splitPlainMath(text: string): MathSegment[] {
  const spans: [number, number][] = [];
  for (let i = 0; i < text.length; ) {
    const ch = text[i];
    if (ch === "√" || ch === "^") {
      const op = readOperand(text, i + 1, ch === "√");
      if (op) {
        const floor = spans.length ? spans[spans.length - 1][1] : 0;
        const start = ch === "^" ? baseStart(text, i, floor) : i;
        // Adjacent pieces (x^(1/2)√y) form one expression.
        if (spans.length && spans[spans.length - 1][1] === start) spans[spans.length - 1][1] = op.end;
        else spans.push([start, op.end]);
        i = op.end;
        continue;
      }
    }
    i++;
  }
  const out: MathSegment[] = [];
  let last = 0;
  for (const [a, b] of spans) {
    if (a > last) out.push({ text: text.slice(last, a) });
    out.push({ math: plainToLatex(text.slice(a, b)), display: false, raw: text.slice(a, b) });
    last = b;
  }
  if (last < text.length) out.push({ text: text.slice(last) });
  return out;
}

/**
 * Segments to DISPLAY: delimited LaTeX as written, plus plain-text roots and
 * exponents typeset (see above). Display only — never store this.
 */
export function splitForDisplay(input: string): MathSegment[] {
  return splitMath(input).flatMap((seg) =>
    "text" in seg && /[√^]/.test(seg.text) ? splitPlainMath(seg.text) : [seg]
  );
}
