"use client";

import { useCallback, useEffect, useState } from "react";
import { CreditCard, CheckCircle2 } from "lucide-react";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
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
    if (!window.confirm("Cancel your current plan?")) return;
    setCanceling(true);
    try {
      const res = await fetch("/api/student/subscription", { method: "DELETE" });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error ?? "Failed to cancel");
      }
      toast.success("Plan canceled.");
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setCanceling(false);
    }
  }

  // Hidden entirely while loading eligibility, and for school-managed students.
  if (loading) return null;
  if (!eligible) return null;

  const currentPlanId = current && ["ACTIVE", "TRIAL", "PAST_DUE"].includes(current.status)
    ? current.plan.id
    : null;

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-2">
          <CreditCard className="h-5 w-5 text-primary" />
          <h2 className="text-lg font-semibold text-text-primary">Your Plan</h2>
        </div>
        <p className="text-xs text-text-secondary">
          Choose the plan that works for you.
        </p>
      </CardHeader>
      <CardContent className="space-y-5">
        {/* Current subscription */}
        {current && currentPlanId ? (
          <div className="rounded-lg border border-border bg-background/60 p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <CheckCircle2 className="h-4 w-4 text-success" />
                <span className="font-medium text-text-primary">{current.plan.name}</span>
                <Badge variant={STATUS_VARIANT[current.status] ?? "default"}>
                  {current.status}
                </Badge>
              </div>
              <span className="text-lg font-semibold text-text-primary">
                {formatMoney(current.amount, current.currency)}
                <span className="text-xs font-normal text-text-secondary">
                  {billingIntervalLabel(current.plan.billingInterval)}
                </span>
              </span>
            </div>
            <div className="mt-2 text-xs text-text-secondary">
              Started {new Date(current.startDate).toLocaleDateString()}
              {current.endDate && current.status === "TRIAL" && (
                <> · Trial ends {new Date(current.endDate).toLocaleDateString()}</>
              )}
            </div>
            <div className="mt-3">
              <Button size="sm" variant="outline" onClick={cancelPlan} isLoading={canceling}>
                Cancel plan
              </Button>
            </div>
          </div>
        ) : (
          <p className="text-sm text-text-secondary">You’re not on a paid plan yet.</p>
        )}

        {/* Available plans */}
        {plans.length === 0 ? (
          <p className="text-sm text-text-secondary">No plans are available right now.</p>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2">
            {plans.map((p) => {
              const isCurrent = p.id === currentPlanId;
              return (
                <div
                  key={p.id}
                  className={
                    "flex flex-col rounded-lg border p-4 " +
                    (isCurrent ? "border-primary bg-primary/5" : "border-border")
                  }
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-semibold text-text-primary">{p.name}</span>
                    {isCurrent && <Badge variant="success">Current</Badge>}
                  </div>
                  <div className="mt-1 text-xl font-bold text-text-primary">
                    {formatMoney(p.price, p.currency)}
                    <span className="text-xs font-normal text-text-secondary">
                      {billingIntervalLabel(p.billingInterval)}
                    </span>
                  </div>
                  {p.trialDays > 0 && (
                    <p className="mt-0.5 text-xs text-success">{p.trialDays}-day free trial</p>
                  )}
                  {p.description && (
                    <p className="mt-1 text-sm text-text-secondary">{p.description}</p>
                  )}
                  {p.features.length > 0 && (
                    <ul className="mt-2 space-y-1">
                      {p.features.map((f, i) => (
                        <li key={i} className="flex items-start gap-1.5 text-sm text-text-secondary">
                          <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-success" />
                          {f}
                        </li>
                      ))}
                    </ul>
                  )}
                  <div className="mt-3 pt-1">
                    <Button
                      size="sm"
                      variant={isCurrent ? "outline" : "primary"}
                      className="w-full"
                      disabled={isCurrent}
                      isLoading={busyPlanId === p.id}
                      onClick={() => choosePlan(p.id)}
                    >
                      {isCurrent ? "Current plan" : current ? "Switch to this plan" : "Choose plan"}
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
