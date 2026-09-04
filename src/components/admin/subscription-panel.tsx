"use client";

import { useCallback, useEffect, useState } from "react";
import { CreditCard, CheckCircle2 } from "lucide-react";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { Badge } from "@/components/ui/badge";
import { toast } from "@/components/ui/sonner";
import {
  computePlanPrice,
  formatMoney,
  billingIntervalLabel,
  type BillingInterval,
  type PricingModel,
} from "@/lib/pricing";

interface Tier {
  minStudents: number;
  maxStudents: number | null;
  price: number;
}
interface Plan {
  id: string;
  name: string;
  description: string | null;
  pricingModel: PricingModel;
  price: number | null;
  currency: string;
  billingInterval: BillingInterval;
  tiers: Tier[];
}
interface Subscription {
  id: string;
  status: string;
  startDate: string;
  endDate: string | null;
  billingInterval: BillingInterval | null;
  amount: number | null;
  currency: string;
  studentCountSnapshot: number | null;
  notes: string | null;
  plan: Plan;
}

const STATUS_VARIANT: Record<string, "success" | "warning" | "error" | "default" | "info"> = {
  ACTIVE: "success",
  TRIAL: "info",
  PAST_DUE: "warning",
  CANCELED: "default",
  EXPIRED: "default",
};

const selectClass =
  "w-full rounded-lg border border-border bg-surface px-3 py-2.5 text-text-primary outline-none transition-colors focus:border-primary focus:ring-1 focus:ring-primary disabled:cursor-not-allowed disabled:opacity-50";

function planPriceSummary(p: Plan): string {
  const interval = billingIntervalLabel(p.billingInterval);
  if (p.pricingModel === "PER_STUDENT") return `${formatMoney(p.price, p.currency)} per student${interval}`;
  if (p.pricingModel === "TIERED") return `Tiered by student count${interval}`;
  return `${formatMoney(p.price, p.currency)}${interval}`;
}

