/**
 * Export a piece of teaching material as a Word document.
 *
 * The source is the same Markdown the screen renders, so this walks a small,
 * deliberate subset: headings, paragraphs, bullet and numbered lists, tables,
 * blockquotes, horizontal rules, and inline bold/italic/code.
 *
 * Maths is a known limitation. KaTeX typesets on screen, but Word has no
 * equivalent, so `$...$` is unwrapped to its readable source (\times becomes ×,
 * \frac{a}{b} becomes a/b) rather than shipped as raw LaTeX. Printing to PDF
 * keeps the typeset version — that is the trade-off, and it is why both
 * options exist.
 */

interface InlineRun {
  text: string;
  bold?: boolean;
  italics?: boolean;
  code?: boolean;
}

/** A handful of LaTeX commands worth rendering readably in a Word file. */
const MATH_REPLACEMENTS: [RegExp, string][] = [
  [/\\text\{([^}]*)\}/g, "$1"],
  [/\\mathrm\{([^}]*)\}/g, "$1"],
  [/\\frac\{([^}]*)\}\{([^}]*)\}/g, "($1)/($2)"],
  [/\\sqrt\{([^}]*)\}/g, "√($1)"],
  [/\\times/g, "×"],
  [/\\cdot/g, "·"],
  [/\\div/g, "÷"],
  [/\\pm/g, "±"],
  [/\\leq/g, "≤"],
  [/\\geq/g, "≥"],
  [/\\neq/g, "≠"],
  [/\\approx/g, "≈"],
  [/\\rightarrow|\\to/g, "→"],
  [/\\alpha/g, "α"],
  [/\\beta/g, "β"],
  [/\\theta/g, "θ"],
  [/\\lambda/g, "λ"],
  [/\\mu/g, "μ"],
  [/\\pi/g, "π"],
  [/\\Delta/g, "Δ"],
  [/\\degree|\\circ/g, "°"],
  [/\\quad|\\,|\\;|\\!/g, " "],
  [/\\left|\\right/g, ""],
  [/\\\\/g, " "],
  // LaTeX escapes for characters that are literal in ordinary prose.
  [/\\ /g, " "],
  [/\\([%&_#${}])/g, "$1"],
];

/** Turn a LaTeX fragment into something a reader can follow in plain text. */
function flattenMath(latex: string): string {
  let out = latex;
  for (const [pattern, replacement] of MATH_REPLACEMENTS) {
    out = out.replace(pattern, replacement);
  }
  // Subscripts and superscripts: x^{2} → x^2, H_2 stays H_2.
  out = out.replace(/\^\{([^}]*)\}/g, "^$1").replace(/_\{([^}]*)\}/g, "_$1");
  return out.replace(/\s+/g, " ").trim();
}

