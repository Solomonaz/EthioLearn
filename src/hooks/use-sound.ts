"use client";

import { useCallback, useEffect, useSyncExternalStore } from "react";
import {
  soundManager,
  type MusicKey,
  type SfxKey,
} from "@/lib/audio/sound-manager";

/**
 * Access the game audio engine: fire SFX and read/toggle the global mute.
 * The mute flag is shared across the whole app via the manager's subscription.
 */
export function useSound() {
  useEffect(() => {
    soundManager.init();
  }, []);

  const muted = useSyncExternalStore(
    soundManager.subscribe,
    () => soundManager.isMuted(),
    () => false, // server snapshot
  );

  const playSfx = useCallback((key: SfxKey) => soundManager.playSfx(key), []);
  const toggleMuted = useCallback(() => soundManager.toggleMuted(), []);

  return { muted, playSfx, toggleMuted };
}

/**
 * Loop a game's background track for the lifetime of the calling component.
 * Starts (after the autoplay unlock) on mount and stops on unmount.
 */
export function useBackgroundMusic(key: MusicKey) {
  useEffect(() => {
    soundManager.init();
    soundManager.playMusic(key);
    return () => soundManager.stopMusic();
  }, [key]);
}
