"use client";

import { Fragment, useMemo } from "react";
import katex from "katex";
import { splitForDisplay } from "@/lib/math-notation";
import "katex/dist/katex.min.css";

/**
 * Plain text with inline LaTeX rendered by KaTeX.
 *
 * Question text, options and explanations are plain strings that models write
 * with LaTeX math — `\(7^5\)`, `$\frac{a}{b}$`. Rendered as-is, students saw
 * the raw source ("\(7^5\)") in the quiz. MarkdownView handles math too, but
 * it wraps everything in block Markdown (paragraphs, lists), which breaks the
 * one-line layouts questions sit in; this renders ONLY the math and leaves
 * every other character untouched.
 *
 * Delimiters and the `$`-vs-price rule live in lib/math-notation. New
 * questions have simple maths converted to Unicode when saved, so this mostly
 * renders fractions, fractional exponents (x^(1/2)) and roots — a plain `√x + 1`
 * is drawn with a bar over exactly what the root covers.
 */
export function MathText({ text, className }: { text: string | null | undefined; className?: string }) {
  const segments = useMemo(() => splitForDisplay(text ?? ""), [text]);
  if (segments.every((s) => "text" in s)) {
    return className ? <span className={className}>{text}</span> : <>{text}</>;
  }
  return (
    <span className={className}>
      {segments.map((s, i) =>
        "text" in s ? (
          <Fragment key={i}>{s.text}</Fragment>
        ) : (
          <span
            key={i}
            // KaTeX's default 1.21em towers over the surrounding sans text.
            className="[&_.katex]:text-[1.05em]"
            // KaTeX escapes its input and, with `trust` off (the default),
            // emits no links, scripts or raw HTML from the expression.
            dangerouslySetInnerHTML={{
              __html: katex.renderToString(s.math, {
                displayMode: s.display,
                throwOnError: false,
                strict: false,
              }),
            }}
          />
        )
      )}
    </span>
  );
}
