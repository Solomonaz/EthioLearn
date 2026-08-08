import { GraduationCap } from "lucide-react";
import { cn } from "@/lib/utils";

type LogoProps = {
  /** Hide the "EthioLearn" wordmark and render only the icon mark. */
  iconOnly?: boolean;
  /** Visual size of the mark + wordmark. */
  size?: "sm" | "md" | "lg";
  /** Recolour the wordmark + accent ring for a dark background. */
  onDark?: boolean;
  className?: string;
};

const SIZES = {
  sm: { box: "h-8 w-8 rounded-lg", icon: "h-4 w-4", dot: "h-2 w-2", word: "text-lg" },
  md: { box: "h-9 w-9 rounded-xl", icon: "h-5 w-5", dot: "h-2.5 w-2.5", word: "text-2xl" },
  lg: { box: "h-12 w-12 rounded-2xl", icon: "h-7 w-7", dot: "h-3 w-3", word: "text-3xl" },
} as const;

/**
 * EthioLearn brand mark: a graduation-cap badge in Ethiopian green with a
 * yellow "spark" accent, next to the two-tone wordmark. The wordmark stays
 * Latin ("EthioLearn") in every locale — a brand name, not translated copy.
 */
export function Logo({ iconOnly = false, size = "md", onDark = false, className }: LogoProps) {
  const s = SIZES[size];
  return (
    <span className={cn("inline-flex items-center gap-2.5", className)} aria-label="EthioLearn">
      <span
        className={cn(
          "relative inline-flex shrink-0 items-center justify-center bg-gradient-to-br from-primary to-[#2E7D32] shadow-sm",
          s.box
        )}
      >
        <GraduationCap className={cn("text-white", s.icon)} strokeWidth={2.5} aria-hidden="true" />
        <span
          className={cn(
            "absolute -right-0.5 -top-0.5 rounded-full bg-[#FDD835] ring-2",
            onDark ? "ring-[#070b08]" : "ring-surface",
            s.dot
          )}
          aria-hidden="true"
        />
      </span>
      {!iconOnly && (
        <span className={cn("font-black tracking-tight", s.word)}>
          <span className={onDark ? "text-primary-light" : "text-primary"}>Ethio</span>
          <span className={onDark ? "text-white" : "text-text-primary"}>Learn</span>
        </span>
      )}
    </span>
  );
}
