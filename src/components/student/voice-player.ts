/**
 * The guide's voice, shared by the Whiteboard Tutor and spoken practice.
 *
 * Every line is server-signed (POST /api/ai/tts { text, token }), so only text
 * the server wrote for this student is ever spoken.
 *
 * One voice per lesson: a {@link VoiceTrack} (one per lesson or practice
 * round) settles on a voice with its FIRST line — the service the server used
 * (X-Voice-Provider), or the browser's own voice if no service works — and
 * then asks for that same service for every other line, retrying it when it
 * is briefly busy (e.g. a quota hiccup) instead of switching. If it still
 * fails, that line is shown as a subtitle in silence: never a second voice.
 * The service a page visit settled on is tried first by the next lesson too.
 *
 * Cloud audio plays through Web Audio (decodes MP3 and WAV everywhere, and
 * some embedded browsers can't play <audio>), with short fades so a line
 * never starts or stops with a click.
 */

export type CloudVoice = "AZURE" | "GEMINI" | "ELEVENLABS";
const CLOUD: CloudVoice[] = ["AZURE", "GEMINI", "ELEVENLABS"];

export const MAX_TTS_CHARS = 600; // matches lib/tts

/* ── Browser speech ─────────────────────────────────────────────── */

export function synth(): SpeechSynthesis | null {
  return typeof window !== "undefined" && "speechSynthesis" in window ? window.speechSynthesis : null;
}

function pickVoice(): SpeechSynthesisVoice | null {
  const s = synth();
  if (!s) return null;
  const en = s.getVoices().filter((v) => /^en[-_]/i.test(v.lang) || v.lang === "en");
  // A clear voice first; device voices vary a lot.
  const prefer = [
    /natural/i, /google us english/i, /samantha/i, /aria|jenny|zira/i, /google uk english female/i,
    /hazel|susan|libby|sonia|karen|moira|tessa|female/i, /en[-_]us/i,
  ];
  for (const re of prefer) {
    const v = en.find((x) => re.test(x.name) || re.test(x.lang));
    if (v) return v;
  }
  return en[0] ?? null;
}

let ctxSingleton: AudioContext | null = null;
function audioCtx(): AudioContext | null {
  if (typeof window === "undefined") return null;
  if (!ctxSingleton) {
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return null;
    ctxSingleton = new AC();
  }
  return ctxSingleton;
}

/** Whether the admin set up a voice service (asked once per page load). */
let cloudProbe: Promise<boolean> | null = null;
let cloudKnown: boolean | null = null;
export function probeCloud(): Promise<boolean> {
  cloudProbe ??= fetch("/api/ai/tts")
    .then((r) => (r.ok ? r.json() : { cloud: false }))
    .then((d) => (cloudKnown = !!d.cloud))
    .catch(() => (cloudKnown = false));
  return cloudProbe;
}

/**
 * Call from the tap that starts a lesson: mobile browsers only let a page
 * play sound after it has done so once inside a tap. The browser voice is
 * only primed when it may be needed — a silent prime utterance can still make
 * a faint noise on some devices.
 */
export function primeSpeech() {
  try {
    audioCtx()?.resume().catch(() => {});
    if (cloudKnown !== true) {
      const s = synth();
      if (s) {
        const u = new SpeechSynthesisUtterance(" ");
        u.volume = 0;
        s.speak(u);
      }
    }
  } catch {
    /* ignore */
  }
}

