"use client";

import { useCallback, useEffect, useState } from "react";
import { Bell, BellOff, CheckCircle2, Smartphone, AlertTriangle } from "lucide-react";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/sonner";
import {
  currentPushSubscription,
  disablePush,
  enablePush,
  notificationPermission,
  pushSupported,
} from "@/lib/push-client";

interface ReminderStatus {
  enabled: boolean;
  paused: boolean;
  telegram: { available: boolean; linked: boolean; reachable: boolean };
  push: { available: boolean; vapidPublicKey: string | null; devices: number };
}

/**
 * Study reminders on the student settings page: master switch, Telegram
 * status and push notifications for this device. Linking Telegram itself
 * stays in the Account card above.
 */
export function ReminderSettingsCard() {
  const [status, setStatus] = useState<ReminderStatus | null>(null);
  const [thisDevice, setThisDevice] = useState(false);
  const [supported, setSupported] = useState(false);
  const [permission, setPermission] = useState<string>("default");
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    const res = await fetch("/api/students/me/reminders");
    if (res.ok) setStatus(await res.json());
    setSupported(pushSupported());
    setPermission(notificationPermission());
    setThisDevice(!!(await currentPushSubscription().catch(() => null)));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function patch(body: Record<string, unknown>) {
    const res = await fetch("/api/students/me/reminders", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (res.ok) setStatus(await res.json());
    else toast.error("Couldn't save. Please try again.");
  }

  async function toggleEnabled() {
    if (!status) return;
    setBusy("enabled");
    await patch({ enabled: !status.enabled });
    setBusy(null);
  }

  async function togglePush() {
    if (!status?.push.vapidPublicKey) return;
    setBusy("push");
    try {
      if (thisDevice) {
        await disablePush();
        toast.success("Notifications turned off on this device.");
      } else {
        const r = await enablePush(status.push.vapidPublicKey);
        if (r === "ok") toast.success("Notifications on for this device.");
        else if (r === "denied") toast.error("Notifications are blocked. Allow them for this site in your browser settings.");
        else toast.error("Couldn't turn on notifications on this device.");
      }
      await load();
    } finally {
      setBusy(null);
    }
  }

  if (!status) return null;
  const anyChannel = status.telegram.available || status.push.available;
  if (!anyChannel) return null;

  return (
    <Card id="reminders">
      <CardHeader>
        <div className="flex items-center gap-2">
          <Bell className="h-5 w-5 text-primary" />
          <h2 className="text-lg font-semibold text-text-primary">Study reminders</h2>
        </div>
      </CardHeader>
      <CardContent>
        <div className="space-y-3">
          <p className="text-sm text-text-secondary">
            A morning nudge when today&apos;s Daily Challenge is ready, and an evening one if your streak is about to end.
            At most two a day — and none on days you&apos;ve already studied.
          </p>

          <div className="flex items-center justify-between gap-3 rounded-lg border border-border p-4">
            <div>
              <p className="text-sm font-medium text-text-primary">Send me study reminders</p>
              <p className="text-xs text-text-secondary">{status.enabled ? "On" : "Off"}</p>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={status.enabled}
              aria-label="Send me study reminders"
              onClick={toggleEnabled}
              disabled={busy === "enabled"}
              className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors ${
                status.enabled ? "bg-primary" : "bg-gray-300"
              }`}
            >
              <span
                className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform ${
                  status.enabled ? "translate-x-5" : "translate-x-0.5"
                }`}
              />
            </button>
          </div>

          {status.enabled && status.paused && (
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-amber-50 px-4 py-3">
              <p className="flex items-center gap-2 text-sm text-amber-800">
                <BellOff className="h-4 w-4" />
                Paused because you hadn&apos;t studied in a while. They restart when you study.
              </p>
              <Button size="sm" variant="outline" onClick={() => patch({ resume: true })}>
                Resume now
              </Button>
            </div>
          )}

          {status.enabled && (
            <>
              {status.telegram.available && (
                <div className="flex items-center justify-between gap-3 rounded-lg border border-border p-4">
                  <div>
                    <p className="text-sm font-medium text-text-primary">Telegram</p>
                    <p className="text-xs text-text-secondary">
                      {status.telegram.reachable
                        ? "Reminders come from the Abugida bot."
                        : status.telegram.linked
                          ? "We couldn't reach you on Telegram. Unblock the Abugida bot, then sign in with Telegram once more."
                          : "Connect Telegram in Account above to get reminders there."}
                    </p>
                  </div>
                  {status.telegram.reachable ? (
                    <CheckCircle2 className="h-5 w-5 shrink-0 text-green-500" />
                  ) : status.telegram.linked ? (
                    <AlertTriangle className="h-5 w-5 shrink-0 text-amber-500" />
                  ) : null}
                </div>
              )}

              {status.push.available && (
                <div className="flex items-center justify-between gap-3 rounded-lg border border-border p-4">
                  <div className="flex items-start gap-2">
                    <Smartphone className="mt-0.5 h-4 w-4 shrink-0 text-text-secondary" />
                    <div>
                      <p className="text-sm font-medium text-text-primary">Notifications on this device</p>
                      <p className="text-xs text-text-secondary">
                        {!supported
                          ? "This browser can't show notifications. Try Chrome, or install the Abugida app."
                          : permission === "denied"
                            ? "Blocked — allow notifications for this site in your browser settings."
                            : thisDevice
                              ? "On"
                              : "Off"}
                      </p>
                    </div>
                  </div>
                  {supported && permission !== "denied" && (
                    <Button
                      size="sm"
                      variant={thisDevice ? "outline" : "primary"}
                      onClick={togglePush}
                      isLoading={busy === "push"}
                    >
                      {thisDevice ? "Turn off" : "Turn on"}
                    </Button>
                  )}
                </div>
              )}
            </>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
