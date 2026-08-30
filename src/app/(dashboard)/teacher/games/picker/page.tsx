"use client";

import { useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { Shuffle, RotateCcw, Dice5, Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";
import { useSound, useBackgroundMusic } from "@/hooks/use-sound";

/**
 * Random Picker — a free classroom hook. The teacher pastes a list (students,
 * teams, or questions) and picks one fairly on the shared screen. Pure local
 * state; no persistence. Playful, kid-friendly styling anchored by the brand.
 */
export default function RandomPickerPage() {
  const t = useTranslations("teacher");
  const { playSfx } = useSound();
  useBackgroundMusic("picker");
  const [raw, setRaw] = useState("");
  const [selected, setSelected] = useState<string | null>(null);
  const [spinning, setSpinning] = useState(false);
  const [display, setDisplay] = useState("");
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  const items = raw
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean);

  const pick = () => {
    if (items.length < 2 || spinning) return;
    playSfx("click");
    setSpinning(true);
    setSelected(null);
    let ticks = 0;
    const total = 18 + Math.floor(Math.random() * 8);
    timer.current = setInterval(() => {
      setDisplay(items[Math.floor(Math.random() * items.length)]);
      playSfx("click"); // ratchet tick as names fly by (throttled internally)
      ticks += 1;
      if (ticks >= total) {
        if (timer.current) clearInterval(timer.current);
        const winner = items[Math.floor(Math.random() * items.length)];
        setDisplay(winner);
        setSelected(winner);
        setSpinning(false);
        playSfx("levelWin");
      }
    }, 80);
  };

  const reset = () => {
    if (timer.current) clearInterval(timer.current);
    setSelected(null);
    setDisplay("");
    setSpinning(false);
  };

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      {/* playful hero header (amber — the picker's identity colour) */}
      <div
        className="relative overflow-hidden rounded-3xl p-6 shadow-md"
        style={{ backgroundImage: "linear-gradient(135deg,#EA580C,#FB923C)" }}
      >
        <div className="pointer-events-none absolute -right-8 -top-8 h-32 w-32 rounded-full bg-white/15" />
        <div className="pointer-events-none absolute -bottom-10 left-24 h-28 w-28 rounded-full bg-black/10" />
        <div className="relative flex items-center gap-4">
          <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-white/25 backdrop-blur-sm">
            <Dice5 className="h-8 w-8 text-white" />
          </div>
          <div>
            <h1 className="text-2xl font-extrabold text-white sm:text-3xl">
              {t("pickerHeading")} 🎲
            </h1>
            <p className="mt-0.5 text-sm font-medium text-white/85">{t("pickerSub")}</p>
          </div>
        </div>
      </div>

      <div className="grid gap-5 md:grid-cols-2">
        {/* list input */}
        <div className="rounded-3xl border border-border bg-surface p-5 shadow-sm">
          <label className="mb-2 block text-sm font-bold text-text-primary">
            {t("pickerHeading")}
          </label>
          <textarea
            value={raw}
            onChange={(e) => setRaw(e.target.value)}
            rows={9}
            placeholder={t("pickerPlaceholder")}
            className="w-full resize-none rounded-2xl border border-border bg-background px-4 py-3 text-text-primary outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/20"
          />
          <span className="mt-2 inline-flex items-center gap-1.5 rounded-full bg-primary/10 px-3 py-1 text-xs font-bold text-primary">
            <Sparkles className="h-3.5 w-3.5" /> {t("itemsCount", { count: items.length })}
          </span>
        </div>

        {/* picker stage */}
        <div className="flex min-h-[18rem] flex-col items-center justify-center gap-5 rounded-3xl border border-border bg-surface p-6 text-center shadow-sm">
          <div
            className={cn(
              "flex w-full flex-1 items-center justify-center rounded-2xl px-4 py-8 text-3xl font-extrabold transition-all sm:text-4xl",
              selected
                ? "bg-primary/10 text-primary ring-2 ring-primary"
                : spinning
                  ? "bg-secondary/15 text-text-primary"
                  : "bg-background text-text-muted",
            )}
          >
            <span className={cn(spinning && "animate-pulse")}>{display || "🎯"}</span>
          </div>

          {selected && (
            <p className="inline-flex items-center gap-1.5 text-sm font-bold text-primary">
              🎉 {t("selected")}
            </p>
          )}

          <div className="flex w-full items-center justify-center gap-2">
            <button
              onClick={pick}
              disabled={items.length < 2 || spinning}
              className="inline-flex flex-1 items-center justify-center gap-2 rounded-full bg-primary px-5 py-3 text-base font-bold text-white shadow-sm transition hover:bg-primary-dark active:scale-95 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <Shuffle className={cn("h-5 w-5", spinning && "animate-spin")} />
              {spinning ? t("picking") : selected ? t("pickAgain") : t("pick")}
            </button>
            {(selected || display) && (
              <button
                onClick={reset}
                className="inline-flex items-center justify-center gap-2 rounded-full border border-border bg-surface px-4 py-3 text-sm font-bold text-text-secondary transition hover:bg-border active:scale-95"
              >
                <RotateCcw className="h-5 w-5" />
              </button>
            )}
          </div>

          {items.length < 2 && <p className="text-sm text-text-muted">{t("needTwo")}</p>}
        </div>
      </div>
    </div>
  );
}
