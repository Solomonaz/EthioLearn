"use client";

import { useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { Shuffle, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";

/**
 * Random Picker — a free classroom hook. The teacher pastes a list (students,
 * teams, or questions) and picks one fairly on the shared screen. Pure local
 * state; no persistence.
 */
export default function RandomPickerPage() {
  const t = useTranslations("teacher");
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
    setSpinning(true);
    setSelected(null);
    let ticks = 0;
    const total = 18 + Math.floor(Math.random() * 8);
    timer.current = setInterval(() => {
      setDisplay(items[Math.floor(Math.random() * items.length)]);
      ticks += 1;
      if (ticks >= total) {
        if (timer.current) clearInterval(timer.current);
        const winner = items[Math.floor(Math.random() * items.length)];
        setDisplay(winner);
        setSelected(winner);
        setSpinning(false);
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
    <div className="mx-auto max-w-3xl space-y-5">
      <div>
        <h1 className="text-2xl font-bold text-text-primary sm:text-3xl">{t("pickerHeading")}</h1>
        <p className="mt-1 text-text-secondary">{t("pickerSub")}</p>
      </div>

      <div className="grid gap-5 md:grid-cols-2">
        <div>
          <textarea
            value={raw}
            onChange={(e) => setRaw(e.target.value)}
            rows={10}
            placeholder={t("pickerPlaceholder")}
            className="w-full resize-none rounded-lg border border-border bg-surface px-4 py-3 text-text-primary outline-none focus:border-primary focus:ring-1 focus:ring-primary"
          />
          <p className="mt-1 text-sm text-text-muted">{t("itemsCount", { count: items.length })}</p>
        </div>

        <Card className="flex min-h-[16rem] flex-col items-center justify-center gap-4 p-6 text-center">
          <div
            className={`text-3xl font-extrabold sm:text-4xl ${
              selected ? "text-primary" : spinning ? "text-text-primary" : "text-text-muted"
            }`}
          >
            {display || "—"}
          </div>
          {selected && <p className="text-sm font-semibold text-text-secondary">{t("selected")}</p>}
          <div className="flex items-center gap-2">
            <Button onClick={pick} isLoading={spinning} disabled={items.length < 2}>
              <Shuffle className="h-4 w-4" /> {spinning ? t("picking") : selected ? t("pickAgain") : t("pick")}
            </Button>
            {(selected || display) && (
              <Button variant="outline" onClick={reset}>
                <RotateCcw className="h-4 w-4" /> {t("reset")}
              </Button>
            )}
          </div>
          {items.length < 2 && <p className="text-sm text-text-muted">{t("needTwo")}</p>}
        </Card>
      </div>
    </div>
  );
}
