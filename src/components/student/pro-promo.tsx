"use client";

import Link from "next/link";
import { Lock, MessageSquare, Swords, LineChart, Trophy, Sparkles, Clock } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import type { EntitlementsInfo } from "@/hooks/use-entitlements";

/**
 * Paid ("Pro") features, shown to free students instead of hidden so they know
 * what upgrading unlocks. One list drives the sidebar locks, the dashboard card
 * and the upgrade screen.
 */
export const PRO_FEATURES = [
  {
    key: "aiTutor",
    navKeys: ["aiTutor"],
    title: "AI Tutor",
    desc: "Ask anything and get a clear, step-by-step answer.",
    icon: MessageSquare,
    href: "/student/tutor",
  },
  {
    key: "battle",
    navKeys: ["battle"],
    title: "Battle Quiz",
    desc: "Compete live with friends on questions from your textbook.",
    icon: Swords,
    href: "/student/battle",
  },
  {
    key: "mathTools",
    navKeys: ["grapher", "geometry"],
    title: "Grapher & 3D Geometry",
    desc: "Draw graphs and explore 3D shapes to understand maths visually.",
    icon: LineChart,
    href: "/student/grapher",
  },
  {
    key: "leaderboard",
    navKeys: ["leaderboard"],
    title: "Leaderboard",
    desc: "See how you rank against other students.",
    icon: Trophy,
    href: "/student/leaderboard",
  },
] as const;

export type ProFeatureKey = (typeof PRO_FEATURES)[number]["key"];

const BILLING_HREF = "/student/billing";
const DAY_MS = 24 * 60 * 60 * 1000;
/** How long after a trial ends the "trial ended" prompt keeps showing. */
const TRIAL_ENDED_PROMPT_DAYS = 14;

/**
 * Pro features this student could buy but doesn't have. Empty for school
 * students, staff, while loading, when pricing is off, and for features that
 * are switched off platform-wide (nobody can buy those, so don't advertise them).
 */
export function lockedProFeatures(ent: EntitlementsInfo): Set<ProFeatureKey> {
  const locked = new Set<ProFeatureKey>();
  if (ent.loading || !ent.isIndependent || !ent.pricingEnabled) return locked;
  if (ent.aiFeatures.aiTutor && !ent.ai) locked.add("aiTutor");
  if (!ent.multiplayer) locked.add("battle");
  if (!ent.mathTools) locked.add("mathTools");
  if (!ent.leaderboard) locked.add("leaderboard");
  return locked;
}

/** Sidebar nav keys (e.g. "grapher") whose feature is locked for this student. */
export function lockedNavKeys(ent: EntitlementsInfo): Set<string> {
  const locked = lockedProFeatures(ent);
  const keys = new Set<string>();
  for (const f of PRO_FEATURES) {
    if (locked.has(f.key)) f.navKeys.forEach((k) => keys.add(k));
  }
  return keys;
}

function trialDaysLeft(endsAt: string): number {
  return Math.max(1, Math.ceil((new Date(endsAt).getTime() - Date.now()) / DAY_MS));
}

/** True for a trial that ended within the last couple of weeks. */
function trialRecentlyEnded(ent: EntitlementsInfo): boolean {
  if (!ent.trialEndsAt || ent.trialActive) return false;
  const since = Date.now() - new Date(ent.trialEndsAt).getTime();
  return since >= 0 && since < TRIAL_ENDED_PROMPT_DAYS * DAY_MS;
}

/** The small yellow "Pro" tag next to a locked feature. */
export function ProBadge() {
  return (
    <span className="ml-auto inline-flex items-center gap-1 rounded-full bg-secondary/30 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-warning">
      <Lock className="h-3 w-3" />
      Pro
    </span>
  );
}

/**
 * "Free trial: N days left" while the sign-up trial runs, and "your trial has
 * ended" for a short while after (only if it actually took something away).
 */
export function TrialBanner({ ent }: { ent: EntitlementsInfo }) {
  if (ent.loading || !ent.isIndependent || !ent.pricingEnabled || !ent.trialEndsAt) return null;

  if (ent.trialActive) {
    const days = trialDaysLeft(ent.trialEndsAt);
    return (
      <Card className="border-secondary/60 bg-secondary/15">
        <CardContent className="flex flex-wrap items-center gap-3 py-4">
          <Clock className="h-5 w-5 shrink-0 text-secondary-dark" />
          <p className="min-w-0 flex-1 text-sm text-text-primary">
            <span className="font-semibold">
              Free trial: {days} {days === 1 ? "day" : "days"} left.
            </span>{" "}
            You have every Pro feature — AI Tutor, Battle Quiz, Grapher & 3D Geometry and the Leaderboard.
          </p>
          <Link href={BILLING_HREF} className="text-sm font-semibold text-primary hover:underline">
            See plans
          </Link>
        </CardContent>
      </Card>
    );
  }

  if (trialRecentlyEnded(ent) && lockedProFeatures(ent).size > 0) {
    return (
      <Card className="border-secondary/60 bg-secondary/15">
        <CardContent className="flex flex-wrap items-center gap-3 py-4">
          <Sparkles className="h-5 w-5 shrink-0 text-secondary-dark" />
          <p className="min-w-0 flex-1 text-sm text-text-primary">
            <span className="font-semibold">Your free trial has ended.</span> Upgrade to keep using the
            AI Tutor, Battle Quiz and the other Pro features.
          </p>
          <Link
            href={BILLING_HREF}
            className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-white hover:bg-primary-dark"
          >
            Upgrade
          </Link>
        </CardContent>
      </Card>
    );
  }

  return null;
}

/** Dashboard card listing the Pro features a free student doesn't have yet. */
export function ProFeaturesCard({ ent }: { ent: EntitlementsInfo }) {
  const locked = lockedProFeatures(ent);
  if (locked.size === 0) return null;
  const features = PRO_FEATURES.filter((f) => locked.has(f.key));

  return (
    <Card>
      <CardContent className="py-5">
        <div className="flex items-center gap-2">
          <Sparkles className="h-5 w-5 text-secondary-dark" />
          <h2 className="font-semibold text-text-primary">Unlock more with Pro</h2>
        </div>
        <div className="mt-3 grid gap-2 sm:grid-cols-2">
          {features.map((f) => (
            <Link
              key={f.key}
              href={f.href}
              className="flex items-start gap-3 rounded-lg border border-border p-3 transition-colors hover:bg-border/40"
            >
              <f.icon className="mt-0.5 h-5 w-5 shrink-0 text-primary" />
              <div className="min-w-0">
                <p className="flex items-center gap-2 text-sm font-medium text-text-primary">
                  {f.title}
                  <Lock className="h-3.5 w-3.5 text-text-muted" />
                </p>
                <p className="text-xs text-text-secondary">{f.desc}</p>
              </div>
            </Link>
          ))}
        </div>
        <Link
          href={BILLING_HREF}
          className="mt-4 inline-flex rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-white hover:bg-primary-dark"
        >
          View plans
        </Link>
      </CardContent>
    </Card>
  );
}
