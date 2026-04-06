"use client";

import { useEffect, useRef, useCallback } from "react";
import { toast } from "sonner";

interface UseAntiCheatOptions {
  /** Called on the 2nd tab-switch violation (should submit/end the quiz). */
  onAutoSubmit: () => void;
  /** Whether to enable the hook (e.g. only while quiz is active). */
  enabled?: boolean;
}

/**
 * Anti-cheat hook that:
 *  1. Detects tab switching via `visibilitychange` / `blur`
 *     - 1st offence → warning toast
 *     - 2nd offence → calls onAutoSubmit()
 *  2. Disables copy, cut, paste, and contextmenu events on the page
 *     while the quiz is active.
 */
export function useAntiCheat({ onAutoSubmit, enabled = true }: UseAntiCheatOptions) {
  /** Track how many times the user has left the tab/window. */
  const violationCount = useRef(0);
  /** Stable reference so the effect always calls the latest version. */
  const onAutoSubmitRef = useRef(onAutoSubmit);
  useEffect(() => { onAutoSubmitRef.current = onAutoSubmit; }, [onAutoSubmit]);

  // ── Tab-switch / window-blur detection ──────────────────────────────────
  const handleVisibilityChange = useCallback(() => {
    if (!enabled) return;
    if (document.visibilityState === "hidden") {
      violationCount.current += 1;

      if (violationCount.current === 1) {
        toast.warning("⚠️ Warning: Tab switching detected!", {
          description:
            "Switching tabs or windows during a quiz is not allowed. " +
            "A second violation will auto-submit your quiz.",
          duration: 5000,
          id: "anticheat-tab-warning",
        });
      } else {
        // 2nd (or more) offence → auto-submit
        toast.error("🚫 Quiz auto-submitted due to tab switching.", {
          description: "You switched tabs more than once. Your answers have been submitted.",
          duration: 8000,
          id: "anticheat-auto-submit",
        });
        onAutoSubmitRef.current();
      }
    }
  }, [enabled]);

  useEffect(() => {
    if (!enabled) return;

    document.addEventListener("visibilitychange", handleVisibilityChange);
    // Also catch window blur (e.g. alt-tab to another application)
    window.addEventListener("blur", handleVisibilityChange);

    return () => {
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      window.removeEventListener("blur", handleVisibilityChange);
    };
  }, [enabled, handleVisibilityChange]);

  // ── Copy / Paste / Cut / ContextMenu prevention ─────────────────────────
  useEffect(() => {
    if (!enabled) return;

    const prevent = (e: Event) => {
      e.preventDefault();
      toast.info("Copy & paste is disabled during quizzes.", {
        duration: 2000,
        id: "anticheat-clipboard",
      });
    };

    // Suppress context menu so right-click copy is also blocked
    const preventContext = (e: Event) => e.preventDefault();

    document.addEventListener("copy", prevent);
    document.addEventListener("cut", prevent);
    document.addEventListener("paste", prevent);
    document.addEventListener("contextmenu", preventContext);

    return () => {
      document.removeEventListener("copy", prevent);
      document.removeEventListener("cut", prevent);
      document.removeEventListener("paste", prevent);
      document.removeEventListener("contextmenu", preventContext);
    };
  }, [enabled]);

  /** Expose a reset so the component can clear violation state (e.g. on submit). */
  const resetViolations = useCallback(() => {
    violationCount.current = 0;
  }, []);

  return { resetViolations };
}
