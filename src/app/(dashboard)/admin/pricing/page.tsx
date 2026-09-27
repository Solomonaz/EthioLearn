"use client";

import { useCallback, useEffect, useState } from "react";
import { useSession } from "next-auth/react";
import {
  CreditCard,
  Plus,
  Pencil,
  Trash2,
  Building2,
  GraduationCap,
  X,
  Save,
  XCircle,
} from "lucide-react";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { Badge } from "@/components/ui/badge";
import { toast } from "@/components/ui/sonner";
import {
  formatMoney,
  billingIntervalLabel,
  studentIntervalPrice,
  teacherCharge,
  validateTiers,
  type BillingInterval,
} from "@/lib/pricing";

// ── Types ──────────────────────────────────────────────────
interface Tier {
  id?: string;
  minStudents: number;
  maxStudents: number | null;
  price: number;
}
interface Plan {
  id: string;
  name: string;
  description: string | null;
  audience: "SCHOOL" | "STUDENT";
  pricingModel: "FLAT" | "PER_STUDENT" | "TIERED";
  price: number | null;
  currency: string;
  billingInterval: BillingInterval;
  trialDays: number;
  features: string[];
  isActive: boolean;
  sortOrder: number;
  allowAi: boolean;
  allowMultiplayer: boolean;
  allowRewards: boolean;
  allowLeaderboard: boolean;
  allowMathTools: boolean;
  quarterlyDiscountPct: number;
  yearlyDiscountPct: number;
  pricePerTeacher: number | null;
  teacherAiMonthlyLimit: number | null;
  tiers: Tier[];
  _count?: { subscriptions: number };
}

const INTERVAL_OPTIONS: BillingInterval[] = ["MONTHLY", "QUARTERLY", "SEMESTER", "YEARLY", "ONE_TIME"];

const selectClass =
  "w-full rounded-lg border border-border bg-surface px-3 py-2.5 text-text-primary outline-none transition-colors focus:border-primary focus:ring-1 focus:ring-primary disabled:cursor-not-allowed disabled:opacity-50";

// ── Editor form state ──────────────────────────────────────
interface TierRow {
  minStudents: string;
  maxStudents: string; // "" = unbounded
  price: string;
}
interface EditorState {
  id: string | null; // null = creating
  audience: "SCHOOL" | "STUDENT";
  name: string;
  description: string;
  pricingModel: "FLAT" | "PER_STUDENT" | "TIERED";
  price: string;
  currency: string;
  billingInterval: BillingInterval;
  trialDays: string;
  features: string;
  isActive: boolean;
  allowAi: boolean;
  allowMultiplayer: boolean;
  allowRewards: boolean;
  allowLeaderboard: boolean;
  allowMathTools: boolean;
  quarterlyDiscountPct: string;
  yearlyDiscountPct: string;
  // Secondary teachers (school plans). "" = teachers not charged / no cap.
  pricePerTeacher: string;
  teacherAiMonthlyLimit: string;
  tiers: TierRow[];
}

function blankEditor(audience: "SCHOOL" | "STUDENT"): EditorState {
  return {
    id: null,
    audience,
    name: "",
    description: "",
    pricingModel: audience === "STUDENT" ? "FLAT" : "PER_STUDENT",
    price: "",
    currency: "ETB",
    billingInterval: "MONTHLY",
    trialDays: "0",
    features: "",
    isActive: true,
    allowAi: true,
    allowMultiplayer: true,
    allowRewards: true,
    allowLeaderboard: true,
    allowMathTools: true,
    quarterlyDiscountPct: "0",
    yearlyDiscountPct: "0",
    pricePerTeacher: "",
    teacherAiMonthlyLimit: "",
    tiers: [{ minStudents: "1", maxStudents: "", price: "" }],
  };
}

