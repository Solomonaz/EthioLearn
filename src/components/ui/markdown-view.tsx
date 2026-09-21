"use client";

import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import "katex/dist/katex.min.css";
import { cn } from "@/lib/utils";

/**
 * Renders AI-authored Markdown the way a teacher expects to see it.
 *
 * Two things it fixes that plain react-markdown does not:
 *
 * 1. MATHS. Models write physics and chemistry in LaTeX ($11.2\%$,
 *    $$\frac{a}{b}$$). Without remark-math + rehype-katex those render as raw
 *    source, which is unusable on a STEM platform. KaTeX renders them.
 *
 * 2. RAW <br>. Models reach for <br> inside Markdown table cells, because
 *    Markdown tables cannot hold a line break. react-markdown does not parse
 *    raw HTML (and enabling rehype-raw on model output would be an injection
 *    risk), so those tags used to render as literal "<br>" text. They are
 *    rewritten before parsing instead: a real newline outside tables, and a
 *    separator inside a table row, where a newline would break the table.
 */

/** Elements a model is allowed to produce. Raw HTML is never parsed. */
const ALLOWED = [
  "p", "strong", "em", "b", "i", "code", "pre", "ul", "ol", "li",
  "h1", "h2", "h3", "h4", "h5", "h6", "blockquote", "br", "hr",
  "a", "table", "thead", "tbody", "tr", "th", "td",
  // KaTeX output
  "span", "math", "semantics", "mrow", "mi", "mn", "mo", "msup", "msub",
  "mfrac", "msqrt", "mtext", "annotation",
];

const BR_TAG = /<br\s*\/?>/gi;

/**
 * Rewrite raw <br> tags into something Markdown can actually express.
 *
 * Inside a table row a newline would terminate the row, so those become a
 * separator; everywhere else they become a real line break.
 */
export function normalizeModelMarkdown(input: string): string {
  return input
    .split("\n")
    .map((line) => {
      if (!BR_TAG.test(line)) return line;
      BR_TAG.lastIndex = 0;
      // A table row is a line whose content sits between pipes.
      const isTableRow = /^\s*\|.*\|\s*$/.test(line);
      return line.replace(BR_TAG, isTableRow ? " · " : "  \n");
    })
    .join("\n");
}

export function MarkdownView({
  markdown,
  className,
}: {
  markdown: string;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "max-w-none text-sm leading-relaxed text-text-primary",
        "[&_h1]:mt-5 [&_h1]:text-lg [&_h1]:font-bold",
        "[&_h2]:mt-5 [&_h2]:text-base [&_h2]:font-bold",
        "[&_h3]:mt-4 [&_h3]:font-semibold",
        "[&_p]:my-2",
        "[&_ul]:my-2 [&_ul]:list-disc [&_ul]:pl-5",
        "[&_ol]:my-2 [&_ol]:list-decimal [&_ol]:pl-5",
        "[&_li]:my-1",
        "[&_blockquote]:border-l-2 [&_blockquote]:border-border [&_blockquote]:pl-3 [&_blockquote]:text-text-secondary",
        "[&_code]:rounded [&_code]:bg-border/40 [&_code]:px-1 [&_code]:py-0.5 [&_code]:text-[0.85em]",
        "[&_hr]:my-4 [&_hr]:border-border",
        // Tables scroll rather than forcing the page sideways on a phone.
        "[&_table]:my-3 [&_table]:block [&_table]:w-full [&_table]:overflow-x-auto [&_table]:border-collapse",
        "[&_th]:border [&_th]:border-border [&_th]:bg-border/30 [&_th]:px-2 [&_th]:py-1.5 [&_th]:text-left [&_th]:align-top",
        "[&_td]:border [&_td]:border-border [&_td]:px-2 [&_td]:py-1.5 [&_td]:align-top",
        className,
      )}
    >
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkMath]}
        rehypePlugins={[[rehypeKatex, { throwOnError: false, strict: false }]]}
        allowedElements={ALLOWED}
        unwrapDisallowed
      >
        {normalizeModelMarkdown(markdown)}
      </ReactMarkdown>
    </div>
  );
}
