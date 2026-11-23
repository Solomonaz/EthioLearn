"use client";

import { useEffect, useRef, useState } from "react";
import { CheckCircle2, KeyRound, Play, Save, Volume2, XCircle } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type Provider = "BROWSER" | "AZURE" | "GEMINI" | "ELEVENLABS";

interface Config {
  provider: Provider;
  fallbackProvider: Provider | null;
  azureRegion: string | null;
  azureVoice: string;
  azureStyle: string | null;
  geminiModel: string;
  geminiVoice: string;
  geminiStyle: string | null;
  elevenVoiceId: string;
  elevenModel: string;
}

interface Snapshot {
  config: Config;
  keys: Record<Provider, boolean>;
  envRegion: string | null;
  suggestions: {
    azure: string[];
    azureStyles: string[];
    gemini: string[];
    geminiModels: string[];
    eleven: { id: string; name: string }[];
    elevenModels: string[];
  };
}

const PROVIDERS: { id: Provider; name: string; env?: string; note: string }[] = [
  { id: "BROWSER", name: "Browser voice", note: "Free. Uses the student's own device voice — quality varies a lot." },
  { id: "AZURE", name: "Azure Speech", env: "AZURE_SPEECH_KEY", note: "Natural neural voices, MP3 (small). Billed per character." },
  { id: "GEMINI", name: "Gemini TTS", env: "GEMINI_API_KEY", note: "Very expressive. WAV audio (~50 KB per second — heavier on mobile data)." },
  { id: "ELEVENLABS", name: "ElevenLabs", env: "ELEVENLABS_API_KEY", note: "Most lifelike. MP3 (small). Billed per character, by plan." },
];

const INPUT =
  "w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-text-primary outline-none focus:border-primary focus:ring-2 focus:ring-primary/20";

/**
 * Admin → AI Models → Read-aloud voice: which service reads the Whiteboard
 * Tutor aloud (GET/PUT/POST /api/admin/voice). Keys stay in the environment.
 */