/** Read a line with the browser voice (or, voiceOn=false, just wait as long as it would take). */
export function browserLine(text: string, voiceOn: boolean, onDone: () => void): () => void {
  const words = text.split(/\s+/).filter(Boolean).length;
  const estimate = Math.max(1700, words * 390);
  let finished = false;
  const timers: ReturnType<typeof setTimeout>[] = [];
  const finish = () => {
    if (finished) return;
    finished = true;
    timers.forEach(clearTimeout);
    onDone();
  };
  const s = synth();
  if (!voiceOn || !s || !text.trim()) {
    timers.push(setTimeout(finish, estimate));
  } else {
    s.cancel();
    const u = new SpeechSynthesisUtterance(text);
    const v = pickVoice();
    if (v) u.voice = v;
    u.lang = v?.lang ?? "en-US";
    u.rate = 1;
    u.pitch = 1;
    u.onend = finish;
    u.onerror = finish;
    // Chrome sometimes drops an utterance queued right after cancel().
    timers.push(setTimeout(() => !finished && s.speak(u), 60));
    // Some engines never fire onend; never get stuck on a line.
    timers.push(setTimeout(finish, estimate * 2.5 + 3000));
  }
  return () => {
    finished = true;
    timers.forEach(clearTimeout);
    if (voiceOn) synth()?.cancel();
  };
}

/* ── Cloud lines ────────────────────────────────────────────────── */

interface Fetched {
  buf: AudioBuffer | null;
  provider: CloudVoice | null;
  /** 204 = no voice service at all. */
  status: number;
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
const BACKOFF = [900, 2200, 4500];

async function fetchOnce(text: string, token: string, provider: CloudVoice | null): Promise<Fetched> {
  const ctx = audioCtx();
  if (!ctx) return { buf: null, provider: null, status: 0 };
  try {
    const res = await fetch("/api/ai/tts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: text.slice(0, MAX_TTS_CHARS), token, ...(provider ? { provider } : {}) }),
    });
    if (res.status !== 200) return { buf: null, provider: null, status: res.status };
    const used = res.headers.get("X-Voice-Provider") as CloudVoice | null;
    const buf = await ctx.decodeAudioData(await res.arrayBuffer());
    return { buf, provider: used && CLOUD.includes(used) ? used : provider, status: 200 };
  } catch {
    return { buf: null, provider: null, status: 0 };
  }
}

/** Lines already fetched this visit, by voice and token (a replay never asks again). */
const lineAudio = new Map<string, Promise<Fetched>>();

/**
 * One line in one voice (`provider`, or null = the admin's order), retried
 * while the service is busy. Never switches voice.
 */
function fetchLine(text: string, token: string, provider: CloudVoice | null, attempts: number): Promise<Fetched> {
  const key = `${provider ?? "any"}|${token}`;
  const hit = lineAudio.get(key);
  if (hit) return hit;
  const p = (async () => {
    let r: Fetched = { buf: null, provider: null, status: 0 };
    for (let i = 0; i < attempts; i++) {
      r = await fetchOnce(text, token, provider);
      // 204 none configured, 400/403 refused: retrying won't help.
      if (r.buf || r.status === 204 || r.status === 400 || r.status === 401 || r.status === 403) break;
      if (i < attempts - 1) await wait(BACKOFF[Math.min(i, BACKOFF.length - 1)]);
    }
    return r;
  })().then((r) => {
    if (!r.buf) lineAudio.delete(key); // a later play may try again
    else if (!provider && r.provider) lineAudio.set(`${r.provider}|${token}`, Promise.resolve(r));
    return r;
  });
  lineAudio.set(key, p);
  while (lineAudio.size > 160) lineAudio.delete(lineAudio.keys().next().value!);
  return p;
}

/** The voice this page visit settled on; the next lesson starts with it too. */
let visitVoice: CloudVoice | null = null;

/** One lesson's (or practice round's) voice — decided once, by its first line. */
export class VoiceTrack {
  mode: "pending" | "cloud" | "browser" = "pending";
  provider: CloudVoice | null = null;
  private ready: Promise<void> | null = null;

