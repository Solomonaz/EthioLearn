import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/get-session";
import { validateCsrfOrigin } from "@/lib/csrf";
import { rateLimit } from "@/lib/rate-limit";
import { usageActor } from "@/lib/usage-logger";
import { featureDenial } from "@/lib/entitlements";
import { CLOUD_VOICES, cloudChain, getVoiceConfig, MAX_TTS_CHARS, speak, verifyLine, type CloudVoiceId } from "@/lib/tts";

/**
 * Read-aloud for the Whiteboard Tutor.
 *
 * GET  → { cloud: boolean } — whether an admin-chosen voice service is set up
 *        (false = the page uses the browser's own voice).
 * POST { text, token, provider? } → audio for ONE lesson line. The token is the server's
 *        signature on (this user, this exact text), handed out with the lesson
 *        (lib/whiteboard-voice), so only lines the server wrote for this
 *        student can be spoken — never free text. Same gates as the AI tutor
 *        (Pro, the aiTutor switch, CSRF) plus its own rate limit. It does not
 *        use a tutor message: the lesson already did.
 *        204 = no voice service available; use the browser voice.
 *        `provider` pins the service the lesson started with (the page reads
 *        it from X-Voice-Provider on the first line), so one lesson never
 *        mixes voices: if that service fails, 503 — the page retries it
 *        rather than switching to another voice.
 */

type User = NonNullable<Awaited<ReturnType<typeof getCurrentUser>>>;

/**
 * The plan's cloud-voice feature + the tutor switch. A refusal makes the page
 * fall back to the browser's own (free) voice.
 */
async function refusal(user: User) {
  return featureDenial(user, "whiteboardVoice");
}

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const refused = await refusal(user);
  if (refused) return refused;
  const cfg = await getVoiceConfig();
  return NextResponse.json({ cloud: cloudChain(cfg).length > 0 });
}

export async function POST(req: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!validateCsrfOrigin(req)) {
    return NextResponse.json({ error: "Invalid request origin" }, { status: 403 });
  }
  // A lesson has ~8-12 lines, all fetched up front; lines already made come
  // from the cache. 120/min covers several lessons in a minute and still
  // bounds what a script could spend (and only on server-signed lines).
  const rl = rateLimit(`ai:tts:${user.id}`, 120, 60_000);
  if (!rl.success) {
    return NextResponse.json(
      { error: "Too many requests. Please wait a moment." },
      { status: 429, headers: { "Retry-After": String(rl.retryAfter) } },
    );
  }
  const refused = await refusal(user);
  if (refused) return refused;

  const body = (await req.json().catch(() => ({}))) as { text?: unknown; token?: unknown; provider?: unknown };
  if (typeof body.text !== "string" || !body.text.trim() || body.text.length > MAX_TTS_CHARS) {
    return NextResponse.json({ error: "Invalid text" }, { status: 400 });
  }
  if (!verifyLine(user.id, body.text, body.token)) {
    return NextResponse.json({ error: "This line can't be read aloud." }, { status: 403 });
  }

  let only: CloudVoiceId | undefined;
  if (body.provider !== undefined && body.provider !== null) {
    if (!(CLOUD_VOICES as unknown[]).includes(body.provider)) {
      return NextResponse.json({ error: "Invalid voice" }, { status: 400 });
    }
    only = body.provider as CloudVoiceId;
  }

  const speech = await speak(body.text, { actor: usageActor(user), only });
  if (!speech) {
    return only
      ? NextResponse.json({ error: "That voice is busy. Try again.", code: "VOICE_BUSY" }, { status: 503, headers: { "Retry-After": "2" } })
      : new NextResponse(null, { status: 204 });
  }

  return new NextResponse(new Uint8Array(speech.data), {
    status: 200,
    headers: {
      "Content-Type": speech.mime,
      "Content-Length": String(speech.data.length),
      "Cache-Control": "private, max-age=86400",
      "X-Voice-Provider": speech.provider,
      "X-Voice-Cached": speech.cached ? "1" : "0",
    },
  });
}
