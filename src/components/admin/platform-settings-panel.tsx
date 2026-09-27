"use client";

import { useEffect, useState } from "react";
import { Sparkles, CreditCard, Power, Gift, Shield } from "lucide-react";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Spinner } from "@/components/ui/spinner";
import { toast } from "@/components/ui/sonner";
import { cn } from "@/lib/utils";

interface Settings {
  aiEnabled: boolean;
  aiTutorEnabled: boolean;
  aiQuizGenEnabled: boolean;
  aiAdaptiveEnabled: boolean;
  aiMathToolsEnabled: boolean;
  aiTeacherAssistantEnabled: boolean;
  pricingEnabled: boolean;
  rewardsEnabled: boolean;
  antiCheatEnabled: boolean;
  teacherAiDefaultMonthlyCredits: number | null;
}

type Key = Exclude<keyof Settings, "teacherAiDefaultMonthlyCredits">;

function Toggle({
  checked,
  disabled,
  onChange,
}: {
  checked: boolean;
  disabled?: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn(
        "relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors",
        checked ? "bg-primary" : "bg-border",
        disabled && "cursor-not-allowed opacity-40",
      )}
    >
      <span
        className={cn(
          "inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform",
          checked ? "translate-x-5" : "translate-x-1",
        )}
      />
    </button>
  );
}

function Row({
  label,
  desc,
  checked,
  disabled,
  onChange,
}: {
  label: string;
  desc: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <div className="flex items-start justify-between gap-4 py-3">
      <div className="min-w-0">
        <p className={cn("text-sm font-medium", disabled ? "text-text-muted" : "text-text-primary")}>
          {label}
        </p>
        <p className="mt-0.5 text-xs text-text-secondary">{desc}</p>
      </div>
      <Toggle checked={checked} disabled={disabled} onChange={onChange} />
    </div>
  );
}

/**
 * The default monthly AI credits for secondary teachers. Saved on an explicit
 * button press rather than per keystroke, so typing "300" never briefly caps
 * every teacher at 3.
 */
function TeacherCreditsRow({
  value,
  disabled,
  onSave,
}: {
  value: number | null;
  disabled?: boolean;
  onSave: (v: number | null) => Promise<boolean>;
}) {
  const [draft, setDraft] = useState(value === null ? "" : String(value));
  const [saving, setSaving] = useState(false);
  useEffect(() => setDraft(value === null ? "" : String(value)), [value]);

  const trimmed = draft.trim();
  const parsed = trimmed === "" ? null : Number(trimmed);
  const valid = parsed === null || (Number.isInteger(parsed) && parsed >= 0 && parsed <= 100_000);
  const dirty = parsed !== value;

  return (
    <div className="flex flex-wrap items-start justify-between gap-4 py-3">
      <div className="min-w-0 flex-1">
        <p className={cn("text-sm font-medium", disabled ? "text-text-muted" : "text-text-primary")}>
          Default teacher AI credits / month
        </p>
        <p className="mt-0.5 text-xs text-text-secondary">
          Used when a school&apos;s plan sets no limit, and always while pricing is off. An
          assistant reply is 1 credit, a workout set or merge 2, an AI-written paper 1 per
          question. Blank = no cap.
        </p>
      </div>
      <div className="flex items-center gap-2">
        <input
          type="number"
          min={0}
          max={100000}
          inputMode="numeric"
          aria-label="Default teacher AI credits per month"
          value={draft}
          disabled={disabled || saving}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="No cap"
          className={cn(
            "h-9 w-24 rounded-lg border bg-surface px-2 text-right text-sm text-text-primary",
            valid ? "border-border" : "border-error",
          )}
        />
        <button
          type="button"
          disabled={disabled || saving || !dirty || !valid}
          onClick={async () => {
            setSaving(true);
            await onSave(parsed);
            setSaving(false);
          }}
          className="h-9 rounded-lg bg-primary px-3 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-40"
        >
          {saving ? "Saving…" : "Save"}
        </button>
      </div>
    </div>
  );
}

/**
 * Global platform kill-switches (SUPER_ADMIN only). Renders nothing for other
 * roles — the API returns 403 and we hide the panel.
 */