export function SubscriptionPanel({
  audience,
  targetId,
  readOnly = false,
}: {
  audience: "SCHOOL" | "STUDENT";
  targetId: string;
  readOnly?: boolean;
}) {
  const [plans, setPlans] = useState<Plan[]>([]);
  const [current, setCurrent] = useState<Subscription | null>(null);
  const [studentCount, setStudentCount] = useState<number>(0);
  const [loading, setLoading] = useState(true);

  const [selectedPlanId, setSelectedPlanId] = useState("");
  const [status, setStatus] = useState("ACTIVE");
  const [notes, setNotes] = useState("");
  const [assigning, setAssigning] = useState(false);
  const [updating, setUpdating] = useState(false);

  const targetParam = audience === "SCHOOL" ? `schoolId=${targetId}` : `studentId=${targetId}`;

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [plansRes, subRes] = await Promise.all([
        fetch(`/api/admin/pricing/plans?audience=${audience}&active=1`),
        fetch(`/api/admin/pricing/subscriptions?${targetParam}`),
      ]);
      const plansData = plansRes.ok ? await plansRes.json() : { plans: [] };
      const subData = subRes.ok ? await subRes.json() : { subscription: null };
      setPlans(plansData.plans ?? []);
      setCurrent(subData.subscription ?? null);
      setStudentCount(subData.studentCount ?? 0);
    } catch {
      toast.error("Failed to load subscription info.");
    } finally {
      setLoading(false);
    }
  }, [audience, targetParam]);

  useEffect(() => {
    load();
  }, [load]);

  const selectedPlan = plans.find((p) => p.id === selectedPlanId) ?? null;
  const preview = selectedPlan
    ? computePlanPrice(
        { pricingModel: selectedPlan.pricingModel, price: selectedPlan.price, tiers: selectedPlan.tiers },
        studentCount
      )
    : null;

  async function handleAssign() {
    if (!selectedPlanId) {
      toast.error("Select a plan first.");
      return;
    }
    setAssigning(true);
    try {
      const res = await fetch("/api/admin/pricing/subscriptions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          planId: selectedPlanId,
          ...(audience === "SCHOOL" ? { schoolId: targetId } : { studentId: targetId }),
          status,
          notes: notes.trim() || undefined,
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error ?? "Failed to assign plan");
      }
      toast.success("Plan assigned.");
      setSelectedPlanId("");
      setNotes("");
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setAssigning(false);
    }
  }

  async function handleCancel() {
    if (!current) return;
    if (!window.confirm("Cancel this subscription?")) return;
    setUpdating(true);
    try {
      const res = await fetch(`/api/admin/pricing/subscriptions/${current.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "CANCELED", endDate: new Date().toISOString() }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error ?? "Failed to cancel");
      }
      toast.success("Subscription canceled.");
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setUpdating(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-2">
          <CreditCard className="h-5 w-5 text-primary" />
          <h2 className="font-semibold text-text-primary">
            {audience === "SCHOOL" ? "School Subscription" : "Student Subscription"}
          </h2>
        </div>
      </CardHeader>
      <CardContent className="space-y-5">
        {loading ? (
          <div className="flex items-center justify-center py-6">
            <Spinner size="md" className="text-primary" />
          </div>
        ) : (
          <>
            {/* Current subscription */}
            {current ? (
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
                      {billingIntervalLabel(current.billingInterval ?? current.plan.billingInterval)}
                    </span>
                  </span>
                </div>
                <div className="mt-2 grid gap-1 text-xs text-text-secondary sm:grid-cols-2">
                  <span>Started {new Date(current.startDate).toLocaleDateString()}</span>
                  {current.endDate && <span>Ends {new Date(current.endDate).toLocaleDateString()}</span>}
                  {current.studentCountSnapshot !== null && (
                    <span>Priced for {current.studentCountSnapshot} students</span>
                  )}
                </div>
                {current.notes && <p className="mt-2 text-xs text-text-muted">{current.notes}</p>}
                {!readOnly && current.status !== "CANCELED" && current.status !== "EXPIRED" && (
                  <div className="mt-3">
                    <Button size="sm" variant="outline" onClick={handleCancel} isLoading={updating}>
                      Cancel subscription
                    </Button>
                  </div>
                )}
              </div>
            ) : (
              <p className="text-sm text-text-secondary">No active subscription.</p>
            )}

            {/* Available plans catalogue (read-only view, e.g. school admins) */}
            {readOnly && (
              <div className="space-y-3 border-t border-border pt-4">
                <p className="text-xs font-semibold uppercase text-text-muted">Available plans</p>
                {plans.length === 0 ? (
                  <p className="text-sm text-text-secondary">No plans available.</p>
                ) : (
                  <div className="grid gap-3 sm:grid-cols-2">
                    {plans.map((p) => {
                      const isCurrent = current?.plan?.id === p.id;
                      return (
                        <div
                          key={p.id}
                          className={
                            "rounded-lg border p-3 " +
                            (isCurrent ? "border-primary bg-primary/5" : "border-border")
                          }
                        >
                          <div className="flex items-center justify-between gap-2">
                            <span className="font-medium text-text-primary">{p.name}</span>
                            {isCurrent && <Badge variant="success">Current</Badge>}
                          </div>
                          <p className="mt-1 text-sm text-text-primary">{planPriceSummary(p)}</p>
                          {p.pricingModel === "TIERED" && p.tiers.length > 0 && (
                            <div className="mt-1.5 flex flex-wrap gap-1.5">
                              {p.tiers.map((t, i) => (
                                <span
                                  key={i}
                                  className="rounded-md bg-border/40 px-2 py-0.5 text-xs text-text-secondary"
                                >
                                  {t.minStudents}
                                  {t.maxStudents === null ? "+" : `–${t.maxStudents}`}:{" "}
                                  {formatMoney(t.price, p.currency)}
                                </span>
                              ))}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            )}

            {/* Assign / change plan (super-admin only) */}
            {!readOnly && (
              <div className="space-y-3 border-t border-border pt-4">
                <p className="text-xs font-semibold uppercase text-text-muted">
                  {current ? "Change plan" : "Assign a plan"}
                </p>

                {audience === "SCHOOL" && (
                  <p className="text-xs text-text-secondary">
                    This school currently has <strong>{studentCount}</strong> student
                    {studentCount === 1 ? "" : "s"} — school plans are priced on this count.
                  </p>
                )}

                {plans.length === 0 ? (
                  <p className="text-sm text-text-secondary">
                    No active {audience === "SCHOOL" ? "school" : "student"} plans exist yet. Create one on the
                    Pricing page first.
                  </p>
                ) : (
                  <>
                    <select
                      className={selectClass}
                      value={selectedPlanId}
                      onChange={(e) => setSelectedPlanId(e.target.value)}
                      disabled={assigning}
                    >
                      <option value="">Select a plan…</option>
                      {plans.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name}
                        </option>
                      ))}
                    </select>

                    {selectedPlan && (
                      <div className="rounded-lg bg-primary/5 px-3 py-2 text-sm">
                        <span className="text-text-secondary">Price for this {audience === "SCHOOL" ? "school" : "student"}: </span>
                        <span className="font-semibold text-text-primary">
                          {preview && preview.amount !== null
                            ? `${formatMoney(preview.amount, selectedPlan.currency)}${billingIntervalLabel(selectedPlan.billingInterval)}`
                            : preview?.note ?? "—"}
                        </span>
                      </div>
                    )}

                    <div className="grid gap-3 sm:grid-cols-2">
                      <div className="space-y-1.5">
                        <label className="text-xs font-semibold uppercase text-text-muted">Status</label>
                        <select
                          className={selectClass}
                          value={status}
                          onChange={(e) => setStatus(e.target.value)}
                          disabled={assigning}
                        >
                          <option value="ACTIVE">Active</option>
                          <option value="TRIAL">Trial</option>
                          <option value="PAST_DUE">Past due</option>
                        </select>
                      </div>
                      <div className="space-y-1.5">
                        <label className="text-xs font-semibold uppercase text-text-muted">Notes (optional)</label>
                        <Input value={notes} onChange={(e) => setNotes(e.target.value)} disabled={assigning} placeholder="e.g. Paid via bank transfer" />
                      </div>
                    </div>

                    <Button onClick={handleAssign} isLoading={assigning} disabled={!selectedPlanId}>
                      {current ? "Replace current plan" : "Assign plan"}
                    </Button>
                  </>
                )}
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
