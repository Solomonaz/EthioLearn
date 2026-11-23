"use client";

import { cn } from "@/lib/utils";

/**
 * The Abugida guide as a character: the green guide avatar from the welcome
 * tour (with the white Abugida mark on its forehead), given a face, arms and a
 * handful of hand-drawn expressions. Pure SVG + CSS (animations live in
 * globals.css under "Guide mascot") — no generated images.
 */
export type MascotExpression =
  | "happy"
  | "shocked"
  | "sassy"
  | "concerned"
  | "thinking"
  | "proud";

const INK = "#0D3B12";
const PUPIL = "#111827";

function Eyes({ e }: { e: MascotExpression }) {
  if (e === "proud") {
    // Happy closed eyes: ^ ^
    return (
      <g stroke={PUPIL} strokeWidth={4} strokeLinecap="round" fill="none">
        <path d="M35 64 Q44 53 53 64" />
        <path d="M67 64 Q76 53 85 64" />
      </g>
    );
  }
  const big = e === "shocked";
  const rx = big ? 12 : 10;
  const ry = big ? 14 : 11.5;
  const pr = big ? 3.6 : 5.5;
  // Where the pupils look.
  const [dx, dy] =
    e === "thinking" ? [3, -5] : e === "sassy" ? [4, 1] : e === "concerned" ? [0, 3] : [1, 1];
  return (
    <g className="gm-blink">
      {[44, 76].map((cx) => (
        <g key={cx}>
          <ellipse cx={cx} cy={62} rx={rx} ry={ry} fill="#fff" stroke={INK} strokeWidth={2} />
          <circle cx={cx + dx} cy={62 + dy} r={pr} fill={PUPIL} />
          <circle cx={cx + dx + 1.8} cy={62 + dy - 2} r={big ? 1.2 : 1.8} fill="#fff" />
        </g>
      ))}
      {e === "sassy" && (
        // Half-closed, unimpressed lids.
        <g fill="#2E7D32" stroke={INK} strokeWidth={2}>
          <path d="M33 61 Q44 48 55 61 Z" />
          <path d="M65 61 Q76 48 87 61 Z" />
        </g>
      )}
    </g>
  );
}

function Brows({ e }: { e: MascotExpression }) {
  const d: Record<MascotExpression, [string, string]> = {
    happy: ["M35 46 Q44 42 53 46", "M67 46 Q76 42 85 46"],
    shocked: ["M33 40 Q44 33 55 40", "M65 40 Q76 33 87 40"],
    sassy: ["M35 42 Q44 35 53 41", "M67 48 L85 48"],
    concerned: ["M35 49 L53 43", "M67 43 L85 49"],
    thinking: ["M35 45 L53 46", "M67 43 Q76 37 85 42"],
    proud: ["M35 46 Q44 41 53 46", "M67 46 Q76 41 85 46"],
  };
  return (
    <g stroke={INK} strokeWidth={3.5} strokeLinecap="round" fill="none">
      <path d={d[e][0]} />
      <path d={d[e][1]} />
    </g>
  );
}

function Mouth({ e, talking }: { e: MascotExpression; talking: boolean }) {
  if (talking && e !== "shocked") {
    return (
      <g className="gm-talk">
        <ellipse cx={60} cy={86} rx={8} ry={6} fill="#4A0D0D" stroke={INK} strokeWidth={2} />
        <ellipse cx={60} cy={89} rx={4.5} ry={2.2} fill="#EF5350" />
      </g>
    );
  }
  switch (e) {
    case "shocked":
      return (
        <g>
          <ellipse cx={60} cy={88} rx={7.5} ry={10} fill="#4A0D0D" stroke={INK} strokeWidth={2} />
          <ellipse cx={60} cy={93} rx={4.5} ry={3} fill="#EF5350" />
        </g>
      );
    case "sassy":
      return <path d="M50 87 Q62 92 72 81" stroke={INK} strokeWidth={3.5} strokeLinecap="round" fill="none" />;
    case "concerned":
      return <path d="M49 90 Q54 85 60 88 Q66 91 71 86" stroke={INK} strokeWidth={3.5} strokeLinecap="round" fill="none" />;
    case "thinking":
      return <path d="M56 88 L71 86" stroke={INK} strokeWidth={3.5} strokeLinecap="round" />;
    case "proud":
      return (
        <g>
          <path d="M45 80 Q60 102 75 80 Z" fill="#4A0D0D" stroke={INK} strokeWidth={2} strokeLinejoin="round" />
          <path d="M52 91 Q60 96 68 91 Q60 87 52 91 Z" fill="#EF5350" />
        </g>
      );
    default:
      return <path d="M47 82 Q60 96 73 82" stroke={INK} strokeWidth={3.5} strokeLinecap="round" fill="none" />;
  }
}

function Arms({ e }: { e: MascotExpression }) {
  const arm = { stroke: INK, strokeWidth: 11, strokeLinecap: "round" as const, fill: "none" };
  const fill = { stroke: "#2E7D32", strokeWidth: 7, strokeLinecap: "round" as const, fill: "none" };
  const pair = (d: string, key: string) => (
    <g key={key}>
      <path d={d} {...arm} />
      <path d={d} {...fill} />
    </g>
  );
  switch (e) {
    case "shocked": // hands up in alarm
      return <>{pair("M20 72 L7 50", "l")}{pair("M100 72 L113 50", "r")}</>;
    case "proud": // arms up, celebrating
      return <>{pair("M20 70 L5 46", "l")}{pair("M100 70 L115 46", "r")}</>;
    case "sassy": // hand on hip, other hand up
      return <>{pair("M18 80 L6 90 L16 100", "l")}{pair("M102 74 L114 60", "r")}</>;
    case "thinking": // hand on chin
      return <>{pair("M18 82 L9 98", "l")}{pair("M102 84 L90 100 L76 98", "r")}</>;
    case "concerned": // hands together, worried
      return <>{pair("M20 84 L34 104", "l")}{pair("M100 84 L86 104", "r")}</>;
    default: // relaxed wave
      return <>{pair("M18 82 L9 98", "l")}<g className="gm-wave">{pair("M102 74 L114 56", "r")}</g></>;
  }
}

