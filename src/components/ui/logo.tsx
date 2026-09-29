import { cn } from "@/lib/utils";
import {
  HEAD,
  LEFT_LEG,
  LEG_WIDTH,
  PAGE_LEFT,
  PAGE_RIGHT,
  RIGHT_LEG,
  SYMBOL_VIEWBOX,
  WORDMARK_PATH,
  WORDMARK_VIEWBOX,
} from "./logo-paths";

type LogoProps = {
  /** Hide the "Abugida" wordmark and render only the symbol. */
  iconOnly?: boolean;
  /** Visual size of the symbol + wordmark. */
  size?: "sm" | "md" | "lg";
  /** Use the light-on-dark colours regardless of theme (dark page sections). */
  onDark?: boolean;
  className?: string;
};

const SIZES = {
  sm: { symbol: "h-9 w-9", word: "h-[18px]" },
  md: { symbol: "h-11 w-11", word: "h-[21px]" },
  lg: { symbol: "h-14 w-14", word: "h-7" },
} as const;

/**
 * Abugida brand mark: an "A" arch sheltering a reader (yellow head) over an
 * open book — Abugida (አቡጊዳ) is the order of the Ethiopic script, where
 * traditional schooling began. The wordmark stays Latin in every locale: a
 * brand name, not translated copy.
 *
 * Drawn inline (not an <img>) so it follows the theme: dark mode and the
 * `onDark` sections swap to the lighter greens, and the thin cut around the
 * book always matches the background it sits on. Vector masters for print
 * and partners are in public/brand/.
 */
export function Logo({ iconOnly = false, size = "md", onDark = false, className }: LogoProps) {
  const s = SIZES[size];

  // Light colours by default; the lighter set on dark backgrounds.
  const legBack = onDark ? "stroke-[#43A047]" : "stroke-[#1B5E20] dark:stroke-[#43A047]";
  const legFront = onDark ? "stroke-[#66BB6A]" : "stroke-[#2E7D32] dark:stroke-[#66BB6A]";
  const pageL = onDark ? "fill-[#A5D6A7]" : "fill-[#66BB6A] dark:fill-[#A5D6A7]";
  const pageR = onDark ? "fill-[#81C784]" : "fill-[#43A047] dark:fill-[#81C784]";
  // The cut around the book and head takes the colour of whatever is behind.
  const gap = onDark ? "stroke-[#070b08]" : "stroke-surface";

  return (
    <span className={cn("inline-flex items-center gap-2", className)} aria-label="Abugida" role="img">
      <svg viewBox={SYMBOL_VIEWBOX} className={cn("shrink-0", s.symbol)} aria-hidden="true">
        <line {...LEFT_LEG} className={legBack} strokeWidth={LEG_WIDTH} strokeLinecap="round" />
        <line {...RIGHT_LEG} className={legFront} strokeWidth={LEG_WIDTH} strokeLinecap="round" />
        <g className={gap} strokeWidth={16} strokeLinejoin="round" style={{ paintOrder: "stroke" }}>
          <path d={PAGE_LEFT} className={pageL} />
          <path d={PAGE_RIGHT} className={pageR} />
        </g>
        <circle
          {...HEAD}
          className={cn("fill-[#FDD835]", gap)}
          strokeWidth={10}
          style={{ paintOrder: "stroke" }}
        />
      </svg>
      {!iconOnly && (
        <svg
          viewBox={WORDMARK_VIEWBOX}
          className={cn(
            "w-auto shrink-0",
            s.word,
            onDark ? "fill-white" : "fill-[#1B5E20] dark:fill-white",
          )}
          aria-hidden="true"
        >
          <path d={WORDMARK_PATH} />
        </svg>
      )}
    </span>
  );
}
