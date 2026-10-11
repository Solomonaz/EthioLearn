"use client";

import Link from "next/link";
import { Lock, Check } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { useEntitlements } from "@/hooks/use-entitlements";
import { PRO_FEATURES } from "@/components/student/pro-promo";

/** What each gated page offers, so the lock screen sells it rather than just refusing. */
const FEATURE_PITCH: Record<string, string> = {
  "AI Tutor": "Ask any question from your lessons and get a clear, step-by-step explanation — like a private tutor on your phone.",
  "Battle Mode": "Challenge friends to a live quiz on the same questions at the same time, and see who knows the textbook best.",
  Graphing: "Type an equation and see its graph instantly — zoom, compare functions and understand them visually.",
  "3D Geometry": "Build and rotate 3D shapes to see faces, edges and volumes for yourself.",
  Leaderboard: "See how you rank against other students and track your climb.",
};

/**
 * Shown when a student's plan doesn't include a feature: what the feature does,
 * everything Pro includes, and the way to the plans page.
 */
export function UpgradeNotice({
  feature,
  planName,
  description,
}: {
  feature: string;
  planName?: string | null;
  description?: string;
}) {
  const ent = useEntitlements();
  const trialEnded = !!ent.trialEndsAt && !ent.trialActive;
  const pitch = description ?? FEATURE_PITCH[feature];

  return (
    <div className="mx-auto flex min-h-[50vh] max-w-lg items-center p-4">
      <Card className="w-full">
        <CardContent className="flex flex-col items-center gap-3 py-10 text-center">
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-primary/10">
            <Lock className="h-6 w-6 text-primary" />
          </div>
          <h2 className="text-lg font-semibold text-text-primary">{feature} is a Pro feature</h2>
          {pitch && <p className="text-sm text-text-secondary">{pitch}</p>}
          <p className="text-xs text-text-muted">
            {trialEnded
              ? "Your free trial has ended."
              : `${planName ? `Your current plan (${planName})` : "Your current plan"} doesn’t include it.`}
          </p>

          <div className="mt-2 w-full rounded-lg bg-background p-4 text-left">
            <p className="text-sm font-semibold text-text-primary">Pro includes</p>
            <ul className="mt-2 space-y-1.5">
              {PRO_FEATURES.map((f) => (
                <li key={f.key} className="flex items-start gap-2 text-sm text-text-secondary">
                  <Check className="mt-0.5 h-4 w-4 shrink-0 text-success" />
                  <span>
                    <span className="font-medium text-text-primary">{f.title}</span> — {f.desc}
                  </span>
                </li>
              ))}
            </ul>
          </div>

          <Link
            href="/student/billing"
            className="mt-1 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-white hover:bg-primary-dark"
          >
            View plans
          </Link>
        </CardContent>
      </Card>
    </div>
  );
}
