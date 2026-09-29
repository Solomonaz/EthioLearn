/**
 * Central audio engine for the teacher games.
 *
 * Design goals (see the feature request):
 *  - No performance lag: short SFX are preloaded into small pooled
 *    <audio> elements and reused round-robin, so rapid taps never allocate.
 *  - Autoplay-policy safe: nothing plays until the first real user gesture
 *    (pointer/keydown/touch) unlocks playback and the AudioContext.
 *  - No overlap glitches: a per-sound throttle + a fixed-size pool cap the
 *    number of concurrent copies of any one effect.
 *  - Graceful degradation: if an .mp3 is missing, SFX fall back to a tiny
 *    Web-Audio synthesised tone, and background music simply stays silent —
 *    so the games work before any asset files are added.
 *  - Global mute: one flag, persisted to localStorage, with a subscribe()
 *    channel so React toggles stay in sync.
 *
 * This module is a browser-only singleton; every entry point guards against
 * SSR (`typeof window === "undefined"`).
 */

export type SfxKey = "correct" | "wrong" | "click" | "levelWin";
export type MusicKey =
  | "tug"
  | "memory"
  | "routing"
  | "find-color"
  | "find-pair"
  | "picker";

const SFX_SRC: Record<SfxKey, string> = {
  correct: "/audio/sfx/correct.mp3",
  wrong: "/audio/sfx/wrong.mp3",
  click: "/audio/sfx/click.mp3",
  levelWin: "/audio/sfx/level-win.mp3",
};

/** Per-game background tracks — deliberately different moods per game. */
const MUSIC_SRC: Record<MusicKey, string> = {
  tug: "/audio/music/tug.mp3",
  memory: "/audio/music/memory.mp3",
  routing: "/audio/music/routing.mp3",
  "find-color": "/audio/music/find-color.mp3",
  "find-pair": "/audio/music/find-pair.mp3",
  picker: "/audio/music/picker.mp3",
};

const SFX_VOLUME: Record<SfxKey, number> = {
  correct: 0.55,
  wrong: 0.5,
  click: 0.32,
  levelWin: 0.7,
};

const MUSIC_VOLUME = 0.25; // low baseline loop (20–30%)
const POOL_SIZE = 3; // concurrent copies allowed per effect
const THROTTLE_MS = 45; // min gap between two triggers of the SAME effect
const MUTE_KEY = "abugida.audio.muted";

class SoundManager {
  private initialized = false;
  private unlocked = false;
  private muted = false;

  private pools: Partial<Record<SfxKey, HTMLAudioElement[]>> = {};
  private poolIdx: Partial<Record<SfxKey, number>> = {};
  private lastPlay: Partial<Record<SfxKey, number>> = {};
  private sfxUnavailable: Partial<Record<SfxKey, boolean>> = {};

  private music: HTMLAudioElement | null = null;
  private currentMusic: MusicKey | null = null;
  private desiredMusic: MusicKey | null = null;
  private fadeTimer: ReturnType<typeof setInterval> | null = null;

  private ctx: AudioContext | null = null;
  private listeners = new Set<() => void>();

  /** Wire the one-time "unlock on first gesture" listener + restore mute. */
  init() {
    if (this.initialized || typeof window === "undefined") return;
    this.initialized = true;
    try {
      this.muted = localStorage.getItem(MUTE_KEY) === "1";
    } catch {
      /* storage unavailable */
    }
    const unlock = () => this.unlock();
    (["pointerdown", "keydown", "touchstart"] as const).forEach((evt) =>
      window.addEventListener(evt, unlock, { once: true, passive: true }),
    );
    this.emit(); // publish the restored mute state to subscribers
  }

  // ── Subscriptions (for React's useSyncExternalStore) ─────────
  subscribe = (cb: () => void) => {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  };
  private emit() {
    this.listeners.forEach((l) => l());
  }

  isMuted() {
    return this.muted;
  }
  toggleMuted() {
    this.setMuted(!this.muted);
  }
  setMuted(next: boolean) {
    this.muted = next;
    try {
      localStorage.setItem(MUTE_KEY, next ? "1" : "0");
    } catch {
      /* ignore */
    }
    if (next) {
      // Pause music but keep `desiredMusic` so unmute can resume it.
      this.stopMusicElement();
    } else if (this.desiredMusic) {
      this.playMusic(this.desiredMusic);
    }
    this.emit();
  }

