import { BookOpen, Flame, Home, Swords, Trophy, User, Zap } from "lucide-react";

/**
 * Static phone mock-up for the "mobile app — coming soon" section. Mirrors the
 * student mobile nav (Home, Quiz, Battle, Ranks, Profile). Markup only.
 */
export function AppPreview() {
  const tabs = [Home, BookOpen, Swords, Trophy, User];

  return (
    <div className="relative mx-auto w-[260px] sm:w-[280px]">
      {/* Frame */}
      <div className="rounded-[2.6rem] border border-[var(--lp-rule)] bg-[#0f1712] p-2.5 ring-1 ring-white/5 shadow-[0_30px_60px_-30px_rgba(19,32,26,0.55)]">
        <div className="relative overflow-hidden rounded-[2.1rem] bg-[var(--lp-bg)]">
          {/* Notch + status bar */}
          <div className="flex items-center justify-between px-6 pb-1 pt-3 text-[10px] font-semibold">
            <span>9:41</span>
            <span className="absolute left-1/2 top-2 h-5 w-20 -translate-x-1/2 rounded-full bg-[#0f1712]" />
            <span className="tabular-nums">86%</span>
          </div>

          <div className="space-y-3 px-4 pb-4 pt-3">
            <div>
              <p className="text-[11px] text-[var(--lp-muted)]">Good morning</p>
              <p className="lp-display text-xl font-semibold">Hana</p>
            </div>

            <div className="flex items-center gap-3 rounded-2xl bg-[var(--lp-green)] p-3 text-white">
              <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-white/15">
                <Flame className="h-5 w-5" aria-hidden />
              </span>
              <div className="text-xs">
                <p className="text-sm font-bold">12-day streak</p>
                <p className="opacity-80">Keep it going today</p>
              </div>
            </div>

            <div className="rounded-2xl border border-[var(--lp-rule)] bg-[var(--lp-surface)] p-3">
              <p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-[var(--lp-faint)]">
                Daily challenge
              </p>
              <p className="mt-1 text-sm font-semibold">Physics · 5 questions</p>
              <span className="mt-2.5 inline-flex items-center gap-1 rounded-full bg-[var(--lp-yellow)] px-3 py-1 text-[11px] font-bold text-[#13201a]">
                <Zap className="h-3 w-3" aria-hidden /> Start
              </span>
            </div>

            <div className="rounded-2xl border border-[var(--lp-rule)] bg-[var(--lp-surface)] p-3">
              <div className="flex justify-between text-xs">
                <span className="font-semibold">Biology · Unit 3</span>
                <span className="text-[var(--lp-muted)]">60%</span>
              </div>
              <div className="mt-2 h-1.5 rounded-full bg-[var(--lp-sunk)]">
                <div className="h-full w-3/5 rounded-full bg-[var(--lp-green)]" />
              </div>
            </div>
          </div>

          {/* Tab bar */}
          <div className="flex items-center justify-around border-t border-[var(--lp-rule)] bg-[var(--lp-surface)] px-2 pb-4 pt-2.5">
            {tabs.map((Icon, i) => (
              <Icon
                key={i}
                aria-hidden
                className={i === 0 ? "h-5 w-5 text-[var(--lp-green-ink)]" : "h-5 w-5 text-[var(--lp-faint)]"}
              />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