export function VoiceSettingsCard() {
  const [snap, setSnap] = useState<Snapshot | null>(null);
  const [cfg, setCfg] = useState<Config | null>(null);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState<Provider | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const audio = useRef<AudioContext | null>(null);

  useEffect(() => {
    fetch("/api/admin/voice")
      .then((r) => r.json())
      .then((d: Snapshot) => {
        setSnap(d);
        setCfg(d.config);
      })
      .catch(() => setMsg({ ok: false, text: "Could not load the voice settings." }));
  }, []);

  if (!snap || !cfg) {
    return (
      <Card>
        <CardContent className="p-5 text-sm text-text-secondary">{msg?.text ?? "Loading voice settings…"}</CardContent>
      </Card>
    );
  }

  const set = <K extends keyof Config>(k: K, v: Config[K]) => setCfg({ ...cfg, [k]: v });
  const dirty = JSON.stringify(cfg) !== JSON.stringify(snap.config);

  async function save() {
    setSaving(true);
    setMsg(null);
    try {
      const res = await fetch("/api/admin/voice", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(cfg),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(d.error || "Save failed");
      setSnap({ ...snap!, config: d.config });
      setCfg(d.config);
      setMsg({ ok: true, text: "Saved. New lessons use this voice right away." });
    } catch (e) {
      setMsg({ ok: false, text: e instanceof Error ? e.message : "Save failed" });
    } finally {
      setSaving(false);
    }
  }

  async function test(p: Provider) {
    setMsg(null);
    if (p === "BROWSER") {
      const u = new SpeechSynthesisUtterance("Red blood cells?! Oh no. Come here, let me show you how this really works.");
      u.lang = "en-US";
      speechSynthesis.cancel();
      speechSynthesis.speak(u);
      return;
    }
    setTesting(p);
    try {
      const res = await fetch("/api/admin/voice", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider: p, config: cfg }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d.error || `Test failed (${res.status})`);
      }
      const bytes = await res.arrayBuffer();
      const ms = res.headers.get("X-Voice-Latency-Ms");
      const kb = Math.round(bytes.byteLength / 1024); // decoding empties the buffer
      // Web Audio rather than <audio>: it decodes WAV and MP3 in every browser.
      audio.current ??= new AudioContext();
      const ctx = audio.current;
      await ctx.resume();
      const src = ctx.createBufferSource();
      src.buffer = await ctx.decodeAudioData(bytes);
      src.connect(ctx.destination);
      src.start();
      setMsg({
        ok: true,
        text: `${PROVIDERS.find((x) => x.id === p)!.name} works — ${kb} KB, ${src.buffer.duration.toFixed(1)} s of audio, made in ${ms} ms.`,
      });
    } catch (e) {
      setMsg({ ok: false, text: e instanceof Error ? e.message : "Test failed" });
    } finally {
      setTesting(null);
    }
  }

  const providerBlock = (p: (typeof PROVIDERS)[number]) => {
    const hasKey = snap.keys[p.id];
    const active = cfg.provider === p.id;
    return (
      <div
        key={p.id}
        className={cn("rounded-xl border p-4", active ? "border-primary bg-primary/5" : "border-border")}
        data-testid={`voice-${p.id}`}
      >
        <div className="flex flex-wrap items-center gap-3">
          <label className="flex min-w-0 flex-1 cursor-pointer items-center gap-2">
            <input
              type="radio"
              name="voice-provider"
              checked={active}
              onChange={() => set("provider", p.id)}
              className="h-4 w-4 accent-[var(--color-primary)]"
            />
            <span className="font-semibold text-text-primary">{p.name}</span>
            {p.env &&
              (hasKey ? (
                <span className="inline-flex items-center gap-1 text-xs text-success">
                  <CheckCircle2 className="h-3.5 w-3.5" /> key set
                </span>
              ) : (
                <span className="inline-flex items-center gap-1 text-xs text-error">
                  <XCircle className="h-3.5 w-3.5" /> {p.env} missing
                </span>
              ))}
          </label>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => test(p.id)}
            isLoading={testing === p.id}
            disabled={!!testing || (!!p.env && !hasKey)}
            data-testid={`voice-test-${p.id}`}
          >
            <Play className="mr-1.5 h-3.5 w-3.5" /> Test
          </Button>
        </div>
        <p className="mt-1 text-xs text-text-secondary">{p.note}</p>

        {p.id === "AZURE" && (
          <div className="mt-3 grid gap-3 sm:grid-cols-3">
            <Field label="Voice">
              <input list="azure-voices" className={INPUT} value={cfg.azureVoice} onChange={(e) => set("azureVoice", e.target.value)} />
              <datalist id="azure-voices">{snap.suggestions.azure.map((v) => <option key={v} value={v} />)}</datalist>
            </Field>
            <Field label="Style (optional)">
              <select className={INPUT} value={cfg.azureStyle ?? ""} onChange={(e) => set("azureStyle", e.target.value || null)}>
                {snap.suggestions.azureStyles.map((s) => <option key={s} value={s}>{s || "none"}</option>)}
              </select>
            </Field>
            <Field label={`Region${snap.envRegion ? ` (env: ${snap.envRegion})` : ""}`}>
              <input className={INPUT} placeholder={snap.envRegion ?? "eastus"} value={cfg.azureRegion ?? ""} onChange={(e) => set("azureRegion", e.target.value || null)} />
            </Field>
          </div>
        )}
        {p.id === "GEMINI" && (
          <div className="mt-3 grid gap-3 sm:grid-cols-3">
            <Field label="Model">
              <input list="gemini-models" className={INPUT} value={cfg.geminiModel} onChange={(e) => set("geminiModel", e.target.value)} />
              <datalist id="gemini-models">{snap.suggestions.geminiModels.map((v) => <option key={v} value={v} />)}</datalist>
            </Field>
            <Field label="Voice">
              <select className={INPUT} value={cfg.geminiVoice} onChange={(e) => set("geminiVoice", e.target.value)}>
                {[...new Set([cfg.geminiVoice, ...snap.suggestions.gemini])].map((v) => <option key={v} value={v}>{v}</option>)}
              </select>
            </Field>
            <Field label="Speaking style">
              <input className={INPUT} value={cfg.geminiStyle ?? ""} onChange={(e) => set("geminiStyle", e.target.value || null)} />
            </Field>
          </div>
        )}
        {p.id === "ELEVENLABS" && (
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <Field label="Voice id">
              <input list="eleven-voices" className={INPUT} value={cfg.elevenVoiceId} onChange={(e) => set("elevenVoiceId", e.target.value)} />
              <datalist id="eleven-voices">
                {snap.suggestions.eleven.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
              </datalist>
            </Field>
            <Field label="Model">
              <select className={INPUT} value={cfg.elevenModel} onChange={(e) => set("elevenModel", e.target.value)}>
                {[...new Set([cfg.elevenModel, ...snap.suggestions.elevenModels])].map((v) => <option key={v} value={v}>{v}</option>)}
              </select>
            </Field>
          </div>
        )}
      </div>
    );
  };

  return (
    <section className="space-y-3" data-testid="voice-settings">
      <div className="flex items-center gap-2">
        <Volume2 className="h-5 w-5 text-primary" />
        <h2 className="text-lg font-bold text-text-primary">Read-aloud voice</h2>
      </div>
      <p className="text-sm text-text-secondary">
        The voice that reads the Whiteboard Tutor to students. Each spoken line is made once and cached, so replays and
        the guide&apos;s stock lines cost nothing. If the service fails, the fallback is tried, then the browser voice.
      </p>
      <Card>
        <CardContent className="space-y-3 p-4">
          {PROVIDERS.map(providerBlock)}
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Fallback service (optional)">
              <select
                className={INPUT}
                value={cfg.fallbackProvider ?? ""}
                onChange={(e) => set("fallbackProvider", (e.target.value || null) as Provider | null)}
              >
                <option value="">None — straight to the browser voice</option>
                {PROVIDERS.filter((p) => p.id !== "BROWSER" && p.id !== cfg.provider).map((p) => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </select>
            </Field>
          </div>
          {cfg.provider !== "BROWSER" && !snap.keys[cfg.provider] && (
            <p className="flex items-start gap-2 rounded-lg bg-warning/10 p-3 text-xs text-warning">
              <KeyRound className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              No API key for this service on the server, so students will hear the fallback (or browser) voice.
            </p>
          )}
          <div className="flex flex-wrap items-center gap-3 pt-1">
            <Button onClick={save} isLoading={saving} disabled={!dirty || saving} data-testid="voice-save">
              <Save className="mr-1.5 h-4 w-4" /> Save voice
            </Button>
            {msg && (
              <p className={cn("text-sm", msg.ok ? "text-success" : "text-error")} data-testid="voice-msg">
                {msg.text}
              </p>
            )}
          </div>
        </CardContent>
      </Card>
    </section>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block space-y-1">
      <span className="text-xs font-semibold text-text-secondary">{label}</span>
      {children}
    </label>
  );
}