  /** Settle the voice using the first line to be spoken. Safe to call again. */
  start(text: string, token: string | undefined): Promise<void> {
    this.ready ??= (async () => {
      if (!token || !(await probeCloud())) {
        this.mode = "browser";
        return;
      }
      for (const p of visitVoice ? [visitVoice, null] : [null]) {
        const r = await fetchLine(text, token, p, 2);
        if (r.buf && r.provider) {
          this.mode = "cloud";
          this.provider = r.provider;
          visitVoice = r.provider;
          return;
        }
        if (r.status === 204) break;
      }
      // No service works from the start: the browser voice, for the whole lesson.
      this.mode = "browser";
    })();
    return this.ready;
  }

  /** Fetch a line ahead of time (after the voice is settled). */
  prefetch(text: string, token: string | undefined) {
    if (!token || !this.ready) return;
    this.ready.then(() => {
      if (this.mode === "cloud" && this.provider) fetchLine(text, token, this.provider, 3);
    });
  }

  /**
   * Say one line, then call onDone. voiceOn=false: just wait as long as it
   * would take. Returns a cancel.
   */
  say(text: string, token: string | undefined, voiceOn: boolean, onDone: () => void): () => void {
    if (!voiceOn) return browserLine(text, false, onDone);
    let dead = false;
    let cancel: (() => void) | null = null;
    this.start(text, token).then(async () => {
      if (dead) return;
      if (this.mode !== "cloud" || !token || !this.provider) {
        // Lines without a token (an old saved lesson) stay silent in a cloud lesson.
        cancel = browserLine(text, this.mode === "browser", onDone);
        return;
      }
      const r = await fetchLine(text, token, this.provider, 3);
      if (dead) return;
      cancel = r.buf ? playBuffer(r.buf, onDone) : browserLine(text, false, onDone);
    });
    return () => {
      dead = true;
      cancel?.();
    };
  }
}

const FADE_IN = 0.012;
const FADE_OUT = 0.025;

/** Play decoded audio with fades in and out. Returns a cancel (fades out fast). */
function playBuffer(buf: AudioBuffer, onDone: () => void): () => void {
  const ctx = audioCtx();
  let finished = false;
  let safety: ReturnType<typeof setTimeout> | undefined;
  const finish = () => {
    if (finished) return;
    finished = true;
    if (safety) clearTimeout(safety);
    onDone();
  };
  if (!ctx) return browserLine("", false, onDone);
  let node: AudioBufferSourceNode | null = null;
  let gain: GainNode | null = null;
  const go = () => {
    if (finished) return;
    if (ctx.state !== "running") {
      // Sound is blocked (no tap yet): wait silently for as long as the line lasts.
      safety = setTimeout(finish, buf.duration * 1000 + 300);
      return;
    }
    node = ctx.createBufferSource();
    gain = ctx.createGain();
    node.buffer = buf;
    node.connect(gain).connect(ctx.destination);
    const t = ctx.currentTime + 0.01;
    const end = t + buf.duration;
    gain.gain.setValueAtTime(0, t);
    gain.gain.linearRampToValueAtTime(1, t + FADE_IN);
    gain.gain.setValueAtTime(1, Math.max(t + FADE_IN, end - FADE_OUT));
    gain.gain.linearRampToValueAtTime(0, end);
    node.onended = finish;
    node.start(t);
    // Never get stuck on a line if "ended" doesn't arrive.
    safety = setTimeout(finish, buf.duration * 1000 + 3000);
  };
  if (ctx.state !== "running") ctx.resume().catch(() => {}).finally(go);
  else go();
  return () => {
    finished = true;
    if (safety) clearTimeout(safety);
    const n = node as AudioBufferSourceNode | null;
    const g = gain as GainNode | null;
    if (n) {
      n.onended = null;
      try {
        const now = ctx.currentTime;
        g?.gain.cancelScheduledValues(now);
        g?.gain.setValueAtTime(g.gain.value, now);
        g?.gain.linearRampToValueAtTime(0, now + 0.03);
        n.stop(now + 0.04);
      } catch {
        /* already stopped */
      }
    }
  };
}
