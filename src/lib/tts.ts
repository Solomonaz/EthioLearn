/**
 * Read-aloud for the Whiteboard Tutor: Azure Speech, Gemini TTS or ElevenLabs,
 * chosen in Admin -> AI Models (VoiceSettings), with the student's browser
 * voice as the last fallback.
 *
 * Only lines the server itself wrote can be spoken: every lesson line comes
 * with a signed token (HMAC of the user id and the exact text), and
 * POST /api/ai/tts refuses anything else. So the endpoint can never be used as
 * a free, general-purpose text-to-speech service.
 *
 * API keys stay in the environment, like the AI providers' keys:
 *   AZURE_SPEECH_KEY (+ AZURE_SPEECH_REGION), ELEVENLABS_API_KEY, GEMINI_API_KEY.
 */
import crypto from "node:crypto";
import { db } from "./db";
import { logUsage, type UsageActor } from "./usage-logger";
import { isTutorStyle, type TutorStyle } from "./whiteboard-lesson";

export type TtsProviderId = "BROWSER" | "AZURE" | "GEMINI" | "ELEVENLABS";
export const TTS_PROVIDERS: TtsProviderId[] = ["BROWSER", "AZURE", "GEMINI", "ELEVENLABS"];
/** The paid services that can be put in the order (the browser voice is always last). */
export type CloudVoiceId = Exclude<TtsProviderId, "BROWSER">;
export const CLOUD_VOICES: CloudVoiceId[] = ["AZURE", "GEMINI", "ELEVENLABS"];

export interface VoiceConfig {
  /** Services to try, first to last; the browser voice comes after all of them. */
  voiceOrder: CloudVoiceId[];
  azureRegion: string | null;
  azureVoice: string;
  azureStyle: string | null;
  geminiModel: string;
  geminiVoice: string;
  geminiStyle: string | null;
  elevenVoiceId: string;
  elevenModel: string;
  /** How the guide talks in Whiteboard lessons. */
  tutorStyle: TutorStyle;
}

export const VOICE_DEFAULTS: VoiceConfig = {
  voiceOrder: [],
  azureRegion: null,
  azureVoice: "en-US-AvaMultilingualNeural",
  azureStyle: null,
  geminiModel: "gemini-3.8-flash-tts",
  geminiVoice: "Leda",
  geminiStyle: "confident, clear, energetic teacher",
  elevenVoiceId: "cgSgspJ2msm6clMCkdW9",
  elevenModel: "eleven_flash_v2_5",
  tutorStyle: "bold",
};

/** Suggestions for the admin page (any valid id can be typed instead). */
export const VOICE_SUGGESTIONS = {
  azure: [
    "en-US-AvaMultilingualNeural",
    "en-US-AndrewMultilingualNeural",
    "en-US-EmmaMultilingualNeural",
    "en-US-JennyNeural",
    "en-US-AriaNeural",
    "en-US-GuyNeural",
    "en-GB-SoniaNeural",
    "en-GB-RyanNeural",
    "en-KE-AsiliaNeural",
    "en-NG-EzinneNeural",
  ],
  azureStyles: ["", "cheerful", "friendly", "excited", "hopeful", "empathetic"],
  gemini: ["Leda", "Kore", "Aoede", "Zephyr", "Puck", "Callirrhoe", "Autonoe", "Charon", "Fenrir", "Orus"],
  geminiModels: ["gemini-3.8-flash-tts", "gemini-3.8-flash-lite-tts", "gemini-2.5-flash-preview-tts"],
  // ElevenLabs "premade" voices: usable on every plan. Library voices need a paid plan.
  eleven: [
    { id: "cgSgspJ2msm6clMCkdW9", name: "Jessica — playful, bright, warm" },
    { id: "FGY2WhTYpPnrIDTdsKH5", name: "Laura — enthusiastic, quirky" },
    { id: "Xb7hH8MSUJpSbSDYk0k2", name: "Alice — clear educator (British)" },
    { id: "hpp4J3VqNfWAUOO0d1Us", name: "Bella — bright, warm" },
    { id: "TX3LPaxmHKxFdv7VOQHJ", name: "Liam — energetic" },
    { id: "bIHbv24MWmeRgasZH58o", name: "Will — relaxed optimist" },
  ],
  elevenModels: ["eleven_flash_v2_5", "eleven_turbo_v2_5", "eleven_multilingual_v2"],
};