/** Strip the maths delimiters, leaving readable content behind. */
export function unwrapMath(text: string): string {
  return (
    text
      .replace(/\$\$([\s\S]+?)\$\$/g, (_m, inner) => flattenMath(inner))
      .replace(/\$([^$\n]+?)\$/g, (_m, inner) => flattenMath(inner))
      // Escapes that leaked outside the maths delimiters. Markdown uses the
      // same backslash escaping, so unescaping these reads correctly either way.
      .replace(/\\([%&_#*])/g, "$1")
  );
}

/** Split a line of Markdown into bold/italic/code runs. */
function parseInline(line: string): InlineRun[] {
  const runs: InlineRun[] = [];
  // Order matters: ** before *, so bold is not eaten by italics.
  const pattern = /(\*\*[^*]+\*\*|__[^_]+__|\*[^*]+\*|_[^_]+_|`[^`]+`)/g;
  let last = 0;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(line)) !== null) {
    if (match.index > last) {
      runs.push({ text: line.slice(last, match.index) });
    }
    const token = match[0];
    if (token.startsWith("**") || token.startsWith("__")) {
      runs.push({ text: token.slice(2, -2), bold: true });
    } else if (token.startsWith("`")) {
      runs.push({ text: token.slice(1, -1), code: true });
    } else {
      runs.push({ text: token.slice(1, -1), italics: true });
    }
    last = match.index + token.length;
  }
  if (last < line.length) runs.push({ text: line.slice(last) });

  return runs.length > 0 ? runs : [{ text: line }];
}

/** Cells of a Markdown table row, without the outer pipes. */
function splitRow(line: string): string[] {
  return line
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((c) => c.trim());
}

const SEPARATOR_ROW = /^\s*\|?[\s:-]+\|[\s|:-]*$/;

/**
 * Build a .docx Blob from Markdown.
 *
 * The `docx` library is imported dynamically so its ~1MB never lands in the
 * initial page bundle — a teacher who never exports should not pay for it.
 */
export async function markdownToDocxBlob(title: string, markdown: string): Promise<Blob> {
  const {
    Document,
    Packer,
    Paragraph,
    TextRun,
    HeadingLevel,
    Table,
    TableRow,
    TableCell,
    WidthType,
    AlignmentType,
    BorderStyle,
  } = await import("docx");

  const source = unwrapMath(markdown);
  const lines = source.split("\n");
  const children: object[] = [];

  const runsFor = (text: string) =>
    parseInline(text).map(
      (r) =>
        new TextRun({
          text: r.text,
          bold: r.bold,
          italics: r.italics,
          font: r.code ? "Consolas" : undefined,
        }),
    );

  children.push(
    new Paragraph({ text: title, heading: HeadingLevel.TITLE, spacing: { after: 200 } }),
  );

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    const line = raw.trim();

    if (!line) continue;

    // ── Table: a pipe row followed by a separator row ──────────────────
    if (/^\|.*\|$/.test(line) && SEPARATOR_ROW.test(lines[i + 1] ?? "")) {
      const header = splitRow(line);
      const bodyRows: string[][] = [];
      let j = i + 2;
      while (j < lines.length && /^\s*\|.*\|\s*$/.test(lines[j])) {
        bodyRows.push(splitRow(lines[j]));
        j++;
      }
      i = j - 1;

      const makeRow = (cells: string[], bold: boolean) =>
        new TableRow({
          children: cells.map(
            (c) =>
              new TableCell({
                children: [
                  new Paragraph({
                    children: parseInline(c).map(
                      (r) => new TextRun({ text: r.text, bold: bold || r.bold, italics: r.italics }),
                    ),
                  }),
                ],
              }),
          ),
        });

      children.push(
        new Table({
          width: { size: 100, type: WidthType.PERCENTAGE },
          rows: [
            makeRow(header, true),
            ...bodyRows.map((r) => makeRow(r, false)),
          ],
        }),
      );
      children.push(new Paragraph({ text: "" }));
      continue;
    }

    // ── Horizontal rule ────────────────────────────────────────────────
    if (/^(-{3,}|\*{3,}|_{3,})$/.test(line)) {
      children.push(
        new Paragraph({
          text: "",
          border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: "999999", space: 1 } },
        }),
      );
      continue;
    }

    // ── Headings ───────────────────────────────────────────────────────
    const heading = line.match(/^(#{1,6})\s+(.*)$/);
    if (heading) {
      const level = heading[1].length;
      const levels = [
        HeadingLevel.HEADING_1,
        HeadingLevel.HEADING_2,
        HeadingLevel.HEADING_3,
        HeadingLevel.HEADING_4,
        HeadingLevel.HEADING_5,
        HeadingLevel.HEADING_6,
      ];
      children.push(
        new Paragraph({
          children: runsFor(heading[2]),
          heading: levels[Math.min(level, 6) - 1],
          spacing: { before: 200, after: 100 },
        }),
      );
      continue;
    }

    // ── Blockquote ─────────────────────────────────────────────────────
    const quote = line.match(/^>\s?(.*)$/);
    if (quote) {
      children.push(
        new Paragraph({
          children: runsFor(quote[1]).map(
            (r) => new TextRun({ ...(r as unknown as object), italics: true } as never),
          ),
          indent: { left: 360 },
        }),
      );
      continue;
    }

    // ── Lists ──────────────────────────────────────────────────────────
    const bullet = line.match(/^[-*•]\s+(.*)$/);
    if (bullet) {
      children.push(
        new Paragraph({ children: runsFor(bullet[1]), bullet: { level: 0 } }),
      );
      continue;
    }

    const numbered = line.match(/^(\d+)[.)]\s+(.*)$/);
    if (numbered) {
      // Rendered with its own number rather than Word numbering, so a list
      // that starts at 7 in the source still reads as 7.
      children.push(
        new Paragraph({
          children: [
            new TextRun({ text: `${numbered[1]}. `, bold: true }),
            ...runsFor(numbered[2]),
          ],
          indent: { left: 360 },
        }),
      );
      continue;
    }

    // ── Plain paragraph ────────────────────────────────────────────────
    children.push(
      new Paragraph({ children: runsFor(line), alignment: AlignmentType.LEFT }),
    );
  }

  const doc = new Document({ sections: [{ children: children as never[] }] });
  return Packer.toBlob(doc);
}

/** Turn a title into a safe, readable file name (without extension). */
export function safeFileBase(title: string): string {
  return (
    title
      .trim()
      .replace(/[^\w\s-]/g, "")
      .replace(/\s+/g, "-")
      .slice(0, 60) || "teaching-material"
  );
}
