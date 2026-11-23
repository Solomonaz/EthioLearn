/**
 * Admin → AI Models → "Read-aloud voice" (Whiteboard Tutor).
 *
 * SUPER_ADMIN only. GET returns the saved settings, which API keys are present
 * (never the keys), and voice suggestions. PUT saves. POST plays a test line
 * with the settings in the request (saved or not), uncached, so an admin can
 * hear a voice before switching every student to it.
 *
 * Like Admin → AI Models, this never accepts an API key: keys stay in the
 * environment (AZURE_SPEECH_KEY, AZURE_SPEECH_REGION, ELEVENLABS_API_KEY,
 * GEMINI_API_KEY).
 */
import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/get-session";
import { validateCsrfOrigin } from "@/lib/csrf";
import { db } from "@/lib/db";
import {
  getVoiceConfig,
  keyStatus,
  testVoice,
  TTS_PROVIDERS,
  VOICE_DEFAULTS,
  VOICE_SUGGESTIONS,
  type TtsProviderId,
  type VoiceConfig,
} from "@/lib/tts";

async function requireSuperAdmin(req?: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (user.role !== "SUPER_ADMIN") return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  if (req && !validateCsrfOrigin(req)) return NextResponse.json({ error: "Invalid request origin" }, { status: 403 });
  return null;
}

const isProvider = (v: unknown): v is TtsProviderId => typeof v === "string" && (TTS_PROVIDERS as string[]).includes(v);

/** Validate a submitted config; every free-text field is a short id or phrase. */
function parseConfig(raw: unknown): VoiceConfig | string {
  if (!raw || typeof raw !== "object") return "Invalid settings";
  const r = raw as Record<string, unknown>;
  const str = (v: unknown, re: RegExp, max: number, field: string, optional = false): string | null => {
    if ((v === null || v === undefined || v === "") && optional) return null;
    if (typeof v !== "string" || v.length > max || !re.test(v.trim())) throw new Error(`Invalid ${field}`);
    return v.trim();
  };
  try {
    if (!isProvider(r.provider)) return "Invalid provider";
    if (r.fallbackProvider !== null && r.fallbackProvider !== undefined && r.fallbackProvider !== "" && !isProvider(r.fallbackProvider)) {
      return "Invalid fallback provider";
    }
    return {
      provider: r.provider,
      fallbackProvider: isProvider(r.fallbackProvider) && r.fallbackProvider !== r.provider ? r.fallbackProvider : null,
      azureRegion: str(r.azureRegion, /^[a-z0-9-]+$/i, 40, "Azure region", true),
      azureVoice: str(r.azureVoice, /^[A-Za-z]{2,3}-[A-Za-z]{2,4}-[A-Za-z0-9:]+$/, 80, "Azure voice")!,
      azureStyle: str(r.azureStyle, /^[a-z-]+$/i, 40, "Azure style", true),
      geminiModel: str(r.geminiModel, /^[a-z0-9.-]+$/i, 80, "Gemini model")!,
      geminiVoice: str(r.geminiVoice, /^[A-Za-z]+$/, 40, "Gemini voice")!,
      geminiStyle: str(r.geminiStyle, /^[^<>{}]*$/, 200, "Gemini speaking style", true),
      elevenVoiceId: str(r.elevenVoiceId, /^[A-Za-z0-9]+$/, 60, "ElevenLabs voice id")!,
      elevenModel: str(r.elevenModel, /^[a-z0-9_]+$/i, 60, "ElevenLabs model")!,
    };
  } catch (e) {
    return e instanceof Error ? e.message : "Invalid settings";
  }
}

export async function GET() {
  const denied = await requireSuperAdmin();
  if (denied) return denied;
  return NextResponse.json({
    config: await getVoiceConfig(),
    defaults: VOICE_DEFAULTS,
    keys: keyStatus(),
    envRegion: process.env.AZURE_SPEECH_REGION ?? null,
    suggestions: VOICE_SUGGESTIONS,
  });
}

export async function PUT(req: Request) {
  const denied = await requireSuperAdmin(req);
  if (denied) return denied;
  const cfg = parseConfig(await req.json().catch(() => null));
  if (typeof cfg === "string") return NextResponse.json({ error: cfg }, { status: 400 });
  await db.voiceSettings.upsert({ where: { id: "singleton" }, update: cfg, create: { id: "singleton", ...cfg } });
  return NextResponse.json({ config: await getVoiceConfig() });
}

const TEST_LINE = "Red blood cells?! Oh no. Come here, let me show you how this really works.";

export async function POST(req: Request) {
  const denied = await requireSuperAdmin(req);
  if (denied) return denied;
  const body = (await req.json().catch(() => null)) as { config?: unknown; provider?: unknown } | null;
  const cfg = parseConfig(body?.config);
  if (typeof cfg === "string") return NextResponse.json({ error: cfg }, { status: 400 });
  const provider = isProvider(body?.provider) ? body!.provider : cfg.provider;
  try {
    const t0 = Date.now();
    const s = await testVoice(provider, TEST_LINE, cfg);
    return new NextResponse(new Uint8Array(s.data), {
      headers: { "Content-Type": s.mime, "X-Voice-Latency-Ms": String(Date.now() - t0), "Cache-Control": "no-store" },
    });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Test failed" }, { status: 502 });
  }
}