/**
 * Longest line the service will speak. Lesson lines are under 300; a practice
 * question's choices read together can reach ~560.
 */
export const MAX_TTS_CHARS = 600;

export function keyStatus() {
  return {
    AZURE: !!process.env.AZURE_SPEECH_KEY,
    GEMINI: !!process.env.GEMINI_API_KEY,
    ELEVENLABS: !!process.env.ELEVENLABS_API_KEY,
    BROWSER: true,
  } as Record<TtsProviderId, boolean>;
}

/**
 * The saved settings. Throws if the table can't be read (e.g. `prisma db push`
 * not run yet) — the admin page must say so rather than show defaults.
 */
export async function readVoiceConfig(): Promise<VoiceConfig> {
  const row = await db.voiceSettings.upsert({ where: { id: "singleton" }, update: {}, create: { id: "singleton" } });
  return {
    voiceOrder: row.voiceOrder.filter((p): p is CloudVoiceId => p !== "BROWSER"),
    azureRegion: row.azureRegion,
    azureVoice: row.azureVoice,
    azureStyle: row.azureStyle,
    geminiModel: row.geminiModel,
    geminiVoice: row.geminiVoice,
    geminiStyle: row.geminiStyle,
    elevenVoiceId: row.elevenVoiceId,
    elevenModel: row.elevenModel,
    tutorStyle: isTutorStyle(row.tutorStyle) ? row.tutorStyle : "bold",
  };
}

/** For students: never throws — if settings can't be read, the browser voice is used. */
export async function getVoiceConfig(): Promise<VoiceConfig> {
  try {
    return await readVoiceConfig();
  } catch {
    return VOICE_DEFAULTS;
  }
}

/** The services to try, in order, that are configured (have a key). */
export function cloudChain(cfg: VoiceConfig): TtsProviderId[] {
  const keys = keyStatus();
  const out: TtsProviderId[] = [];
  for (const p of cfg.voiceOrder) {
    if (keys[p] && !out.includes(p)) out.push(p);
  }
  return out;
}

// ── Signed lines ──────────────────────────────────────────────────────────

function secret(): string {
  const s = process.env.NEXTAUTH_SECRET || process.env.AUTH_SECRET;
  if (!s) throw new Error("NEXTAUTH_SECRET is not set");
  return s;
}

/** Token that lets `userId` have exactly `text` spoken. */
export function signLine(userId: string, text: string): string {
  return crypto.createHmac("sha256", secret()).update(`tts\n${userId}\n${text}`).digest("base64url").slice(0, 32);
}

export function verifyLine(userId: string, text: string, token: unknown): boolean {
  if (typeof token !== "string" || token.length !== 32) return false;
  const expected = Buffer.from(signLine(userId, text));
  const got = Buffer.from(token);
  return got.length === expected.length && crypto.timingSafeEqual(got, expected);
}

// ── Providers ─────────────────────────────────────────────────────────────

export interface Speech {
  data: Buffer;
  mime: string;
  provider: TtsProviderId;
}

const xmlEscape = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");