export function PlatformSettingsPanel() {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [loading, setLoading] = useState(true);
  const [forbidden, setForbidden] = useState(false);
  const [savingKey, setSavingKey] = useState<Key | null>(null);

  useEffect(() => {
    fetch("/api/admin/platform-settings")
      .then((r) => {
        if (r.status === 403) {
          setForbidden(true);
          return null;
        }
        return r.ok ? r.json() : null;
      })
      .then((d) => d?.settings && setSettings(d.settings))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  async function update(key: Key, value: boolean) {
    // Functional update so toggling several switches quickly never clobbers each
    // other — each change touches ONLY its own key. (The old code merged a stale
    // full snapshot / overwrote with the whole response, which flipped the
    // others back on.)
    setSettings((prev) => (prev ? { ...prev, [key]: value } : prev));
    setSavingKey(key);
    try {
      const res = await fetch("/api/admin/platform-settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ [key]: value }),
      });
      if (!res.ok) throw new Error();
      // Confirm ONLY this key from the authoritative response — never overwrite
      // the whole object (a concurrent toggle may not be reflected in it yet).
      const d = await res.json().catch(() => null);
      const confirmed = typeof d?.settings?.[key] === "boolean" ? d.settings[key] : value;
      setSettings((prev) => (prev ? { ...prev, [key]: confirmed } : prev));
      toast.success("Setting updated.");
    } catch {
      setSettings((prev) => (prev ? { ...prev, [key]: !value } : prev)); // revert only this key
      toast.error("Couldn't update the setting.");
    } finally {
      setSavingKey((prev) => (prev === key ? null : prev));
    }
  }

  async function saveTeacherCredits(value: number | null): Promise<boolean> {
    try {
      const res = await fetch("/api/admin/platform-settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ teacherAiDefaultMonthlyCredits: value }),
      });
      const d = await res.json().catch(() => null);
      if (!res.ok) throw new Error(d?.error);
      const confirmed = d?.settings?.teacherAiDefaultMonthlyCredits ?? null;
      setSettings((prev) => (prev ? { ...prev, teacherAiDefaultMonthlyCredits: confirmed } : prev));
      toast.success("Teacher AI credits updated.");
      return true;
    } catch (err) {
      toast.error(err instanceof Error && err.message ? err.message : "Couldn't update the setting.");
      return false;
    }
  }

  if (forbidden) return null;

  if (loading) {
    return (
      <Card>
        <CardContent className="flex items-center justify-center py-8">
          <Spinner size="md" className="text-primary" />
        </CardContent>
      </Card>
    );
  }

  if (!settings) return null;

  const aiOff = !settings.aiEnabled;

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-2">
          <Power className="h-5 w-5 text-primary" />
          <h2 className="font-semibold text-text-primary">Platform Controls</h2>
        </div>
        <p className="mt-1 text-sm text-text-secondary">
          Global on/off switches for the whole platform. Turn AI off to launch without an AI bill,
          and pricing off to run free for everyone.
        </p>
      </CardHeader>

      <CardContent className="pt-0">
        {/* AI section */}
        <div className="mb-1 flex items-center gap-2 border-b border-border pb-1 pt-2">
          <Sparkles className="h-4 w-4 text-primary" />
          <span className="text-sm font-semibold text-text-primary">AI Services</span>
          {savingKey?.startsWith("ai") && <Spinner size="sm" className="text-primary" />}
        </div>

        <Row
          label="AI — master switch"
          desc="Turns every AI feature below off at once. Off = no AI usage, no AI bill."
          checked={settings.aiEnabled}
          onChange={(v) => update("aiEnabled", v)}
        />
        <div className="divide-y divide-border border-l-2 border-border/60 pl-4">
          <Row
            label="AI Tutor (chat)"
            desc="Ask-anything AI tutor for students."
            checked={settings.aiTutorEnabled}
            disabled={aiOff}
            onChange={(v) => update("aiTutorEnabled", v)}
          />
          <Row
            label="AI Question / Quiz Generation"
            desc="Admin question generation and student AI quizzes."
            checked={settings.aiQuizGenEnabled}
            disabled={aiOff}
            onChange={(v) => update("aiQuizGenEnabled", v)}
          />
          <Row
            label="Adaptive Difficulty"
            desc="AI that tunes quiz difficulty to each student."
            checked={settings.aiAdaptiveEnabled}
            disabled={aiOff}
            onChange={(v) => update("aiAdaptiveEnabled", v)}
          />
          <Row
            label="AI in Graphing & 3D Geometry"
            desc="Natural-language graphing, graph-photo explanations, and the 3D geometry AI helper."
            checked={settings.aiMathToolsEnabled}
            disabled={aiOff}
            onChange={(v) => update("aiMathToolsEnabled", v)}
          />
          <Row
            label="Teachers' AI Assistant"
            desc="Lesson plans, worksheets and notes for teachers, and AI-written workout problems. Separate from the student tutor."
            checked={settings.aiTeacherAssistantEnabled}
            disabled={aiOff}
            onChange={(v) => update("aiTeacherAssistantEnabled", v)}
          />
          <TeacherCreditsRow
            value={settings.teacherAiDefaultMonthlyCredits}
            disabled={aiOff || !settings.aiTeacherAssistantEnabled}
            onSave={saveTeacherCredits}
          />
        </div>

        {/* Pricing section */}
        <div className="mb-1 mt-5 flex items-center gap-2 border-b border-border pb-1">
          <CreditCard className="h-4 w-4 text-primary" />
          <span className="text-sm font-semibold text-text-primary">Pricing</span>
          {savingKey === "pricingEnabled" && <Spinner size="sm" className="text-primary" />}
        </div>
        <Row
          label="Paid plans & billing"
          desc="Off = hide all pricing/billing and give every student full (non-AI) access for free."
          checked={settings.pricingEnabled}
          onChange={(v) => update("pricingEnabled", v)}
        />

        {/* Rewards & Academic Integrity section */}
        <div className="mb-1 mt-5 flex items-center gap-2 border-b border-border pb-1">
          <Gift className="h-4 w-4 text-primary" />
          <span className="text-sm font-semibold text-text-primary">Rewards & Academic Integrity</span>
          {(savingKey === "rewardsEnabled" || savingKey === "antiCheatEnabled") && (
            <Spinner size="sm" className="text-primary" />
          )}
        </div>
        <Row
          label="Rewards Program"
          desc="Enable the rewards store and item redemption for students. Turn off to host without prizes."
          checked={settings.rewardsEnabled}
          onChange={(v) => update("rewardsEnabled", v)}
        />
        <div className="divide-y divide-border border-l-2 border-border/60 pl-4">
          <Row
            label="Anti-Cheat Tracking"
            desc={
              !settings.rewardsEnabled
                ? "Auto-disabled while Rewards are turned off (tab-switch penalties and copy/paste restrictions are inactive)."
                : "Enforce tab-switch auto-submit penalties and copy/paste restrictions during quizzes and battles."
            }
            checked={settings.rewardsEnabled && settings.antiCheatEnabled}
            disabled={!settings.rewardsEnabled}
            onChange={(v) => update("antiCheatEnabled", v)}
          />
        </div>
      </CardContent>
    </Card>
  );
}
