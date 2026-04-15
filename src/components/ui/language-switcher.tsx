"use client";
import { useTransition, useEffect, useState } from "react";
import { cn } from "@/lib/utils";

function getLocaleFromCookie(): "en" | "am" {
  if (typeof document === "undefined") return "en";
  const match = document.cookie.match(/(?:^|;\s*)locale=(\w+)/);
  return match?.[1] === "am" ? "am" : "en";
}

export function LanguageSwitcher() {
  const [isPending, startTransition] = useTransition();
  const [active, setActive] = useState<"en" | "am">("en");

  useEffect(() => {
    setActive(getLocaleFromCookie());
  }, []);

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