async function azure(text: string, cfg: VoiceConfig): Promise<Speech> {
  const region = (cfg.azureRegion || process.env.AZURE_SPEECH_REGION || "eastus").trim();
  if (!/^[a-z0-9-]+$/i.test(region)) throw new Error("Invalid Azure region");
  const voice = xmlEscape(cfg.azureVoice);
  const lang = cfg.azureVoice.split("-").slice(0, 2).join("-") || "en-US";
  const inner = cfg.azureStyle
    ? `<mstts:express-as style="${xmlEscape(cfg.azureStyle)}">${xmlEscape(text)}</mstts:express-as>`
    : xmlEscape(text);
  const ssml =
    `<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xmlns:mstts="https://www.w3.org/2001/mstts" xml:lang="${xmlEscape(lang)}">` +
    `<voice name="${voice}">${inner}</voice></speak>`;
  const res = await fetch(`https://${region}.tts.speech.microsoft.com/cognitiveservices/v1`, {
    method: "POST",
    headers: {
      "Ocp-Apim-Subscription-Key": process.env.AZURE_SPEECH_KEY!,
      "Content-Type": "application/ssml+xml",
      "X-Microsoft-OutputFormat": "audio-24khz-48kbitrate-mono-mp3",
      "User-Agent": "abugida-tts",
    },
    body: ssml,
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) throw new Error(`Azure ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return { data: Buffer.from(await res.arrayBuffer()), mime: "audio/mpeg", provider: "AZURE" };
}

async function elevenlabs(text: string, cfg: VoiceConfig): Promise<Speech> {
  if (!/^[A-Za-z0-9]+$/.test(cfg.elevenVoiceId)) throw new Error("Invalid ElevenLabs voice id");
  const res = await fetch(
    `https://api.elevenlabs.io/v1/text-to-speech/${cfg.elevenVoiceId}?output_format=mp3_44100_64`,
    {
      method: "POST",
      headers: { "xi-api-key": process.env.ELEVENLABS_API_KEY!, "Content-Type": "application/json", Accept: "audio/mpeg" },
      body: JSON.stringify({
        text,
        model_id: cfg.elevenModel,
        voice_settings: { stability: 0.4, similarity_boost: 0.75, style: 0.35, use_speaker_boost: true },
      }),
      signal: AbortSignal.timeout(20_000),
    },
  );
  if (!res.ok) throw new Error(`ElevenLabs ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return { data: Buffer.from(await res.arrayBuffer()), mime: "audio/mpeg", provider: "ELEVENLABS" };
}

/**
 * A clean WAV: only the "fmt " and "data" chunks, with short fades.
 *
 * Gemini's WAV carries a "C2PA" content-credentials chunk AFTER the audio.
 * An earlier fix (for headers that understated the data length) stretched the
 * data chunk to the end of the file, so players read that metadata as sound —
 * a ~150 ms burst of loud static at the end of every line. Here the stated
 * length is trusted when a real chunk follows it, and only stretched when the
 * bytes after it are not a chunk. Fades of a few ms stop any click where a
 * clip starts or ends off zero. Safe to run twice (cached lines are cleaned
 * on the way out too; a second pass only fades again).
 */
export function cleanWav(wav: Buffer): Buffer {
  if (wav.length < 44 || wav.subarray(0, 4).toString("latin1") !== "RIFF" || wav.subarray(8, 12).toString("latin1") !== "WAVE") {
    return wav;
  }
  const isChunkId = (o: number) => o + 8 <= wav.length && /^[ -~]{4}$/.test(wav.subarray(o, o + 4).toString("latin1"));
  let fmt: Buffer | null = null;
  let pcm: Buffer | null = null;
  let off = 12;
  while (off + 8 <= wav.length) {
    const id = wav.subarray(off, off + 4).toString("latin1");
    const size = wav.readUInt32LE(off + 4);
    const bodyStart = off + 8;
    if (id === "fmt ") fmt = wav.subarray(bodyStart, Math.min(wav.length, bodyStart + size));
    if (id === "data") {
      const next = bodyStart + size + (size & 1);
      const avail = wav.length - bodyStart;
      // Understated length with no chunk after it: the audio runs to the end.
      const len = size > avail ? avail : next < wav.length && !isChunkId(next) ? avail : size;
      pcm = wav.subarray(bodyStart, bodyStart + (len & ~1));
      // Lines cached before this fix have the metadata chunk swallowed into
      // the data: cut it where a known chunk runs to the very end.
      for (const tag of ["C2PA", "LIST", "id3 ", "JUNK"]) {
        for (let q = pcm.indexOf(tag, 0, "latin1"); q >= 0 && q + 8 <= pcm.length; q = pcm.indexOf(tag, q + 1, "latin1")) {
          if (Math.abs(q + 8 + pcm.readUInt32LE(q + 4) - pcm.length) <= 1) {
            pcm = pcm.subarray(0, q & ~1);
            break;
          }
        }
      }
      break;
    }
    off = bodyStart + size + (size & 1);
  }
  if (!fmt || fmt.length < 16 || !pcm) return wav;
  const format = fmt.readUInt16LE(0);
  const channels = fmt.readUInt16LE(2) || 1;
  const rate = fmt.readUInt32LE(4);
  const bits = fmt.readUInt16LE(14);
  const data = Buffer.from(pcm);
  if (format === 1 && bits === 16 && rate > 0) fade16(data, channels, rate);
  const h = Buffer.alloc(44);
  h.write("RIFF", 0);
  h.writeUInt32LE(36 + data.length, 4);
  h.write("WAVEfmt ", 8);
  h.writeUInt32LE(16, 16);
  fmt.copy(h, 20, 0, 16);
  h.write("data", 36);
  h.writeUInt32LE(data.length, 40);
  return Buffer.concat([h, data]);
}

/** Fade 16-bit PCM in and out over ~8 ms (in place). */
function fade16(data: Buffer, channels: number, rate: number) {
  const frames = Math.floor(data.length / (2 * channels));
  const n = Math.min(Math.floor(rate * 0.008), Math.floor(frames / 4));
  for (let i = 0; i < n; i++) {
    const g = i / n;
    for (let c = 0; c < channels; c++) {
      const a = (i * channels + c) * 2;
      const b = ((frames - 1 - i) * channels + c) * 2;
      data.writeInt16LE(Math.round(data.readInt16LE(a) * g), a);
      data.writeInt16LE(Math.round(data.readInt16LE(b) * g), b);
    }
  }
}

/** Raw 16-bit mono PCM → a playable WAV file. */
function pcmToWav(pcm: Buffer, rate: number): Buffer {
  const h = Buffer.alloc(44);
  h.write("RIFF", 0);
  h.writeUInt32LE(36 + pcm.length, 4);
  h.write("WAVEfmt ", 8);
  h.writeUInt32LE(16, 16);
  h.writeUInt16LE(1, 20);
  h.writeUInt16LE(1, 22);
  h.writeUInt32LE(rate, 24);
  h.writeUInt32LE(rate * 2, 28);
  h.writeUInt16LE(2, 32);
  h.writeUInt16LE(16, 34);
  h.write("data", 36);
  h.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([h, pcm]);
}

async function gemini(text: string, cfg: VoiceConfig, actor?: UsageActor): Promise<Speech> {
  if (!/^[a-z0-9.-]+$/i.test(cfg.geminiModel)) throw new Error("Invalid Gemini model id");
  // The style goes in [brackets], which Gemini follows as a tone tag. Written
  // as a sentence before the line ("Read this like…:"), it was READ ALOUD
  // before every line (measured: ~9 s per line instead of ~2.5 s).
  const tag = toneTag(cfg.geminiStyle);
  const prompt = tag ? `[${tag}] ${text}` : text;
  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${cfg.geminiModel}:generateContent`, {
    method: "POST",
    headers: { "x-goog-api-key": process.env.GEMINI_API_KEY!, "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: {
        responseModalities: ["AUDIO"],
        speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: cfg.geminiVoice } } },
      },
    }),
    signal: AbortSignal.timeout(30_000),
  });
  const json = (await res.json().catch(() => ({}))) as {
    candidates?: { content?: { parts?: { inlineData?: { mimeType?: string; data?: string } }[] } }[];
    usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number; totalTokenCount?: number };
    error?: { message?: string };
  };
  if (!res.ok) throw new Error(`Gemini ${res.status}: ${json.error?.message?.slice(0, 200) ?? ""}`);
  const part = json.candidates?.[0]?.content?.parts?.find((p) => p.inlineData?.data)?.inlineData;
  if (!part?.data) throw new Error("Gemini returned no audio");
  const u = json.usageMetadata ?? {};
  logUsage({
    feature: "tts",
    provider: "gemini",
    model: cfg.geminiModel,
    usage: {
      promptTokens: u.promptTokenCount ?? 0,
      outputTokens: u.candidatesTokenCount ?? 0,
      thinkingTokens: 0,
      totalTokens: u.totalTokenCount ?? 0,
    },
    actor,
  });
  let data: Buffer = Buffer.from(part.data, "base64");
  const mime = (part.mimeType || "").toLowerCase();
  if (!mime.includes("wav") && data.subarray(0, 4).toString() !== "RIFF") {
    // audio/L16;rate=24000 (raw PCM)
    const rate = Number(/rate=(\d+)/.exec(mime)?.[1]) || 24000;
    data = cleanWav(pcmToWav(data, rate));
  } else {
    data = cleanWav(data);
  }
  return { data, mime: "audio/wav", provider: "GEMINI" };
}

