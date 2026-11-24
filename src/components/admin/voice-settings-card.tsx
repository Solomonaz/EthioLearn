"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowDown, ArrowUp, CheckCircle2, KeyRound, Play, Save, Volume2, XCircle } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type Cloud = "AZURE" | "GEMINI" | "ELEVENLABS";

interface Config {
  /** Services to try, first to last; the browser voice is always the last resort. */
  voiceOrder: Cloud[];
  azureRegion: string | null;
  azureVoice: string;
  azureStyle: string | null;
  geminiModel: string;
  geminiVoice: string;
  geminiStyle: string | null;
  elevenVoiceId: string;
  elevenModel: string;
  tutorStyle: TutorStyle;
}

type TutorStyle = "sassy" | "friendly" | "calm";
const STYLES: { id: TutorStyle; name: string; sample: string }[] = [
  {
    id: "sassy",
    name: "Sassy & dramatic (study-TikTok style)",
    sample: "“WAIT. The HEART?! Bestie, no. Sit down — your heart is a delivery guy, not the factory.”",
  },
  {
    id: "friendly",
    name: "Warm & playful",
    sample: "“Oops, not quite! Your heart pumps blood — it doesn’t make it. Let me show you.”",
  },
  {
    id: "calm",
    name: "Calm & clear",
    sample: "“Let’s look at this together. Red blood cells are made in the bone marrow.”",
  },
];