  /** Called from the first user gesture (and defensively before any play). */
  private unlock() {
    if (this.unlocked || typeof window === "undefined") return;
    this.unlocked = true;
    try {
      const AC =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext?: typeof AudioContext })
          .webkitAudioContext;
      if (AC) {
        this.ctx = new AC();
        void this.ctx.resume?.();
      }
    } catch {
      /* Web Audio unavailable — fine, we just lose the synth fallback */
    }
    // Preload the SFX pools now that playback is allowed.
    (Object.keys(SFX_SRC) as SfxKey[]).forEach((k) => this.ensurePool(k));
    // Start any track a game requested before the first gesture.
    if (this.desiredMusic && !this.muted) this.playMusic(this.desiredMusic);
  }

  private ensurePool(key: SfxKey): HTMLAudioElement[] {
    const existing = this.pools[key];
    if (existing) return existing;
    const pool: HTMLAudioElement[] = [];
    for (let i = 0; i < POOL_SIZE; i++) {
      const el = new Audio(SFX_SRC[key]);
      el.preload = "auto";
      el.volume = SFX_VOLUME[key];
      el.addEventListener(
        "error",
        () => {
          this.sfxUnavailable[key] = true;
        },
        { once: true },
      );
      try {
        el.load();
      } catch {
        /* ignore */
      }
      pool.push(el);
    }
    this.pools[key] = pool;
    this.poolIdx[key] = 0;
    return pool;
  }

  /** Fire a short sound effect. Safe to call on every tap. */
  playSfx(key: SfxKey) {
    if (this.muted || typeof window === "undefined") return;
    if (!this.unlocked) this.unlock(); // e.g. called directly inside a gesture

    const now = performance.now();
    if (now - (this.lastPlay[key] ?? 0) < THROTTLE_MS) return; // de-spam
    this.lastPlay[key] = now;

    if (this.sfxUnavailable[key]) {
      this.synth(key);
      return;
    }

    const pool = this.ensurePool(key);
    const idx = ((this.poolIdx[key] ?? 0) + 1) % pool.length;
    this.poolIdx[key] = idx;
    const el = pool[idx];
    try {
      el.currentTime = 0;
      el.volume = SFX_VOLUME[key];
      const p = el.play();
      if (p && typeof p.catch === "function") {
        p.catch(() => {
          this.sfxUnavailable[key] = true;
          this.synth(key);
        });
      }
    } catch {
      this.sfxUnavailable[key] = true;
      this.synth(key);
    }
  }

  /** Web-Audio fallback so a missing .mp3 never leaves the game silent. */
  private synth(key: SfxKey) {
    const ctx = this.ctx;
    if (!ctx) return;
    const t0 = ctx.currentTime;
    const master = ctx.createGain();
    master.gain.value = 1;
    master.connect(ctx.destination);
    const beep = (
      freq: number,
      start: number,
      dur: number,
      type: OscillatorType = "sine",
      vol = 0.2,
    ) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = type;
      osc.frequency.value = freq;
      osc.connect(gain);
      gain.connect(master);
      gain.gain.setValueAtTime(0.0001, t0 + start);
      gain.gain.linearRampToValueAtTime(vol, t0 + start + 0.012);
      gain.gain.exponentialRampToValueAtTime(0.0001, t0 + start + dur);
      osc.start(t0 + start);
      osc.stop(t0 + start + dur + 0.03);
    };
    switch (key) {
      case "correct":
        beep(660, 0, 0.12);
        beep(880, 0.08, 0.16);
        break;
      case "wrong":
        beep(196, 0, 0.24, "sawtooth", 0.16);
        break;
      case "click":
        beep(420, 0, 0.05, "square", 0.1);
        break;
      case "levelWin":
        [523, 659, 784, 1047].forEach((f, i) =>
          beep(f, i * 0.1, 0.24, "triangle", 0.17),
        );
        break;
    }
  }

  /** Loop a game's background track at the low baseline volume. */
  playMusic(key: MusicKey) {
    if (typeof window === "undefined") return;
    this.desiredMusic = key;
    if (!this.unlocked || this.muted) return; // will start on unlock/unmute
    if (this.currentMusic === key && this.music && !this.music.paused) return;

    this.stopMusicElement();

    const el = new Audio(MUSIC_SRC[key]);
    el.loop = true;
    el.preload = "auto";
    el.volume = 0;
    this.music = el;
    this.currentMusic = key;

    el.play()
      .then(() => this.fadeTo(el, MUSIC_VOLUME, 800))
      .catch(() => {
        // Missing/blocked track — stay silent (no synth music).
        if (this.music === el) {
          this.music = null;
          this.currentMusic = null;
        }
      });
  }

  /** Stop music AND forget it (called when a game unmounts). */
  stopMusic() {
    this.desiredMusic = null;
    this.stopMusicElement();
  }

  private stopMusicElement() {
    const el = this.music;
    if (!el) return;
    this.music = null;
    this.currentMusic = null;
    this.fadeTo(el, 0, 300, () => {
      try {
        el.pause();
      } catch {
        /* ignore */
      }
    });
  }

  private fadeTo(
    el: HTMLAudioElement,
    target: number,
    ms: number,
    done?: () => void,
  ) {
    if (this.fadeTimer) clearInterval(this.fadeTimer);
    const steps = 12;
    const start = el.volume;
    let i = 0;
    this.fadeTimer = setInterval(() => {
      i += 1;
      const v = start + (target - start) * (i / steps);
      el.volume = Math.max(0, Math.min(1, v));
      if (i >= steps) {
        if (this.fadeTimer) clearInterval(this.fadeTimer);
        this.fadeTimer = null;
        done?.();
      }
    }, ms / steps);
  }
}

export const soundManager = new SoundManager();