export function GuideMascot({
  expression = "happy",
  talking = false,
  size = 96,
  className,
  title,
}: {
  expression?: MascotExpression;
  talking?: boolean;
  size?: number;
  className?: string;
  /** Accessible label; decorative (hidden) when omitted. */
  title?: string;
}) {
  return (
    <svg
      viewBox="0 0 120 124"
      width={size}
      height={size}
      className={cn("gm-root overflow-visible", `gm-${expression}`, className)}
      role={title ? "img" : undefined}
      aria-label={title}
      aria-hidden={title ? undefined : true}
      data-expression={expression}
    >
      <defs>
        <radialGradient id="gm-body" cx="40%" cy="30%" r="75%">
          <stop offset="0%" stopColor="#4CAF50" />
          <stop offset="60%" stopColor="#2E7D32" />
          <stop offset="100%" stopColor="#1B5E20" />
        </radialGradient>
      </defs>
      {/* key = expression: replays the entrance animation on each change */}
      <g key={expression} className="gm-body">
        {/* feet */}
        <ellipse cx={45} cy={114} rx={11} ry={6} fill="#1B5E20" stroke={INK} strokeWidth={2} />
        <ellipse cx={75} cy={114} rx={11} ry={6} fill="#1B5E20" stroke={INK} strokeWidth={2} />
        <Arms e={expression} />
        {/* body */}
        <circle cx={60} cy={68} r={46} fill="url(#gm-body)" stroke={INK} strokeWidth={2.5} />
        {/* the Abugida mark on the forehead */}
        <g transform="translate(51 24) scale(0.0302) translate(-330 -210)">
          <line x1="412" y1="628" x2="628" y2="330" stroke="#fff" strokeWidth="60" strokeLinecap="round" />
          <line x1="628" y1="330" x2="844" y2="628" stroke="#fff" strokeWidth="60" strokeLinecap="round" />
          <path d="M 620 612 C 560 574 494 562 452 571 L 402 662 C 470 650 556 658 620 708 Z" fill="#fff" />
          <path d="M 636 612 C 696 574 762 562 804 571 L 854 662 C 786 650 700 658 636 708 Z" fill="#fff" />
          <circle cx="628" cy="522" r="48" fill="#fff" />
        </g>
        {/* cheeks */}
        {(expression === "happy" || expression === "proud" || expression === "sassy") && (
          <g fill="#F48FB1" opacity={0.7}>
            <ellipse cx={30} cy={80} rx={6} ry={3.5} />
            <ellipse cx={90} cy={80} rx={6} ry={3.5} />
          </g>
        )}
        <Brows e={expression} />
        <Eyes e={expression} />
        <Mouth e={expression} talking={talking} />
        {expression === "concerned" && (
          // a worried sweat drop
          <path d="M96 40 Q100 48 96 52 Q92 48 96 40 Z" fill="#90CAF9" stroke="#1E88E5" strokeWidth={1.5} />
        )}
        {expression === "thinking" && (
          <g fill={INK}>
            <circle cx={98} cy={30} r={2.5} className="gm-dot1" />
            <circle cx={106} cy={22} r={3} className="gm-dot2" />
            <circle cx={115} cy={12} r={3.5} className="gm-dot3" />
          </g>
        )}
        {expression === "proud" && (
          <g fill="#FBC02D" stroke="#F57F17" strokeWidth={1}>
            <path className="gm-spark" d="M12 22 l2.5 6 6 2.5 -6 2.5 -2.5 6 -2.5 -6 -6 -2.5 6 -2.5z" />
            <path className="gm-spark gm-spark2" d="M106 28 l2 5 5 2 -5 2 -2 5 -2 -5 -5 -2 5 -2z" />
          </g>
        )}
        {expression === "shocked" && (
          <g stroke="#E53935" strokeWidth={3} strokeLinecap="round">
            <path d="M14 30 L20 38" />
            <path d="M8 44 L17 46" />
            <path d="M106 30 L100 38" />
            <path d="M112 44 L103 46" />
          </g>
        )}
      </g>
    </svg>
  );
}

/** The guide with a speech bubble beside it — for short, canned reactions. */
export function GuideSays({
  expression,
  children,
  size = 64,
  className,
}: {
  expression: MascotExpression;
  children: React.ReactNode;
  size?: number;
  className?: string;
}) {
  return (
    <div className={cn("flex items-center gap-2", className)} data-testid="guide-says" data-expression={expression}>
      <GuideMascot expression={expression} size={size} className="shrink-0" />
      <div className="wb-pop relative min-w-0 rounded-2xl border border-border bg-surface px-3 py-2 text-sm font-semibold text-text-primary shadow-sm">
        <span className="absolute -left-1.5 top-1/2 h-3 w-3 -translate-y-1/2 rotate-45 border-b border-l border-border bg-surface" />
        <span className="relative">{children}</span>
      </div>
    </div>
  );
}
