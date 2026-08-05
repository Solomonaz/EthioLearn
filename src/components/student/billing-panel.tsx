"use client";

import { useCallback, useEffect, useState } from "react";
import { CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { Badge } from "@/components/ui/badge";
import { toast } from "@/components/ui/sonner";
import {
  formatMoney,
  billingIntervalLabel,
  type BillingInterval,
} from "@/lib/pricing";

interface Plan {
  id: string;
  name: string;
  description: string | null;
  price: number | null;
  currency: string;
  billingInterval: BillingInterval;
  trialDays: number;
  features: string[];
}
interface Subscription {
  id: string;
  status: string;
  startDate: string;
  endDate: string | null;
  cancelAtPeriodEnd: boolean;
  amount: number | null;
  currency: string;
  plan: Plan;
}

const STATUS_VARIANT: Record<string, "success" | "warning" | "error" | "default" | "info"> = {
  ACTIVE: "success",
  TRIAL: "info",
  PAST_DUE: "warning",
  CANCELED: "default",
  EXPIRED: "default",
};

/**
 * Self-service billing for INDEPENDENT students (no school). Renders nothing
 * for school-managed students — the API reports eligible:false for them.
 */
export function StudentBillingPanel() {
  const [eligible, setEligible] = useState(false);
  const [loading, setLoading] = useState(true);
  const [plans, setPlans] = useState<Plan[]>([]);
  const [current, setCurrent] = useState<Subscription | null>(null);
  const [defaultPlanId, setDefaultPlanId] = useState<string | null>(null);
  const [busyPlanId, setBusyPlanId] = useState<string | null>(null);
  const [canceling, setCanceling] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/student/subscription");
      const data = res.ok ? await res.json() : { eligible: false };
      setEligible(!!data.eligible);
      setPlans(data.plans ?? []);
      setCurrent(data.subscription ?? null);
      setDefaultPlanId(data.defaultPlanId ?? null);
    } catch {
      setEligible(false);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function choosePlan(planId: string) {
    setBusyPlanId(planId);
    try {
      const res = await fetch("/api/student/subscription", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ planId }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error ?? "Failed to update plan");
      }
      toast.success("Your plan has been updated.");
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setBusyPlanId(null);
    }
  }

  async function cancelPlan() {
    if (!window.confirm("Cancel your plan? You'll keep access until the end of your paid period.")) return;
    setCanceling(true);
    try {
      const res = await fetch("/api/student/subscription", { method: "DELETE" });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error ?? "Failed to cancel");
      }
      const data = await res.json().catch(() => ({}));
      if (data.cancelAtPeriodEnd && data.endsAt) {
        toast.success(`Canceled. You keep access until ${new Date(data.endsAt).toLocaleDateString()}.`);
      } else {
        toast.success("Plan canceled.");
      }
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setCanceling(false);
    }
  }

  // Show a spinner while loading; hidden entirely for school-managed students
  // (the billing page renders its own school message in that case).
  if (loading) {
    return (
      <div className="flex justify-center py-16">
        <Spinner size="lg" className="text-primary" />
      </div>
    );
  }
  if (!eligible) return null;

  // A live paid subscription, if any. Otherwise the student is on the default
  // (Free) plan — every logged-in student is on Free until they upgrade.
  const liveCurrent =
    current && ["ACTIVE", "TRIAL", "PAST_DUE"].includes(current.status) ? current : null;
  const onPaidPlan = !!liveCurrent && liveCurrent.plan.id !== defaultPlanId;
  const currentPlanId = liveCurrent ? liveCurrent.plan.id : defaultPlanId;
  const defaultPlan = plans.find((p) => p.id === defaultPlanId) ?? null;
  // The plan to render as "current": the live one, or the Free default.
  const currentPlan = liveCurrent?.plan ?? defaultPlan;

  return (
    <div className="space-y-6">
      {/* Current-plan summary banner */}
      {onPaidPlan && liveCurrent ? (
        <div
          className={
            "rounded-xl border p-4 " +
            (liveCurrent.cancelAtPeriodEnd ? "border-warning/40 bg-warning/5" : "border-border bg-background/60")
          }
        >
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <CheckCircle2 className="h-4 w-4 text-success" />
              <span className="text-sm text-text-secondary">Current plan:</span>
              <span className="font-semibold text-text-primary">{liveCurrent.plan.name}</span>
              <Badge variant={liveCurrent.cancelAtPeriodEnd ? "warning" : STATUS_VARIANT[liveCurrent.status] ?? "default"}>
                {liveCurrent.cancelAtPeriodEnd ? "Canceling" : liveCurrent.status}
              </Badge>
            </div>
            <span className="text-sm text-text-secondary">
              {formatMoney(liveCurrent.amount, liveCurrent.currency)}
              {billingIntervalLabel(liveCurrent.plan.billingInterval)}
              {" · Started "}
              {new Date(liveCurrent.startDate).toLocaleDateString()}
            </span>
          </div>
          {liveCurrent.cancelAtPeriodEnd && liveCurrent.endDate && (
            <p className="mt-2 text-sm text-warning">
              Your plan is canceled but stays active until{" "}
              <strong>{new Date(liveCurrent.endDate).toLocaleDateString()}</strong> — you keep full
              access until then, and it won’t renew.
            </p>
          )}
        </div>
      ) : currentPlan ? (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-border bg-background/60 p-4">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="h-4 w-4 text-success" />
            <span className="text-sm text-text-secondary">Current plan:</span>
            <span className="font-semibold text-text-primary">{currentPlan.name}</span>
            <Badge variant="success">Active</Badge>
          </div>
          <span className="text-sm text-text-secondary">Upgrade anytime to unlock more.</span>
        </div>
      ) : null}

      {/* Available plans — prominent cards */}
      {plans.length === 0 ? (
        <p className="text-sm text-text-secondary">No plans are available right now.</p>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          {plans.map((p) => {
            const isCurrent = p.id === currentPlanId;
            return (
              <div
                key={p.id}
                className={
                  "flex flex-col rounded-2xl border p-6 shadow-sm transition-shadow hover:shadow-md " +
                  (isCurrent ? "border-primary ring-1 ring-primary/30 bg-primary/5" : "border-border")
                }
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-lg font-semibold text-text-primary">{p.name}</span>
                  {isCurrent && <Badge variant="success">Current</Badge>}
                </div>
                <div className="mt-2 flex items-baseline gap-1">
                  <span className="text-3xl font-extrabold text-text-primary">
                    {formatMoney(p.price, p.currency)}
                  </span>
                  <span className="text-sm text-text-secondary">
                    {billingIntervalLabel(p.billingInterval)}
                  </span>
                </div>
                {p.trialDays > 0 && (
                  <p className="mt-1 text-xs font-medium text-success">{p.trialDays}-day free trial</p>
                )}
                {p.description && (
                  <p className="mt-2 text-sm text-text-secondary">{p.description}</p>
                )}
                {p.features.length > 0 && (
                  <ul className="mt-4 space-y-2">
                    {p.features.map((f, i) => (
                      <li key={i} className="flex items-start gap-2 text-sm text-text-primary">
                        <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                        {f}
                      </li>
                    ))}
                  </ul>
                )}
                <div className="mt-auto pt-6">
                  <Button
                    variant={isCurrent ? "outline" : "primary"}
                    className="w-full"
                    disabled={isCurrent}
                    isLoading={busyPlanId === p.id}
                    onClick={() => choosePlan(p.id)}
                  >
                    {isCurrent ? "Current plan" : onPaidPlan ? "Switch to this plan" : "Choose plan"}
                  </Button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Cancel at period end, or resume a pending cancellation. */}
      {onPaidPlan && liveCurrent && (
        <div>
          {liveCurrent.cancelAtPeriodEnd ? (
            <Button
              variant="outline"
              onClick={() => choosePlan(liveCurrent.plan.id)}
              isLoading={busyPlanId === liveCurrent.plan.id}
            >
              Resume subscription
            </Button>
          ) : (
            <Button variant="ghost" onClick={cancelPlan} isLoading={canceling} className="text-error hover:bg-red-50">
              Cancel subscription
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