function editorFromPlan(plan: Plan): EditorState {
  return {
    id: plan.id,
    audience: plan.audience,
    name: plan.name,
    description: plan.description ?? "",
    pricingModel: plan.pricingModel,
    price: plan.price !== null ? String(plan.price) : "",
    currency: plan.currency,
    billingInterval: plan.billingInterval,
    trialDays: String(plan.trialDays),
    features: plan.features.join(", "),
    isActive: plan.isActive,
    allowAi: plan.allowAi ?? true,
    allowMultiplayer: plan.allowMultiplayer ?? true,
    allowRewards: plan.allowRewards ?? true,
    allowLeaderboard: plan.allowLeaderboard ?? true,
    allowMathTools: plan.allowMathTools ?? true,
    quarterlyDiscountPct: String(plan.quarterlyDiscountPct ?? 0),
    yearlyDiscountPct: String(plan.yearlyDiscountPct ?? 0),
    pricePerTeacher: plan.pricePerTeacher != null ? String(plan.pricePerTeacher) : "",
    teacherAiMonthlyLimit: plan.teacherAiMonthlyLimit != null ? String(plan.teacherAiMonthlyLimit) : "",
    tiers:
      plan.tiers.length > 0
        ? plan.tiers.map((t) => ({
            minStudents: String(t.minStudents),
            maxStudents: t.maxStudents === null ? "" : String(t.maxStudents),
            price: String(t.price),
          }))
        : [{ minStudents: "1", maxStudents: "", price: "" }],
  };
}

