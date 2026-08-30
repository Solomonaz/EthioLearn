"use client";

import { Volume2, VolumeX } from "lucide-react";
import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";
import { useSound } from "@/hooks/use-sound";

/** Global mute / unmute toggle for the game audio (SFX + background music). */
export function SoundToggle({ className }: { className?: string }) {
  const { muted, toggleMuted } = useSound();
  const t = useTranslations("teacher");
  const label = muted ? t("soundUnmute") : t("soundMute");

  return (
    <button
      type="button"
      onClick={toggleMuted}
      aria-label={label}
      aria-pressed={muted}
      title={label}
      className={cn(
        "flex h-9 w-9 items-center justify-center rounded-xl text-text-secondary transition hover:bg-border/60 hover:text-text-primary",
        muted && "text-error",
        className,
      )}
    >
      {muted ? <VolumeX className="h-5 w-5" /> : <Volume2 className="h-5 w-5" />}
    </button>
  );
}
