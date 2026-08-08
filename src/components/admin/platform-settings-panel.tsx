"use client";

import { useEffect, useState } from "react";
import { Sparkles, CreditCard, Power } from "lucide-react";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Spinner } from "@/components/ui/spinner";
import { toast } from "@/components/ui/sonner";
import { cn } from "@/lib/utils";

interface Settings {
  aiEnabled: boolean;
  aiTutorEnabled: boolean;
  aiVideoEnabled: boolean;
  aiQuizGenEnabled: boolean;
  aiAdaptiveEnabled: boolean;
  pricingEnabled: boolean;
}

type Key = keyof Settings;

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
    if (!settings) return;
    const prev = settings;
    setSettings({ ...settings, [key]: value });
    setSavingKey(key);
    try {
      const res = await fetch("/api/admin/platform-settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ [key]: value }),
      });
      if (!res.ok) throw new Error();
      const d = await res.json();
      if (d?.settings) setSettings(d.settings);
      toast.success("Setting updated.");
    } catch {
      setSettings(prev); // roll back
      toast.error("Couldn't update the setting.");
    } finally {
      setSavingKey(null);
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
            label="AI Video Tutorials"
            desc="Generated animated video explanations."
            checked={settings.aiVideoEnabled}
            disabled={aiOff}
            onChange={(v) => update("aiVideoEnabled", v)}
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
      </CardContent>
    </Card>
  );
}
