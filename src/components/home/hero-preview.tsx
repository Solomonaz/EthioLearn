import { Check, Swords } from "lucide-react";

/**
 * Static collage of real EthioLearn screens for the landing hero: a chapter
 * quiz, the grapher, and a live battle. Pure markup + SVG — no data, no JS.
 * Sample content stays in English, the medium of instruction.
 */
export function HeroPreview() {
  const options = [
    { key: "A", text: "Mitochondrion" },
    { key: "B", text: "Chloroplast", correct: true },
    { key: "C", text: "Ribosome" },
    { key: "D", text: "Nucleus" },
  ];

  return (
    <div className="relative grid w-full max-w-[520px] grid-cols-6 gap-3 sm:gap-4">
      {/* Quiz */}
      <div className="col-span-6 rounded-2xl border border-[var(--lp-rule)] bg-[var(--lp-surface)] p-5 shadow-[0_1px_0_var(--lp-rule),0_18px_40px_-24px_rgba(19,32,26,0.35)]">
        <div className="flex items-center justify-between text-[11px] font-semibold uppercase tracking-[0.08em] text-[var(--lp-faint)]">
          <span>Biology · Grade 9 · Unit 3</span>
          <span>4 / 10</span>
        </div>
        <p className="mt-3 text-[15px] font-semibold leading-snug">
          Which organelle carries out photosynthesis?
        </p>
        <ul className="mt-4 grid grid-cols-2 gap-2">
          {options.map((o) => (
            <li
              key={o.key}
              className={
                o.correct
                  ? "flex items-center gap-2 rounded-lg border border-[var(--lp-green)] bg-[var(--lp-green-soft)] px-3 py-2 text-sm font-semibold text-[var(--lp-green-ink)]"
                  : "flex items-center gap-2 rounded-lg border border-[var(--lp-rule)] px-3 py-2 text-sm text-[var(--lp-muted)]"
              }
            >
              <span className="text-xs opacity-70">{o.key}</span>
              <span className="flex-1">{o.text}</span>
              {o.correct && <Check className="h-4 w-4" aria-hidden />}
            </li>
          ))}
        </ul>
        <p className="mt-3 border-t border-dashed border-[var(--lp-rule)] pt-3 text-xs leading-relaxed text-[var(--lp-muted)]">
          <span className="font-semibold text-[var(--lp-ink)]">Why: </span>
          chloroplasts hold chlorophyll, which captures light energy to make glucose.
        </p>
      </div>

      {/* Grapher */}
      <div className="col-span-6 rounded-2xl border border-[var(--lp-rule)] bg-[var(--lp-surface)] p-4 sm:col-span-4">
        <div className="flex items-center gap-3 text-xs font-medium">
          <span className="inline-flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-full bg-[#2a78d6]" /> y = x² − 2
          </span>
          <span className="inline-flex items-center gap-1.5 text-[var(--lp-muted)]">
            <span className="h-2 w-2 rounded-full bg-[#eb6834]" /> y = x
          </span>
        </div>
        <svg viewBox="0 0 240 130" className="mt-2 h-auto w-full" role="img" aria-label="Graph of y equals x squared minus 2 and y equals x">
          <g stroke="var(--lp-rule)" strokeWidth="1">
            {[20, 40, 60, 80, 100, 140, 160, 180, 200, 220].map((x) => (
              <line key={`v${x}`} x1={x} y1="0" x2={x} y2="130" />
            ))}
            {[10, 30, 50, 90, 110].map((y) => (
              <line key={`h${y}`} x1="0" y1={y} x2="240" y2={y} />
            ))}
          </g>
          <g stroke="var(--lp-faint)" strokeWidth="1.2">
            <line x1="0" y1="70" x2="240" y2="70" />
            <line x1="120" y1="0" x2="120" y2="130" />
          </g>
          {/* y = x² − 2 at 20px per unit, origin (120,70): an exact quadratic Bézier */}
          <path
            d="M 60 -70 Q 120 290 180 -70"
            fill="none"
            stroke="#2a78d6"
            strokeWidth="2.5"
            strokeLinecap="round"
          />
          <line x1="50" y1="140" x2="190" y2="0" stroke="#eb6834" strokeWidth="2.5" strokeLinecap="round" />
          {/* intersections at x = −1 and x = 2 */}
          <circle cx="100" cy="90" r="3.5" fill="var(--lp-surface)" stroke="var(--lp-ink)" strokeWidth="1.5" />
          <circle cx="160" cy="30" r="3.5" fill="var(--lp-surface)" stroke="var(--lp-ink)" strokeWidth="1.5" />
        </svg>
      </div>

      {/* Battle */}
      <div className="col-span-6 hidden flex-col justify-between sm:flex rounded-2xl border border-[var(--lp-rule)] bg-[var(--lp-surface)] p-4 sm:col-span-2">
        <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.08em] text-[var(--lp-faint)]">
          <Swords className="h-3.5 w-3.5" aria-hidden /> Live battle
        </div>
        <ul className="mt-3 space-y-2.5 text-xs">
          {[
            { name: "Hana", score: 8, w: "80%" },
            { name: "Dawit", score: 7, w: "70%" },
          ].map((p, i) => (
            <li key={p.name}>
              <div className="flex justify-between font-semibold">
                <span>{p.name}</span>
                <span className="tabular-nums">{p.score}/10</span>
              </div>
              <div className="mt-1 h-1.5 rounded-full bg-[var(--lp-sunk)]">
                <div
                  className="h-full rounded-full"
                  style={{ width: p.w, background: i === 0 ? "var(--lp-green)" : "var(--lp-faint)" }}
                />
              </div>
            </li>
          ))}
        </ul>
        <p className="mt-3 text-[11px] text-[var(--lp-muted)]">Physics · Grade 11</p>
      </div>
    </div>
  );
}
