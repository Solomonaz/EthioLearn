"use client";

import { useState } from "react";
import Link from "next/link";
import { Bell, Check, Flame, Snowflake } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/sonner";
import { enablePush, notificationPermission, pushSupported } from "@/lib/push-client";
import { cn } from "@/lib/utils";

export interface StreakInfo {
  days: number;
  studiedToday: boolean;
  atRisk: boolean;
  freezes: number;
  longest: number;
  calendar: { day: string; status: "studied" | "frozen" | "none" }[];
  freezeEvery: number;
  maxFreezes: number;
}

export interface ReminderInfo {
  enabled: boolean;
  reachable: boolean;
  pushAvailable: boolean;
}

const WEEKDAY = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function headline(s: StreakInfo): { title: string; sub: string } {
  if (s.days === 0) {
    return { title: "Start a streak today", sub: "Study a little every day — a quiz, the tutor or a battle all count." };
  }
  if (s.studiedToday) {
    return { title: `${s.days}-day streak`, sub: "Done for today. Come back tomorrow to keep it going." };
  }
  return {
    title: `${s.days}-day streak`,
    sub:
      s.freezes > 0
        ? "Study today to keep it going — or a streak freeze will cover today."
        : "Study today or your streak ends at midnight.",
  };
}

/** The streak, front and centre on the student dashboard. */
export function StreakCard({ streak, reminders }: { streak: StreakInfo; reminders: ReminderInfo }) {
  const { title, sub } = headline(streak);
  const [reachable, setReachable] = useState(reminders.reachable);
  const [busy, setBusy] = useState(false);

  const canOneTapPush =
    reminders.pushAvailable && pushSupported() && notificationPermission() !== "denied";

  async function turnOnReminders() {
    setBusy(true);
    try {
      const res = await fetch("/api/students/me/reminders");
      const status = res.ok ? await res.json() : null;
      const key: string | null = status?.push?.vapidPublicKey ?? null;
      if (!key) {
        toast.error("Notifications aren't available yet.");
        return;
      }
      const result = await enablePush(key);
      if (result === "ok") {
        setReachable(true);
        toast.success("Reminders on — we'll nudge you before your streak ends.");
      } else if (result === "denied") {
        toast.error("Notifications are blocked for this site. Allow them in your browser settings.");
      } else {
        toast.error("Couldn't turn on notifications on this device.");
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className={cn("overflow-hidden", streak.atRisk && "border-2 border-orange-400")} data-tour="streak">
      <CardContent className="py-5">
        <div className="flex items-center gap-4">
          <div
            className={cn(
              "flex h-16 w-16 shrink-0 flex-col items-center justify-center rounded-2xl",
              streak.days > 0 ? "bg-orange-100 text-orange-600" : "bg-gray-100 text-gray-400",
            )}
          >
            <Flame className="h-7 w-7" />
            <span className="text-lg font-extrabold leading-none" data-testid="streak-days">
              {streak.days}
            </span>
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-lg font-bold text-text-primary">{title}</p>
            <p className="text-sm text-text-secondary">{sub}</p>
          </div>
          {streak.studiedToday && (
            <span className="hidden shrink-0 items-center gap-1 rounded-full bg-green-100 px-2.5 py-1 text-xs font-semibold text-green-700 sm:inline-flex">
              <Check className="h-3.5 w-3.5" /> Today
            </span>
          )}
        </div>

        {/* Last 7 days */}
        <div className="mt-4 grid grid-cols-7 gap-1.5">
          {streak.calendar.map((d, i) => {
            const isToday = i === streak.calendar.length - 1;
            const weekday = WEEKDAY[new Date(`${d.day}T00:00:00Z`).getUTCDay()];
            return (
              <div key={d.day} className="flex flex-col items-center gap-1">
                <span className={cn("text-[11px]", isToday ? "font-bold text-text-primary" : "text-text-secondary")}>
                  {isToday ? "Today" : weekday}
                </span>
                <span
                  title={d.status === "frozen" ? "Covered by a streak freeze" : d.status === "studied" ? "Studied" : "No study"}
                  className={cn(
                    "flex h-8 w-8 items-center justify-center rounded-full",
                    d.status === "studied" && "bg-orange-500 text-white",
                    d.status === "frozen" && "bg-sky-100 text-sky-600",
                    d.status === "none" && (isToday ? "border-2 border-dashed border-orange-300" : "bg-gray-100"),
                  )}
                >
                  {d.status === "studied" ? (
                    <Flame className="h-4 w-4" />
                  ) : d.status === "frozen" ? (
                    <Snowflake className="h-4 w-4" />
                  ) : null}
                </span>
              </div>
            );
          })}
        </div>

        <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-border pt-3">
          <p className="flex items-center gap-1.5 text-xs text-text-secondary">
            <Snowflake className="h-4 w-4 text-sky-500" />
            <span>
              <span className="font-semibold text-text-primary">
                {streak.freezes} streak freeze{streak.freezes === 1 ? "" : "s"}
              </span>{" "}
              · earn one every {streak.freezeEvery} days in a row (max {streak.maxFreezes}). A freeze saves your streak if you miss a day.
            </span>
          </p>
          {streak.longest > 0 && (
            <p className="text-xs text-text-secondary">Best: {streak.longest} days</p>
          )}
        </div>

        {!reachable && (
          <div className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-lg bg-primary/5 px-3 py-2.5">
            <p className="flex items-center gap-2 text-sm text-text-primary">
              <Bell className="h-4 w-4 text-primary" />
              Get a reminder before your streak ends.
            </p>
            {canOneTapPush ? (
              <Button size="sm" onClick={turnOnReminders} isLoading={busy}>
                Turn on reminders
              </Button>
            ) : (
              <Link href="/student/settings#reminders">
                <Button size="sm" variant="outline">
                  Set up reminders
                </Button>
              </Link>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