/** Character-billed services: record the characters as "tokens" for the usage page. */
function logChars(provider: "azure" | "elevenlabs", model: string, chars: number, actor?: UsageActor) {
  logUsage({
    feature: "tts",
    provider,
    model,
    usage: { promptTokens: chars, outputTokens: 0, thinkingTokens: 0, totalTokens: chars },
    actor,
  });
}

async function synthesizeWith(p: TtsProviderId, text: string, cfg: VoiceConfig, actor?: UsageActor): Promise<Speech> {
  switch (p) {
    case "AZURE": {
      const s = await azure(text, cfg);
      logChars("azure", `azure-tts:${cfg.azureVoice}`, text.length, actor);
      return s;
    }
    case "ELEVENLABS": {
      const s = await elevenlabs(text, cfg);
      logChars("elevenlabs", `elevenlabs:${cfg.elevenModel}`, text.length, actor);
      return s;
    }
    case "GEMINI":
      return gemini(text, cfg, actor);
    default:
      throw new Error("No cloud voice");
  }
}

/**
 * The admin's speaking style as a short tone tag: no brackets or line breaks,
 * and an old-style "Read this like a … :" sentence trimmed to its description.
 */
export function toneTag(style: string | null | undefined): string {
  return (style ?? "")
    .replace(/[\[\]\r\n]+/g, " ")
    .replace(/^\s*(?:please\s+)?(?:read|say|speak)\s+(?:this|it|the following)?\s*(?:like|as|in)\s+(?:an?\s+)?/i, "")
    .replace(/[:\s]+$/, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80);
}

