"use client";

import { useCallback, useEffect, useState } from "react";
import { CheckCircle2, Crown, Gift, ShieldCheck, RefreshCw, Lock, Headphones, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { Badge } from "@/components/ui/badge";
import { toast } from "@/components/ui/sonner";
import { PaymentModal } from "@/components/student/payment-modal";
import {
  formatMoney,
  billingIntervalLabel,
  studentIntervalPrice,
  STUDENT_BILLING_INTERVALS,
  type BillingInterval,
  type StudentBillingInterval,
} from "@/lib/pricing";

interface PendingPayment {
  id: string;
  amount: number;
  currency: string;
  billingInterval: BillingInterval;
  plan: { name: string };
}

interface Plan {
  id: string;
  name: string;
  description: string | null;
  price: number | null;
  currency: string;
  billingInterval: BillingInterval;
  trialDays: number;
  features: string[];
  quarterlyDiscountPct: number;
  yearlyDiscountPct: number;
  allowAi: boolean;
  allowMultiplayer: boolean;
  allowRewards: boolean;
  allowLeaderboard: boolean;
  allowMathTools: boolean;
  allowGames?: boolean;
}

/**
 * The feature bullets to show on a plan card. Admin-entered `features` win;
 * otherwise we derive a list from what the plan unlocks, so a plan with no
 * hand-written features (e.g. Premium Student) still shows what it includes.
 */
function planFeatures(p: Plan, elementary: boolean): string[] {
  if (p.features && p.features.length > 0) return p.features;
  // A grades 1-8 student only has the play area, so list what it unlocks.
  if (elementary) {
    const f: string[] = ["Find the Color & Number Memory"];
    if (p.allowGames !== false) f.push("Every learning game: Tug of War, Find the Pair, Routing Robot");
    if (p.allowGames !== false && p.allowAi) f.push("AI-made questions for your games");
    return f;
  }
  const f: string[] = ["Solo quizzes, daily challenges & solo games", "Progress tracking"];
  if (p.allowAi) f.push("AI Tutor & AI-generated quizzes");
  if (p.allowMathTools) f.push("Graphing calculator & 3D geometry lab");
  if (p.allowMultiplayer) f.push("Battle mode (multiplayer)");
  if (p.allowRewards) f.push("Rewards & redemption");
  if (p.allowLeaderboard) f.push("Leaderboard & rankings");
  return f;
}
interface Subscription {
  id: string;
  status: string;
  startDate: string;
  endDate: string | null;
  cancelAtPeriodEnd: boolean;
  billingInterval: BillingInterval;
  amount: number | null;
  currency: string;
  plan: Plan;
}

// The billing cycles offered to students, with labels for the toggle.
const CYCLES: { value: StudentBillingInterval; label: string }[] = [
  { value: "MONTHLY", label: "Monthly" },
  { value: "QUARTERLY", label: "3 months" },
  { value: "YEARLY", label: "Yearly" },
];

/**
 * Self-service billing for INDEPENDENT students (no school). Renders nothing
 * for school-managed students — the API reports eligible:false for them.
 */
export function StudentBillingPanel({ elementary = false }: { elementary?: boolean } = {}) {
  const [eligible, setEligible] = useState(false);
  const [loading, setLoading] = useState(true);
  const [plans, setPlans] = useState<Plan[]>([]);
  const [current, setCurrent] = useState<Subscription | null>(null);
  const [defaultPlanId, setDefaultPlanId] = useState<string | null>(null);
  const [busyPlanId, setBusyPlanId] = useState<string | null>(null);
  // The billing cycle the student is currently viewing / would subscribe on.
  const [selectedCycle, setSelectedCycle] = useState<StudentBillingInterval>("MONTHLY");
  // A payment awaiting admin review (locks the cards until it's resolved).
  const [pendingPayment, setPendingPayment] = useState<PendingPayment | null>(null);
  // The plan a student is paying for right now (opens the payment modal).
  const [payFor, setPayFor] = useState<{ plan: Plan; interval: StudentBillingInterval; amount: number } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [subRes, payRes] = await Promise.all([
        fetch("/api/student/subscription"),
        fetch("/api/student/payments"),
      ]);
      const data = subRes.ok ? await subRes.json() : { eligible: false };
      setEligible(!!data.eligible);
      setPlans(data.plans ?? []);
      setCurrent(data.subscription ?? null);
      setDefaultPlanId(data.defaultPlanId ?? null);
      // If the student is on a live PAID plan, the cycle is locked to it — show it.
      const sub = data.subscription;
      if (sub && (sub.amount ?? 0) > 0 && STUDENT_BILLING_INTERVALS.includes(sub.billingInterval)) {
        setSelectedCycle(sub.billingInterval);
      }
      const payData = payRes.ok ? await payRes.json() : null;
      setPendingPayment(payData?.pending ?? null);
      if (payData?.pending && STUDENT_BILLING_INTERVALS.includes(payData.pending.billingInterval)) {
        setSelectedCycle(payData.pending.billingInterval);
      }
    } catch {
      setEligible(false);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function choosePlan(planId: string, cycle: StudentBillingInterval = selectedCycle) {
    setBusyPlanId(planId);
    try {
      const res = await fetch("/api/student/subscription", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ planId, billingInterval: cycle }),
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

  // Display order: the Free/default plan first, then the rest cheapest → dearest.
  const sortedPlans = [...plans].sort((a, b) => {
    if (a.id === defaultPlanId) return -1;
    if (b.id === defaultPlanId) return 1;
    return (a.price ?? 0) - (b.price ?? 0);
  });

  const hasPaidPlan = plans.some((p) => (p.price ?? 0) > 0);
  const gridCols = sortedPlans.length >= 3 ? "lg:grid-cols-3" : "md:grid-cols-2";
  // "Locked" = the student is on a live PAID plan (committed for its term), OR a
  // payment is awaiting review. Either way the plan cards can't be actioned.
  const onPaidTerm = onPaidPlan && !!liveCurrent;
  const locked = onPaidTerm || !!pendingPayment;
  const termEnds = liveCurrent?.endDate ? new Date(liveCurrent.endDate).toLocaleDateString() : null;

  // Choosing a plan: Free activates instantly; a paid plan opens the payment modal.
  function selectPlan(p: Plan, priced: { total: number }, cycle: StudentBillingInterval) {
    if (priced.total <= 0) {
      choosePlan(p.id, cycle);
    } else {
      setPayFor({ plan: p, interval: cycle, amount: priced.total });
    }
  }

  return (
    <div className="space-y-6">
      {/* Current-plan summary banner */}
      {currentPlan && (
        <div
          className={
            "rounded-2xl border p-4 sm:px-5 " +
            (liveCurrent?.cancelAtPeriodEnd ? "border-warning/40 bg-warning/5" : "border-border bg-surface")
          }
        >
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2.5">
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-success/10">
                <CheckCircle2 className="h-5 w-5 text-success" />
              </span>
              <span className="text-sm text-text-secondary">Current plan:</span>
              <span className="font-semibold text-text-primary">{currentPlan.name}</span>
              <Badge variant={liveCurrent?.cancelAtPeriodEnd ? "warning" : "success"}>
                {liveCurrent?.cancelAtPeriodEnd ? "Canceling" : liveCurrent ? liveCurrent.status : "Active"}
              </Badge>
            </div>
            <span className="text-sm text-text-secondary">
              {liveCurrent ? (
                <>
                  {formatMoney(liveCurrent.amount, liveCurrent.currency)}
                  {billingIntervalLabel(liveCurrent.billingInterval)}
                  {termEnds ? ` · Active until ${termEnds}` : ` · Started ${new Date(liveCurrent.startDate).toLocaleDateString()}`}
                </>
              ) : (
                "Upgrade anytime to unlock more."
              )}
            </span>
          </div>
          {liveCurrent?.cancelAtPeriodEnd && liveCurrent.endDate && (
            <p className="mt-2 text-sm text-warning">
              Your plan is canceled but stays active until{" "}
              <strong>{new Date(liveCurrent.endDate).toLocaleDateString()}</strong> — you keep full
              access until then, and it won’t renew.
            </p>
          )}
        </div>
      )}

      {/* Payment under review */}
      {pendingPayment && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-warning/40 bg-warning/5 p-4 sm:px-5">
          <div className="flex items-center gap-2.5">
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-warning/15">
              <Spinner size="sm" className="text-warning" />
            </span>
            <div>
              <p className="text-sm font-semibold text-text-primary">
                Payment under review — {pendingPayment.plan.name}
              </p>
              <p className="text-xs text-text-secondary">
                We’ve received your {formatMoney(pendingPayment.amount, pendingPayment.currency)} payment.
                Your plan activates once an admin confirms it.
              </p>
            </div>
          </div>
          <Badge variant="warning">Pending</Badge>
        </div>
      )}

      {/* Billing-cycle toggle — pay monthly, or save with a longer cycle. */}
      {hasPaidPlan && (
        <div className="flex flex-wrap items-center gap-3">
          <span className="text-sm font-medium text-text-secondary">Billing cycle:</span>
          <div className="inline-flex rounded-xl border border-border bg-surface p-1">
            {CYCLES.map((c) => {
              // Best discount available at this cycle across paid plans (for the toggle hint).
              const bestSave = Math.max(
                0,
                ...plans.map((p) =>
                  studentIntervalPrice(p.price, c.value, p.quarterlyDiscountPct, p.yearlyDiscountPct).discountPct,
                ),
              );
              const active = selectedCycle === c.value;
              return (
                <button
                  key={c.value}
                  type="button"
                  disabled={locked}
                  onClick={() => setSelectedCycle(c.value)}
                  className={
                    "flex items-center gap-1.5 rounded-lg px-3.5 py-1.5 text-sm font-semibold transition disabled:cursor-not-allowed " +
                    (active ? "bg-primary text-white shadow-sm" : "text-text-secondary hover:text-text-primary") +
                    (locked && !active ? " opacity-40" : "")
                  }
                >
                  {c.label}
                  {bestSave > 0 && (
                    <span
                      className={
                        "rounded-full px-1.5 py-0.5 text-[10px] font-bold " +
                        (active ? "bg-white/20 text-white" : "bg-success/10 text-success")
                      }
                    >
                      -{bestSave}%
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Available plans — prominent cards */}
      {plans.length === 0 ? (
        <p className="text-sm text-text-secondary">No plans are available right now.</p>
      ) : (
        <div className={"grid items-stretch gap-6 " + gridCols}>
          {sortedPlans.map((p) => {
            const isFree = (p.price ?? 0) <= 0;
            const priced = studentIntervalPrice(
              p.price,
              selectedCycle,
              p.quarterlyDiscountPct,
              p.yearlyDiscountPct,
            );
            const isCurrentPlan = p.id === currentPlanId;
            // Already on exactly this plan+cycle? (Free ignores cycle.)
            const isExactCurrent = isFree
              ? isCurrentPlan
              : !!liveCurrent && liveCurrent.plan.id === p.id && liveCurrent.billingInterval === selectedCycle;
            const cycleLabel = CYCLES.find((c) => c.value === selectedCycle)?.label ?? "";
            const feats = planFeatures(p, elementary);
            const twoColFeatures = feats.length > 4;
            const PlanIcon = isFree ? Gift : Crown;

            return (
              <div
                key={p.id}
                className={
                  "relative flex h-full flex-col overflow-hidden rounded-2xl border p-6 shadow-sm transition-shadow hover:shadow-md sm:p-7 " +
                  (isCurrentPlan
                    ? "border-primary/50 bg-gradient-to-br from-primary/[0.07] to-transparent ring-1 ring-primary/25"
                    : "border-border bg-surface")
                }
              >
                {/* Current-plan corner ribbon */}
                {isCurrentPlan && (
                  <div className="absolute right-0 top-0 rounded-bl-xl bg-primary px-3 py-1 text-[10px] font-bold uppercase tracking-wider text-white">
                    Current plan
                  </div>
                )}

                {/* Icon badge */}
                <span
                  className={
                    "flex h-12 w-12 items-center justify-center rounded-full " +
                    (isFree ? "bg-success/10 text-success" : "bg-primary text-white")
                  }
                >
                  <PlanIcon className="h-6 w-6" />
                </span>

                {/* Name */}
                <h3 className="mt-5 text-xl font-bold text-text-primary">{p.name}</h3>

                {/* Price */}
                <div className="mt-1.5 flex items-baseline gap-1.5">
                  <span className="text-4xl font-extrabold text-primary">
                    {isFree ? `0 ${p.currency}` : formatMoney(priced.total, p.currency)}
                  </span>
                  <span className="text-sm font-medium text-text-secondary">
                    {billingIntervalLabel(selectedCycle)}
                  </span>
                </div>
                {!isFree && priced.discountPct > 0 && (
                  <p className="mt-1.5 flex flex-wrap items-center gap-2 text-xs">
                    <span className="text-text-muted line-through">
                      {formatMoney(priced.undiscounted, p.currency)}
                    </span>
                    <span className="rounded-full bg-success/10 px-2 py-0.5 font-semibold text-success">
                      Save {priced.discountPct}% ({formatMoney(priced.savings, p.currency)})
                    </span>
                  </p>
                )}
                {!isFree && selectedCycle !== "MONTHLY" && (
                  <p className="mt-0.5 text-xs text-text-muted">
                    {formatMoney(p.price, p.currency)}/mo billed {cycleLabel.toLowerCase()}
                  </p>
                )}
                {p.trialDays > 0 && !isExactCurrent && (
                  <p className="mt-1.5 text-xs font-semibold text-success">{p.trialDays}-day free trial</p>
                )}

                {/* Description */}
                {p.description && (
                  <p className="mt-4 text-sm leading-relaxed text-text-secondary">{p.description}</p>
                )}

                {/* Divider */}
                <div className="my-5 h-px bg-border" />

                {/* Features */}
                {feats.length > 0 && (
                  <ul className={"grid gap-x-5 gap-y-2.5 " + (twoColFeatures ? "sm:grid-cols-2" : "grid-cols-1")}>
                    {feats.map((f, i) => (
                      <li key={i} className="flex items-start gap-2 text-sm text-text-primary">
                        <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-success" />
                        <span>{f}</span>
                      </li>
                    ))}
                  </ul>
                )}

                {/* CTA */}
                <div className="mt-auto pt-6">
                  <Button
                    variant={isExactCurrent || !isFree ? "primary" : "outline"}
                    className="w-full gap-1.5"
                    disabled={isExactCurrent || locked}
                    isLoading={busyPlanId === p.id}
                    onClick={() => selectPlan(p, priced, selectedCycle)}
                  >
                    {isExactCurrent ? (
                      <>
                        Current plan <Check className="h-4 w-4" />
                      </>
                    ) : locked ? (
                      "Unavailable"
                    ) : (
                      "Choose plan"
                    )}
                  </Button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Committed-term notice — a paid plan runs its term, then reverts to Free. */}
      {onPaidTerm && (
        <div className="flex items-start gap-2.5 rounded-xl border border-border bg-background/50 px-4 py-3 text-sm text-text-secondary">
          <Lock className="mt-0.5 h-4 w-4 shrink-0 text-text-muted" />
          <span>
            You’re on <strong className="text-text-primary">{liveCurrent!.plan.name}</strong>
            {termEnds && (
              <>
                {" "}
                until <strong className="text-text-primary">{termEnds}</strong>
              </>
            )}
            . Your plan can’t be changed or canceled during this term — it will automatically return
            to the <strong className="text-text-primary">Free</strong> plan when it ends, and you can
            subscribe again then.
          </span>
        </div>
      )}

      {/* Trust bar */}
      <div className="grid grid-cols-2 gap-5 border-t border-border pt-6 sm:grid-cols-4">
        {[
          { icon: ShieldCheck, title: "Secure payments", sub: "100% secure & encrypted" },
          { icon: RefreshCw, title: "No auto-renewal", sub: "Reverts to Free after the term" },
          { icon: Lock, title: "Privacy first", sub: "Your data is safe" },
          { icon: Headphones, title: "Need help?", sub: "We’re here for you" },
        ].map((it) => (
          <div key={it.title} className="flex items-center gap-2.5">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-success/10 text-success">
              <it.icon className="h-4 w-4" />
            </span>
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold text-text-primary">{it.title}</p>
              <p className="truncate text-xs text-text-secondary">{it.sub}</p>
            </div>
          </div>
        ))}
      </div>

      {/* Payment modal (step 2) — opens when a paid plan is chosen. */}
      {payFor && (
        <PaymentModal
          plan={{
            id: payFor.plan.id,
            name: payFor.plan.name,
            currency: payFor.plan.currency,
            trialDays: payFor.plan.trialDays,
          }}
          interval={payFor.interval}
          amount={payFor.amount}
          onClose={() => setPayFor(null)}
          onSubmitted={() => {
            setPayFor(null);
            load();
          }}
        />
      )}
    </div>
  );
}
