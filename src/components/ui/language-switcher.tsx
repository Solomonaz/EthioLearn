"use client";
import { useTransition } from "react";
import { useLocale } from "next-intl";
import { cn } from "@/lib/utils";

export function LanguageSwitcher() {
  const [isPending, startTransition] = useTransition();
  const active = useLocale() === "am" ? "am" : "en";

  const switchTo = (locale: "en" | "am") => {
    if (locale === active) return;
    startTransition(async () => {
      await fetch("/api/locale", { method: "POST", body: JSON.stringify({ locale }) });
      window.location.reload();
    });
  };

  return (
    <div className="flex items-center gap-1 rounded-lg border border-border p-0.5">
      <button
        onClick={() => switchTo("en")}
        disabled={isPending}
        className={cn(
          "rounded-md px-2 py-1 text-xs font-medium transition-colors",
          active === "en"
            ? "bg-primary text-white"
            : "hover:bg-primary/10"
        )}
      >
        EN
      </button>
      <button
        onClick={() => switchTo("am")}
        disabled={isPending}
        className={cn(
          "rounded-md px-2 py-1 text-xs font-medium transition-colors",
          active === "am"
            ? "bg-primary text-white"
            : "hover:bg-primary/10"
        )}
      >
        አማ
      </button>
    </div>
  );
}
