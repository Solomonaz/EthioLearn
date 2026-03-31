"use client";
import { useTransition } from "react";

export function LanguageSwitcher() {
  const [isPending, startTransition] = useTransition();

  const switchTo = (locale: "en" | "am") => {
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
        className="rounded-md px-2 py-1 text-xs font-medium transition-colors hover:bg-primary/10"
      >
        EN
      </button>
      <button
        onClick={() => switchTo("am")}
        disabled={isPending}
        className="rounded-md px-2 py-1 text-xs font-medium transition-colors hover:bg-primary/10"
      >
        አማ
      </button>
    </div>
  );
}