function voiceKey(p: TtsProviderId, cfg: VoiceConfig, text: string): string {
  const voice =
    p === "AZURE"
      ? `${cfg.azureVoice}|${cfg.azureStyle ?? ""}`
      : p === "GEMINI"
        ? `v2|${cfg.geminiModel}|${cfg.geminiVoice}|${toneTag(cfg.geminiStyle)}`
        : `${cfg.elevenModel}|${cfg.elevenVoiceId}`;
  return crypto.createHash("sha256").update(`${p}|${voice}|${text}`).digest("hex");
}

/**
 * Speak `text` with the configured service (then the fallback), using the
 * cache first. Returns null when no cloud voice is configured or every
 * service failed — the page then uses the browser voice.
 *
 * `only`: use just this service (the one a lesson started with), so a lesson
 * never switches voice halfway; null if it isn't configured or fails.
 */
export async function speak(
  text: string,
  opts: { actor?: UsageActor; config?: VoiceConfig; useCache?: boolean; only?: CloudVoiceId } = {},
): Promise<(Speech & { cached: boolean }) | null> {
  const cfg = opts.config ?? (await getVoiceConfig());
  const useCache = opts.useCache !== false;
  const chain = cloudChain(cfg).filter((p) => !opts.only || p === opts.only);
  for (const p of chain) {
    const id = voiceKey(p, cfg, text);
    if (useCache) {
      const hit = await db.ttsAudioCache.findUnique({ where: { id } }).catch(() => null);
      if (hit) {
        const data = hit.mime.includes("wav") ? cleanWav(Buffer.from(hit.data)) : Buffer.from(hit.data);
        return { data, mime: hit.mime, provider: p, cached: true };
      }
    }
    try {
      const s = await synthesizeWith(p, text, cfg, opts.actor);
      if (useCache) {
        await db.ttsAudioCache
          .upsert({
            where: { id },
            update: {},
            create: { id, mime: s.mime, data: new Uint8Array(s.data), provider: p, chars: text.length },
          })
          .catch(() => {});
        // Now and then, drop lines nobody has needed for a month.
        if (Math.random() < 0.02) {
          db.ttsAudioCache
            .deleteMany({ where: { createdAt: { lt: new Date(Date.now() - 30 * 86_400_000) } } })
            .catch(() => {});
        }
      }
      return { ...s, cached: false };
    } catch (err) {
      console.error(`[tts] ${p} failed:`, err instanceof Error ? err.message : err);
    }
  }
  return null;
}

/** For the admin "Test" button: one provider, no cache, errors surfaced. */
export async function testVoice(p: TtsProviderId, text: string, cfg: VoiceConfig): Promise<Speech> {
  if (p === "BROWSER") throw new Error("The browser voice plays on the admin's own device.");
  if (!keyStatus()[p]) throw new Error(`No API key set for ${p} on the server.`);
  return synthesizeWith(p, text, cfg);
}
