"use client";
import { useTransition } from "react";
import { useLocale } from "next-intl";
import { cn } from "@/lib/utils";

export function LanguageSwitcher({ dark = false }: { dark?: boolean }) {
  const [isPending, startTransition] = useTransition();
  const active = useLocale() === "am" ? "am" : "en";

  const switchTo = (locale: "en" | "am") => {
    if (locale === active) return;
    startTransition(async () => {
      await fetch("/api/locale", { method: "POST", body: JSON.stringify({ locale }) });
      window.location.reload();
    });
  };

  const inactive = dark
    ? "text-white/70 hover:bg-white/10"
    : "hover:bg-primary/10";

  return (
    <div
      className={cn(
        "flex items-center gap-1 rounded-lg border p-0.5",
        dark ? "border-white/15" : "border-border"
      )}
    >
      <button
        onClick={() => switchTo("en")}
        disabled={isPending}
        className={cn(
          "rounded-md px-2 py-1 text-xs font-medium transition-colors",
          active === "en" ? "bg-primary text-white" : inactive
        )}
      >
        EN
      </button>
      <button
        onClick={() => switchTo("am")}
        disabled={isPending}
        className={cn(
          "rounded-md px-2 py-1 text-xs font-medium transition-colors",
          active === "am" ? "bg-primary text-white" : inactive
        )}
      >
        አማ
      </button>
    </div>
  );
}