export default function AdminPricingPage() {
  const { data: session } = useSession();
  const role = (session?.user as { role?: string } | undefined)?.role;

  const [plans, setPlans] = useState<Plan[]>([]);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [editor, setEditor] = useState<EditorState | null>(null);
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const fetchPlans = useCallback(async () => {
    setLoading(true);
    setFetchError(null);
    try {
      const res = await fetch("/api/admin/pricing/plans");
      if (!res.ok) throw new Error("Failed to load pricing plans");
      const data = await res.json();
      setPlans(data.plans ?? []);
    } catch (e) {
      setFetchError(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchPlans();
  }, [fetchPlans]);

  async function handleSave() {
    if (!editor) return;
    if (!editor.name.trim()) {
      toast.error("Plan name is required.");
      return;
    }

    const body: Record<string, unknown> = {
      name: editor.name.trim(),
      description: editor.description.trim() || null,
      audience: editor.audience,
      pricingModel: editor.pricingModel,
      currency: editor.currency.trim() || "ETB",
      billingInterval: editor.billingInterval,
      trialDays: Number(editor.trialDays) || 0,
      isActive: editor.isActive,
      allowAi: editor.allowAi,
      allowMultiplayer: editor.allowMultiplayer,
      allowRewards: editor.allowRewards,
      allowLeaderboard: editor.allowLeaderboard,
      allowMathTools: editor.allowMathTools,
      quarterlyDiscountPct: Number(editor.quarterlyDiscountPct) || 0,
      yearlyDiscountPct: Number(editor.yearlyDiscountPct) || 0,
      features: editor.features
        .split(",")
        .map((f) => f.trim())
        .filter(Boolean),
    };
    if (editor.audience === "SCHOOL") {
      // Blank stays blank — the API reads "" as "teachers not charged" / "no cap".
      body.pricePerTeacher = editor.pricePerTeacher.trim();
      body.teacherAiMonthlyLimit = editor.teacherAiMonthlyLimit.trim();
    }

    if (editor.pricingModel === "TIERED") {
      const tiers = editor.tiers.map((t) => ({
        minStudents: Number(t.minStudents),
        maxStudents: t.maxStudents.trim() === "" ? null : Number(t.maxStudents),
        price: Number(t.price),
      }));
      // Same rules the API enforces — catch them here so the admin sees the
      // problem against the bracket rows instead of as a failed save.
      const tierError = validateTiers(tiers);
      if (tierError) {
        toast.error(tierError);
        return;
      }
      body.tiers = tiers;
    } else {
      body.price = Number(editor.price);
    }

    setSaving(true);
    try {
      const url = editor.id ? `/api/admin/pricing/plans/${editor.id}` : "/api/admin/pricing/plans";
      const res = await fetch(url, {
        method: editor.id ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error ?? "Failed to save plan");
      }
      toast.success(editor.id ? "Plan updated." : "Plan created.");
      setEditor(null);
      await fetchPlans();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(plan: Plan) {
    if (!window.confirm(`Delete the plan "${plan.name}"? This cannot be undone.`)) return;
    setDeletingId(plan.id);
    try {
      const res = await fetch(`/api/admin/pricing/plans/${plan.id}`, { method: "DELETE" });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error ?? "Failed to delete plan");
      }
      toast.success("Plan deleted.");
      await fetchPlans();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setDeletingId(null);
    }
  }

  if (role && role !== "SUPER_ADMIN") {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <p className="text-text-secondary">Access denied. Super Admin only.</p>
      </div>
    );
  }

  const schoolPlans = plans.filter((p) => p.audience === "SCHOOL");
  const studentPlans = plans.filter((p) => p.audience === "STUDENT");

  return (
    <div className="mx-auto max-w-5xl space-y-6 p-4 sm:p-6">
      <div className="flex items-center gap-3">
        <div className="flex h-11 w-11 items-center justify-center rounded-lg bg-primary/10">
          <CreditCard className="h-6 w-6 text-primary" />
        </div>
        <div>
          <h1 className="text-2xl font-bold text-text-primary">Pricing Plans</h1>
          <p className="text-sm text-text-secondary">
            Configure the plans schools and students can be subscribed to.
          </p>
        </div>
      </div>

      {editor && (
        <PlanEditor
          editor={editor}
          setEditor={setEditor}
          onSave={handleSave}
          saving={saving}
        />
      )}

      {loading ? (
        <div className="flex items-center justify-center py-16">
          <Spinner size="lg" className="text-primary" />
        </div>
      ) : fetchError ? (
        <div className="flex flex-col items-center gap-3 py-12">
          <XCircle className="h-8 w-8 text-error" />
          <p className="text-sm text-text-secondary">{fetchError}</p>
          <Button variant="outline" size="sm" onClick={fetchPlans}>
            Retry
          </Button>
        </div>
      ) : (
        <>
          <PlanSection
            title="School Plans"
            subtitle="Priced by the number of students in the school."
            icon={<Building2 className="h-5 w-5 text-primary" />}
            plans={schoolPlans}
            onNew={() => setEditor(blankEditor("SCHOOL"))}
            onEdit={(p) => setEditor(editorFromPlan(p))}
            onDelete={handleDelete}
            deletingId={deletingId}
            disabled={!!editor}
          />
          <PlanSection
            title="Student Plans"
            subtitle="Flat plans for individual students."
            icon={<GraduationCap className="h-5 w-5 text-primary" />}
            plans={studentPlans}
            onNew={() => setEditor(blankEditor("STUDENT"))}
            onEdit={(p) => setEditor(editorFromPlan(p))}
            onDelete={handleDelete}
            deletingId={deletingId}
            disabled={!!editor}
          />
        </>
      )}
    </div>
  );
}

// ── Plan section (list of cards for one audience) ──────────
function PlanSection({
  title,
  subtitle,
  icon,
  plans,
  onNew,
  onEdit,
  onDelete,
  deletingId,
  disabled,
}: {
  title: string;
  subtitle: string;
  icon: React.ReactNode;
  plans: Plan[];
  onNew: () => void;
  onEdit: (p: Plan) => void;
  onDelete: (p: Plan) => void;
  deletingId: string | null;
  disabled: boolean;
}) {
  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            {icon}
            <div>
              <h2 className="font-semibold text-text-primary">{title}</h2>
              <p className="text-xs text-text-secondary">{subtitle}</p>
            </div>
          </div>
          <Button size="sm" onClick={onNew} disabled={disabled} className="gap-1.5">
            <Plus className="h-4 w-4" />
            New
          </Button>
        </div>
      </CardHeader>
      <CardContent className="p-0">
        {plans.length === 0 ? (
          <p className="px-6 py-8 text-center text-sm text-text-secondary">
            No plans yet. Click “New” to create one.
          </p>
        ) : (
          <div className="divide-y divide-border">
            {plans.map((plan) => (
              <div key={plan.id} className="flex items-start justify-between gap-4 px-6 py-4">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium text-text-primary">{plan.name}</span>
                    <Badge variant={plan.isActive ? "success" : "default"}>
                      {plan.isActive ? "Active" : "Inactive"}
                    </Badge>
                    {plan._count && plan._count.subscriptions > 0 && (
                      <span className="text-xs text-text-muted">
                        {plan._count.subscriptions} subscribed
                      </span>
                    )}
                  </div>
                  {plan.description && (
                    <p className="mt-0.5 text-sm text-text-secondary">{plan.description}</p>
                  )}
                  <p className="mt-1 text-sm text-text-primary">{priceSummary(plan)}</p>
                  {plan.audience === "SCHOOL" && (
                    <p className="mt-0.5 text-xs text-text-secondary">{teacherSummary(plan)}</p>
                  )}
                  {plan.audience === "STUDENT" &&
                    (plan.quarterlyDiscountPct > 0 || plan.yearlyDiscountPct > 0) && (
                      <p className="mt-0.5 text-xs text-text-secondary">
                        {plan.quarterlyDiscountPct > 0 && (
                          <>
                            3-month{" "}
                            <span className="font-semibold text-text-primary">
                              {formatMoney(
                                studentIntervalPrice(plan.price, "QUARTERLY", plan.quarterlyDiscountPct, plan.yearlyDiscountPct).total,
                                plan.currency,
                              )}
                            </span>{" "}
                            <span className="text-success">(−{plan.quarterlyDiscountPct}%)</span>
                          </>
                        )}
                        {plan.quarterlyDiscountPct > 0 && plan.yearlyDiscountPct > 0 && " · "}
                        {plan.yearlyDiscountPct > 0 && (
                          <>
                            Yearly{" "}
                            <span className="font-semibold text-text-primary">
                              {formatMoney(
                                studentIntervalPrice(plan.price, "YEARLY", plan.quarterlyDiscountPct, plan.yearlyDiscountPct).total,
                                plan.currency,
                              )}
                            </span>{" "}
                            <span className="text-success">(−{plan.yearlyDiscountPct}%)</span>
                          </>
                        )}
                      </p>
                    )}
                  {plan.audience === "STUDENT" && (
                    <div className="mt-1.5 flex flex-wrap gap-1.5 text-xs">
                      <span className={plan.allowAi ? "text-success" : "text-text-muted"}>
                        {plan.allowAi ? "✓" : "✗"} AI features
                      </span>
                      <span className={plan.allowMultiplayer ? "text-success" : "text-text-muted"}>
                        {plan.allowMultiplayer ? "✓" : "✗"} Battle mode
                      </span>
                      <span className={plan.allowRewards ? "text-success" : "text-text-muted"}>
                        {plan.allowRewards ? "✓" : "✗"} Rewards
                      </span>
                      <span className={plan.allowLeaderboard ? "text-success" : "text-text-muted"}>
                        {plan.allowLeaderboard ? "✓" : "✗"} Leaderboard
                      </span>
                      <span className={plan.allowMathTools ? "text-success" : "text-text-muted"}>
                        {plan.allowMathTools ? "✓" : "✗"} Graphing &amp; 3D Geometry
                      </span>
                    </div>
                  )}
                  {plan.pricingModel === "TIERED" && plan.tiers.length > 0 && (
                    <div className="mt-1.5 flex flex-wrap gap-1.5">
                      {plan.tiers.map((t, i) => (
                        <span
                          key={i}
                          className="rounded-md bg-border/40 px-2 py-0.5 text-xs text-text-secondary"
                        >
                          {t.minStudents}
                          {t.maxStudents === null ? "+" : `–${t.maxStudents}`}:{" "}
                          {formatMoney(t.price, plan.currency)}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  <button
                    onClick={() => onEdit(plan)}
                    disabled={disabled}
                    className="rounded-lg p-2 text-text-muted transition-colors hover:bg-primary/10 hover:text-primary disabled:opacity-50"
                    aria-label="Edit plan"
                  >
                    <Pencil className="h-4 w-4" />
                  </button>
                  <button
                    onClick={() => onDelete(plan)}
                    disabled={deletingId === plan.id || disabled}
                    className="rounded-lg p-2 text-text-muted transition-colors hover:bg-red-50 hover:text-red-500 disabled:opacity-50"
                    aria-label="Delete plan"
                  >
                    {deletingId === plan.id ? <Spinner size="sm" /> : <Trash2 className="h-4 w-4" />}
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function priceSummary(plan: Plan): string {
  const interval = billingIntervalLabel(plan.billingInterval);
  if (plan.pricingModel === "PER_STUDENT") {
    return `${formatMoney(plan.price, plan.currency)} per student${interval}`;
  }
  if (plan.pricingModel === "TIERED") {
    return `Tiered by student count${interval}`;
  }
  return `${formatMoney(plan.price, plan.currency)}${interval}`;
}

function teacherSummary(plan: Plan): string {
  const seats =
    plan.pricePerTeacher != null
      ? `Teachers: ${formatMoney(plan.pricePerTeacher, plan.currency)} each`
      : "Teachers: not charged";
  const ai =
    plan.teacherAiMonthlyLimit != null
      ? `${plan.teacherAiMonthlyLimit} AI credits per teacher per month`
      : "platform-default teacher AI credits";
  return `${seats} · ${ai}`;
}

// ── Plan editor form ───────────────────────────────────────
function PlanEditor({
  editor,
  setEditor,
  onSave,
  saving,
}: {
  editor: EditorState;
  setEditor: (e: EditorState | null) => void;
  onSave: () => void;
  saving: boolean;
}) {
  const isSchool = editor.audience === "SCHOOL";
  const set = (patch: Partial<EditorState>) => setEditor({ ...editor, ...patch });

  const setTier = (i: number, patch: Partial<TierRow>) =>
    set({ tiers: editor.tiers.map((t, idx) => (idx === i ? { ...t, ...patch } : t)) });
  const addTier = () =>
    set({ tiers: [...editor.tiers, { minStudents: "", maxStudents: "", price: "" }] });
  const removeTier = (i: number) => set({ tiers: editor.tiers.filter((_, idx) => idx !== i) });

  // Live bracket check, so gaps and open-ended-middle mistakes show up while
  // typing rather than on save. Blank rows are still being filled in — don't
  // nag about those.
  const tiersComplete =
    editor.pricingModel === "TIERED" &&
    editor.tiers.every((t) => t.minStudents.trim() !== "" && t.price.trim() !== "");
  const tierError = tiersComplete
    ? validateTiers(
        editor.tiers.map((t) => ({
          minStudents: Number(t.minStudents),
          maxStudents: t.maxStudents.trim() === "" ? null : Number(t.maxStudents),
          price: Number(t.price),
        }))
      )
    : null;

  return (
    <Card className="border-primary/40">
      <CardHeader>
        <div className="flex items-center justify-between">
          <h2 className="font-semibold text-text-primary">
            {editor.id ? "Edit" : "New"} {isSchool ? "School" : "Student"} Plan
          </h2>
          <button
            onClick={() => setEditor(null)}
            className="rounded-lg p-1.5 text-text-muted hover:bg-border/50 hover:text-text-primary"
            aria-label="Close editor"
          >
            <X className="h-5 w-5" />
          </button>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Plan Name">
            <Input value={editor.name} onChange={(e) => set({ name: e.target.value })} disabled={saving} placeholder="e.g. Premium" />
          </Field>
          <Field label="Currency">
            <Input value={editor.currency} onChange={(e) => set({ currency: e.target.value })} disabled={saving} />
          </Field>
        </div>

        <Field label="Description (optional)">
          <Input value={editor.description} onChange={(e) => set({ description: e.target.value })} disabled={saving} placeholder="Short summary shown to admins" />
        </Field>

        <div className="grid gap-4 sm:grid-cols-2">
          {isSchool ? (
            <Field label="Billing Interval">
              <select
                className={selectClass}
                value={editor.billingInterval}
                onChange={(e) => set({ billingInterval: e.target.value as BillingInterval })}
                disabled={saving}
              >
                {INTERVAL_OPTIONS.map((i) => (
                  <option key={i} value={i}>
                    {i.charAt(0) + i.slice(1).toLowerCase().replace("_", " ")}
                  </option>
                ))}
              </select>
            </Field>
          ) : (
            <Field label="Billing">
              <div className="rounded-lg border border-border bg-background/60 px-3 py-2.5 text-sm text-text-secondary">
                Priced monthly — students can also pay 3-monthly or yearly at the discounts below.
              </div>
            </Field>
          )}
          <Field label="Trial Days">
            <Input type="number" min={0} value={editor.trialDays} onChange={(e) => set({ trialDays: e.target.value })} disabled={saving} />
          </Field>
        </div>

        {/* Pricing model — only schools choose; students are always flat */}
        {isSchool && (
          <Field label="Pricing Model">
            <div className="flex gap-2">
              <Button
                type="button"
                size="sm"
                variant={editor.pricingModel === "PER_STUDENT" ? "primary" : "outline"}
                onClick={() => set({ pricingModel: "PER_STUDENT" })}
                disabled={saving}
              >
                Per student
              </Button>
              <Button
                type="button"
                size="sm"
                variant={editor.pricingModel === "TIERED" ? "primary" : "outline"}
                onClick={() => set({ pricingModel: "TIERED" })}
                disabled={saving}
              >
                Tiered brackets
              </Button>
            </div>
          </Field>
        )}

        {/* Price input for FLAT / PER_STUDENT */}
        {editor.pricingModel !== "TIERED" && (
          <Field
            label={
              editor.pricingModel === "PER_STUDENT"
                ? `Price per student (${editor.currency})`
                : isSchool
                  ? `Price (${editor.currency})`
                  : `Monthly price (${editor.currency})`
            }
          >
            <Input type="number" min={0} step="0.01" value={editor.price} onChange={(e) => set({ price: e.target.value })} disabled={saving} placeholder="0" />
          </Field>
        )}

        {/* Multi-cycle discounts + live preview — STUDENT plans only. */}
        {!isSchool && <CycleDiscounts editor={editor} set={set} saving={saving} />}

        {/* Tier editor for TIERED */}
        {editor.pricingModel === "TIERED" && (
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <label className="text-xs font-semibold uppercase text-text-muted">
                Student-count brackets
              </label>
              <Button type="button" size="sm" variant="ghost" onClick={addTier} disabled={saving} className="gap-1">
                <Plus className="h-3.5 w-3.5" />
                Add bracket
              </Button>
            </div>
            <div className="space-y-2">
              <div className="grid grid-cols-[1fr_1fr_1fr_auto] gap-2 px-1 text-xs font-semibold uppercase text-text-muted">
                <span>Min students</span>
                <span>Max students</span>
                <span>Price ({editor.currency})</span>
                <span />
              </div>
              {editor.tiers.map((t, i) => (
                <div key={i} className="grid grid-cols-[1fr_1fr_1fr_auto] items-center gap-2">
                  <Input type="number" min={0} value={t.minStudents} onChange={(e) => setTier(i, { minStudents: e.target.value })} disabled={saving} placeholder="1" />
                  <Input type="number" min={0} value={t.maxStudents} onChange={(e) => setTier(i, { maxStudents: e.target.value })} disabled={saving} placeholder="∞ (blank)" />
                  <Input type="number" min={0} step="0.01" value={t.price} onChange={(e) => setTier(i, { price: e.target.value })} disabled={saving} placeholder="0" />
                  <button
                    type="button"
                    onClick={() => removeTier(i)}
                    disabled={saving || editor.tiers.length <= 1}
                    className="rounded-lg p-2 text-text-muted transition-colors hover:bg-red-50 hover:text-red-500 disabled:opacity-40"
                    aria-label="Remove bracket"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              ))}
            </div>
            {tierError && (
              <p className="rounded-lg bg-red-50 px-3 py-2 text-xs font-medium text-red-600">
                {tierError}
              </p>
            )}
            <p className="text-xs text-text-muted">
              Brackets must cover every student count in one continuous run — no overlaps and
              no gaps, each starting where the previous one ends (e.g. 1–100, then 101). Leave
              “Max students” blank on the top bracket only, so a school of any size has a price.
            </p>
          </div>
        )}

        {isSchool && <TeacherTerms editor={editor} set={set} saving={saving} />}

        <Field label="Features (comma-separated, optional)">
          <Input value={editor.features} onChange={(e) => set({ features: e.target.value })} disabled={saving} placeholder="Unlimited quizzes, AI tutor, Priority support" />
        </Field>

        {/* Entitlements — what the plan unlocks. Only meaningful for STUDENT plans;
            school students always get full access regardless. */}
        {isSchool ? (
          <p className="rounded-lg bg-primary/5 px-3 py-2 text-xs text-text-secondary">
            School plans always include full access (AI features and battle mode) for all their students.
          </p>
        ) : (
          <Field label="Plan access">
            <div className="space-y-2">
              <label className="flex items-center gap-2 text-sm text-text-primary">
                <input
                  type="checkbox"
                  checked={editor.allowAi}
                  onChange={(e) => set({ allowAi: e.target.checked })}
                  disabled={saving}
                  className="h-4 w-4 rounded border-border text-primary focus:ring-primary"
                />
                AI features (AI tutor, AI videos, AI-generated quizzes)
              </label>
              <label className="flex items-center gap-2 text-sm text-text-primary">
                <input
                  type="checkbox"
                  checked={editor.allowMultiplayer}
                  onChange={(e) => set({ allowMultiplayer: e.target.checked })}
                  disabled={saving}
                  className="h-4 w-4 rounded border-border text-primary focus:ring-primary"
                />
                Battle mode (multiplayer games) — solo games are always allowed
              </label>
              <label className="flex items-center gap-2 text-sm text-text-primary">
                <input
                  type="checkbox"
                  checked={editor.allowRewards}
                  onChange={(e) => set({ allowRewards: e.target.checked })}
                  disabled={saving}
                  className="h-4 w-4 rounded border-border text-primary focus:ring-primary"
                />
                Rewards (earn &amp; redeem rewards)
              </label>
              <label className="flex items-center gap-2 text-sm text-text-primary">
                <input
                  type="checkbox"
                  checked={editor.allowLeaderboard}
                  onChange={(e) => set({ allowLeaderboard: e.target.checked })}
                  disabled={saving}
                  className="h-4 w-4 rounded border-border text-primary focus:ring-primary"
                />
                Leaderboard (rankings)
              </label>
              <label className="flex items-center gap-2 text-sm text-text-primary">
                <input
                  type="checkbox"
                  checked={editor.allowMathTools}
                  onChange={(e) => set({ allowMathTools: e.target.checked })}
                  disabled={saving}
                  className="h-4 w-4 rounded border-border text-primary focus:ring-primary"
                />
                Graphing &amp; 3D Geometry (graphing calculator + 3D geometry lab)
              </label>
            </div>
          </Field>
        )}

        <label className="flex items-center gap-2 text-sm text-text-primary">
          <input
            type="checkbox"
            checked={editor.isActive}
            onChange={(e) => set({ isActive: e.target.checked })}
            disabled={saving}
            className="h-4 w-4 rounded border-border text-primary focus:ring-primary"
          />
          Active (available for assignment)
        </label>

        <div className="flex gap-2 pt-2">
          <Button onClick={onSave} isLoading={saving} className="gap-1.5">
            <Save className="h-4 w-4" />
            {editor.id ? "Save changes" : "Create plan"}
          </Button>
          <Button variant="ghost" onClick={() => setEditor(null)} disabled={saving}>
            Cancel
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

// School-plan secondary-teacher terms: a price per teacher + AI allowance.
function TeacherTerms({
  editor,
  set,
  saving,
}: {
  editor: EditorState;
  set: (patch: Partial<EditorState>) => void;
  saving: boolean;
}) {
  const cur = editor.currency || "ETB";
  const rate = Number(editor.pricePerTeacher);
  // Worked example so the price is concrete: a school with 20 teachers.
  const example =
    editor.pricePerTeacher.trim() && Number.isFinite(rate) && rate >= 0
      ? teacherCharge({ pricingModel: "PER_STUDENT", pricePerTeacher: rate }, 20)
      : null;

  return (
    <div className="space-y-3 rounded-xl border border-border bg-background/40 p-3">
      <p className="text-xs font-semibold uppercase text-text-muted">Secondary teachers</p>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label={`Price per teacher (${cur})`}>
          <Input
            type="number"
            min={0}
            step="0.01"
            value={editor.pricePerTeacher}
            onChange={(e) => set({ pricePerTeacher: e.target.value })}
            disabled={saving}
            placeholder="Blank = teachers free"
          />
        </Field>
        <Field label="AI credits / teacher / month">
          <Input
            type="number"
            min={0}
            value={editor.teacherAiMonthlyLimit}
            onChange={(e) => set({ teacherAiMonthlyLimit: e.target.value })}
            disabled={saving}
            placeholder="Blank = platform default"
          />
        </Field>
      </div>
      <p className="text-xs text-text-muted">
        {example
          ? `Example: a school with 20 teachers pays ${formatMoney(example.amount, cur)} for teachers, ` +
            "on top of the student price."
          : "Leave the price blank to not charge for teachers."}{" "}
        Credits are weighted by cost: an assistant reply is 1, a workout set or merge 2, and an
        AI-written paper 1 per question. Blank uses the platform default (Admin → Settings);
        documents reused from the shared library never count.
      </p>
    </div>
  );
}

// Student-plan multi-cycle discount editor + live price preview.
function CycleDiscounts({
  editor,
  set,
  saving,
}: {
  editor: EditorState;
  set: (patch: Partial<EditorState>) => void;
  saving: boolean;
}) {
  const monthly = Number(editor.price) || 0;
  const q = Number(editor.quarterlyDiscountPct) || 0;
  const y = Number(editor.yearlyDiscountPct) || 0;
  const cur = editor.currency || "ETB";
  const rows: { label: string; interval: BillingInterval }[] = [
    { label: "Monthly", interval: "MONTHLY" },
    { label: "Every 3 months", interval: "QUARTERLY" },
    { label: "Yearly", interval: "YEARLY" },
  ];

  return (
    <div className="space-y-3 rounded-xl border border-border bg-background/40 p-3">
      <p className="text-xs font-semibold uppercase text-text-muted">Longer-cycle discounts</p>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="3-month discount (%)">
          <Input
            type="number"
            min={0}
            max={100}
            value={editor.quarterlyDiscountPct}
            onChange={(e) => set({ quarterlyDiscountPct: e.target.value })}
            disabled={saving}
            placeholder="0"
          />
        </Field>
        <Field label="Yearly discount (%)">
          <Input
            type="number"
            min={0}
            max={100}
            value={editor.yearlyDiscountPct}
            onChange={(e) => set({ yearlyDiscountPct: e.target.value })}
            disabled={saving}
            placeholder="0"
          />
        </Field>
      </div>
      <div className="space-y-1.5">
        <p className="text-xs font-semibold uppercase text-text-muted">What students pay</p>
        {rows.map((r) => {
          const p = studentIntervalPrice(monthly, r.interval, q, y);
          return (
            <div key={r.interval} className="flex items-center justify-between gap-2 text-sm">
              <span className="text-text-secondary">{r.label}</span>
              <span className="flex items-center gap-2">
                {p.discountPct > 0 && (
                  <span className="text-xs text-text-muted line-through">
                    {formatMoney(p.undiscounted, cur)}
                  </span>
                )}
                <span className="font-semibold text-text-primary">{formatMoney(p.total, cur)}</span>
                {p.discountPct > 0 && (
                  <span className="rounded bg-success/10 px-1.5 py-0.5 text-xs font-semibold text-success">
                    Save {p.discountPct}%
                  </span>
                )}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <label className="text-xs font-semibold uppercase text-text-muted">{label}</label>
      {children}
    </div>
  );
}