interface Snapshot {
  config: Config;
  keys: Record<Cloud | "BROWSER", boolean>;
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

const SERVICES: Record<Cloud, { name: string; env: string; note: string }> = {
  AZURE: { name: "Azure Speech", env: "AZURE_SPEECH_KEY", note: "Natural neural voices, MP3 (small). Billed per character." },
  GEMINI: { name: "Gemini TTS", env: "GEMINI_API_KEY", note: "Very expressive, but slower (~4 s a line) and WAV (~50 KB per second — heavier on mobile data)." },
  ELEVENLABS: { name: "ElevenLabs", env: "ELEVENLABS_API_KEY", note: "Most lifelike, fast. MP3 (small). Billed per character, by plan." },
};
const ALL: Cloud[] = ["AZURE", "GEMINI", "ELEVENLABS"];
const TEST_LINE = "Red blood cells?! Oh no. Come here, let me show you how this really works.";

const INPUT =
  "w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-text-primary outline-none focus:border-primary focus:ring-2 focus:ring-primary/20";

const ORDINAL = ["1st", "2nd", "3rd"];

/**
 * Admin → AI Models → Read-aloud voice: which services read the Whiteboard
 * Tutor aloud and in what order (GET/PUT/POST /api/admin/voice). Students
 * hear the first service that works; the browser voice is always last.
 * Keys stay in the environment.
 */
export function VoiceSettingsCard() {
  const [snap, setSnap] = useState<Snapshot | null>(null);
  const [cfg, setCfg] = useState<Config | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState<Cloud | "BROWSER" | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const audio = useRef<AudioContext | null>(null);

  useEffect(() => {
    fetch("/api/admin/voice")
      .then(async (r) => {
        const d = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(d.error || `Could not load the voice settings (${r.status}).`);
        setSnap(d as Snapshot);
        setCfg((d as Snapshot).config);
      })
      .catch((e) => setLoadError(e instanceof Error ? e.message : "Could not load the voice settings."));
  }, []);

  if (!snap || !cfg) {
    return (
      <section className="space-y-3" data-testid="voice-settings">
        <div className="flex items-center gap-2">
          <Volume2 className="h-5 w-5 text-primary" />
          <h2 className="text-lg font-bold text-text-primary">Read-aloud voice</h2>
        </div>
        <Card>
          <CardContent className={cn("p-5 text-sm", loadError ? "text-error" : "text-text-secondary")} data-testid="voice-load">
            {loadError ?? "Loading voice settings…"}
          </CardContent>
        </Card>
      </section>
    );
  }

  const set = <K extends keyof Config>(k: K, v: Config[K]) => setCfg({ ...cfg, [k]: v });
  const dirty = JSON.stringify(cfg) !== JSON.stringify(snap.config);
  const order = cfg.voiceOrder;
  const unused = ALL.filter((p) => !order.includes(p));

  const move = (p: Cloud, dir: -1 | 1) => {
    const i = order.indexOf(p);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= order.length) return;
    const next = [...order];
    [next[i], next[j]] = [next[j], next[i]];
    set("voiceOrder", next);
  };
  const toggle = (p: Cloud) =>
    set("voiceOrder", order.includes(p) ? order.filter((x) => x !== p) : [...order, p]);

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
      if (!res.ok) throw new Error(d.error || `Save failed (${res.status}).`);
      setSnap({ ...snap!, config: d.config });
      setCfg(d.config);
      setMsg({ ok: true, text: "Saved. New lessons use these settings right away." });
    } catch (e) {
      setMsg({ ok: false, text: e instanceof Error ? e.message : "Save failed" });
    } finally {
      setSaving(false);
    }
  }

  async function test(p: Cloud | "BROWSER") {
    setMsg(null);
    if (p === "BROWSER") {
      const u = new SpeechSynthesisUtterance(TEST_LINE);
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
      setMsg({ ok: true, text: `${SERVICES[p].name} works — ${kb} KB, ${src.buffer.duration.toFixed(1)} s of audio, made in ${ms} ms.` });
    } catch (e) {
      setMsg({ ok: false, text: e instanceof Error ? e.message : "Test failed" });
    } finally {
      setTesting(null);
    }
  }

  const settingsFor = (p: Cloud) => {
    if (p === "AZURE") {
      return (
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
      );
    }
    if (p === "GEMINI") {
      return (
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
          <Field label="Tone (a few words, not read aloud)">
            <input
              className={INPUT}
              placeholder="warm, playful, slightly sassy teacher"
              value={cfg.geminiStyle ?? ""}
              onChange={(e) => set("geminiStyle", e.target.value || null)}
            />
          </Field>
        </div>
      );
    }
    return (
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <Field label="Voice">
          <select className={INPUT} value={cfg.elevenVoiceId} onChange={(e) => set("elevenVoiceId", e.target.value)}>
            {!snap.suggestions.eleven.some((v) => v.id === cfg.elevenVoiceId) && <option value={cfg.elevenVoiceId}>{cfg.elevenVoiceId}</option>}
            {snap.suggestions.eleven.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
          </select>
        </Field>
        <Field label="Model">
          <select className={INPUT} value={cfg.elevenModel} onChange={(e) => set("elevenModel", e.target.value)}>
            {[...new Set([cfg.elevenModel, ...snap.suggestions.elevenModels])].map((v) => <option key={v} value={v}>{v}</option>)}
          </select>
        </Field>
      </div>
    );
  };

  const row = (p: Cloud) => {
    const s = SERVICES[p];
    const hasKey = snap.keys[p];
    const pos = order.indexOf(p);
    const on = pos >= 0;
    return (
      <div
        key={p}
        className={cn("rounded-xl border p-4 transition-colors", on ? "border-primary/50 bg-primary/5" : "border-border opacity-80")}
        data-testid={`voice-${p}`}
      >
        <div className="flex flex-wrap items-center gap-2">
          {on ? (
            <span className="flex h-7 min-w-[2.25rem] items-center justify-center rounded-full bg-primary px-2 text-xs font-bold text-white" data-testid={`voice-pos-${p}`}>
              {ORDINAL[pos]}
            </span>
          ) : (
            <span className="flex h-7 min-w-[2.25rem] items-center justify-center rounded-full bg-border px-2 text-xs font-bold text-text-muted">off</span>
          )}
          <span className="font-semibold text-text-primary">{s.name}</span>
          {hasKey ? (
            <span className="inline-flex items-center gap-1 text-xs text-success">
              <CheckCircle2 className="h-3.5 w-3.5" /> key set
            </span>
          ) : (
            <span className="inline-flex items-center gap-1 text-xs text-error">
              <XCircle className="h-3.5 w-3.5" /> {s.env} missing
            </span>
          )}
          <div className="ml-auto flex items-center gap-1">
            {on && (
              <>
                <button
                  type="button"
                  onClick={() => move(p, -1)}
                  disabled={pos === 0}
                  className="flex h-8 w-8 items-center justify-center rounded-lg border border-border text-text-secondary hover:bg-border/40 disabled:opacity-30"
                  aria-label={`Move ${s.name} up`}
                  data-testid={`voice-up-${p}`}
                >
                  <ArrowUp className="h-4 w-4" />
                </button>
                <button
                  type="button"
                  onClick={() => move(p, 1)}
                  disabled={pos === order.length - 1}
                  className="flex h-8 w-8 items-center justify-center rounded-lg border border-border text-text-secondary hover:bg-border/40 disabled:opacity-30"
                  aria-label={`Move ${s.name} down`}
                  data-testid={`voice-down-${p}`}
                >
                  <ArrowDown className="h-4 w-4" />
                </button>
              </>
            )}
            <Button
              variant="ghost"
              size="sm"
              onClick={() => test(p)}
              isLoading={testing === p}
              disabled={!!testing || !hasKey}
              data-testid={`voice-test-${p}`}
            >
              <Play className="mr-1.5 h-3.5 w-3.5" /> Test
            </Button>
            <label className="ml-1 inline-flex cursor-pointer items-center gap-2 text-xs font-semibold text-text-secondary">
              <input
                type="checkbox"
                checked={on}
                onChange={() => toggle(p)}
                className="peer sr-only"
                data-testid={`voice-toggle-${p}`}
              />
              <span className="relative h-5 w-9 rounded-full bg-border transition-colors after:absolute after:left-0.5 after:top-0.5 after:h-4 after:w-4 after:rounded-full after:bg-white after:shadow after:transition-transform peer-checked:bg-primary peer-checked:after:translate-x-4 peer-focus-visible:ring-2 peer-focus-visible:ring-primary/40" />
              {on ? "On" : "Off"}
            </label>
          </div>
        </div>
        <p className="mt-1 text-xs text-text-secondary">{s.note}</p>
        {on && !hasKey && (
          <p className="mt-2 flex items-start gap-2 rounded-lg bg-warning/10 p-2 text-xs text-warning">
            <KeyRound className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            No API key on the server, so this one is skipped and the next in line is used.
          </p>
        )}
        {settingsFor(p)}
      </div>
    );
  };

  return (
    <section className="space-y-3" data-testid="voice-settings">
      <div className="flex items-center gap-2">
        <Volume2 className="h-5 w-5 text-primary" />
        <h2 className="text-lg font-bold text-text-primary">Whiteboard voice &amp; style</h2>
      </div>
      <p className="text-sm text-text-secondary">
        The voices that read the Whiteboard Tutor to students. Students hear the <strong>first service that works</strong>,
        from the top down; if none works, their own browser voice. Change the order with the arrows any day — turn a
        service off to skip it. Each spoken line is made once and cached, so replays cost nothing.
      </p>
      <Card>
        <CardContent className="space-y-3 p-4">
          <p className="text-xs font-bold uppercase tracking-wide text-text-muted">How the guide talks</p>
          <div className="grid gap-2 md:grid-cols-3" role="radiogroup" aria-label="How the guide talks">
            {STYLES.map((st) => (
              <label
                key={st.id}
                className={cn(
                  "cursor-pointer rounded-xl border p-3 transition-colors",
                  cfg.tutorStyle === st.id ? "border-primary bg-primary/5 ring-1 ring-primary/40" : "border-border hover:bg-border/30",
                )}
                data-testid={`style-${st.id}`}
              >
                <span className="flex items-center gap-2">
                  <input
                    type="radio"
                    name="tutor-style"
                    checked={cfg.tutorStyle === st.id}
                    onChange={() => set("tutorStyle", st.id)}
                    className="h-4 w-4 accent-[var(--color-primary)]"
                  />
                  <span className="text-sm font-semibold text-text-primary">{st.name}</span>
                </span>
                <span className="mt-1 block text-xs italic text-text-secondary">{st.sample}</span>
              </label>
            ))}
          </div>
          <p className="text-xs text-text-secondary">
            Used for every new Whiteboard lesson — quiz mistakes and uploads. Lessons already made keep their style.
          </p>

          <p className="pt-2 text-xs font-bold uppercase tracking-wide text-text-muted">Voices — tried in this order</p>
          {order.length === 0 && (
            <p className="rounded-lg border border-dashed border-border p-3 text-sm text-text-secondary">
              No service is on — students hear their browser voice. Turn one on below.
            </p>
          )}
          {order.map(row)}

          {unused.length > 0 && (
            <>
              <p className="pt-2 text-xs font-bold uppercase tracking-wide text-text-muted">Off</p>
              {unused.map(row)}
            </>
          )}

          {/* always last */}
          <div className="flex flex-wrap items-center gap-2 rounded-xl border border-dashed border-border p-4" data-testid="voice-BROWSER">
            <span className="flex h-7 min-w-[2.25rem] items-center justify-center rounded-full bg-border px-2 text-xs font-bold text-text-secondary">last</span>
            <span className="font-semibold text-text-primary">Browser voice</span>
            <span className="text-xs text-text-secondary">Free, always the last resort. Quality depends on the student&apos;s device.</span>
            <Button variant="ghost" size="sm" className="ml-auto" onClick={() => test("BROWSER")}>
              <Play className="mr-1.5 h-3.5 w-3.5" /> Test
            </Button>
          </div>

          <div className="flex flex-wrap items-center gap-3 pt-1">
            <Button onClick={save} isLoading={saving} disabled={!dirty || saving} data-testid="voice-save">
              <Save className="mr-1.5 h-4 w-4" /> Save voice
            </Button>
            {dirty && !msg && <span className="text-xs text-warning">Unsaved changes</span>}
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
