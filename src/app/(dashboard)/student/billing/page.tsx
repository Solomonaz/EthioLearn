"use client";

import { CreditCard, ShieldCheck } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { StudentBillingPanel } from "@/components/student/billing-panel";
import { useEntitlements } from "@/hooks/use-entitlements";

export default function StudentBillingPage() {
  const ent = useEntitlements();

  return (
    <div className="mx-auto max-w-5xl space-y-6 p-4 sm:p-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-primary/10">
          <CreditCard className="h-6 w-6 text-primary" />
        </div>
        <div>
          <h1 className="text-2xl font-bold text-text-primary">Subscription plans</h1>
          <p className="text-sm text-text-secondary">
            Choose the plan that empowers your learning.
          </p>
        </div>
      </div>

      {/* School-managed students don't self-manage a plan. */}
      {ent.isSchoolStudent ? (
        <Card>
          <CardContent className="flex items-start gap-3 py-6">
            <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-success" />
            <div>
              <p className="font-medium text-text-primary">Your plan is managed by your school</p>
              <p className="mt-1 text-sm text-text-secondary">
                You have full access to every feature — no action needed.
              </p>
            </div>
          </CardContent>
        </Card>
      ) : (
        <StudentBillingPanel />
      )}
    </div>
  );
}
