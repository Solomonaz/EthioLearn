"use client";

import { Sun, Moon, Monitor } from "lucide-react";
import { useTheme } from "@/components/providers/theme-provider";
import { cn } from "@/lib/utils";

export function ThemeToggle() {
  const { theme, setTheme, resolvedTheme } = useTheme();

  return (
    <div className="flex items-center rounded-lg border border-border bg-background p-0.5">
      <button
        onClick={() => setTheme("light")}
        className={cn(
          "rounded-md p-1.5 transition-colors",
          theme === "light" ? "bg-primary/10 text-primary" : "text-text-muted hover:text-text-secondary"
        )}
        title="Light mode"
      >
        <Sun className="h-3.5 w-3.5" />
      </button>
      <button
        onClick={() => setTheme("dark")}
        className={cn(
          "rounded-md p-1.5 transition-colors",
          theme === "dark" ? "bg-primary/10 text-primary" : "text-text-muted hover:text-text-secondary"
        )}
        title="Dark mode"
      >
        <Moon className="h-3.5 w-3.5" />
      </button>
      <button
        onClick={() => setTheme("system")}
        className={cn(
          "rounded-md p-1.5 transition-colors",
          theme === "system" ? "bg-primary/10 text-primary" : "text-text-muted hover:text-text-secondary"
        )}
        title="System preference"
      >
        <Monitor className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}
