"use client";

import { useSession } from "next-auth/react";
import { SubscriptionPanel } from "@/components/admin/subscription-panel";

export default function SchoolAdminSubscriptionPage() {
  const { data: session } = useSession();
  const schoolId = (session?.user as { schoolId?: string } | undefined)?.schoolId;

  return (
    <div className="mx-auto max-w-4xl space-y-6 p-4 sm:p-6">
      <div>
        <h1 className="text-2xl font-bold text-text-primary">Subscription</h1>
        <p className="text-sm text-text-secondary">
          Your school&apos;s current plan and the plans available to you
        </p>
      </div>

      {schoolId ? (
        <SubscriptionPanel audience="SCHOOL" targetId={schoolId} readOnly />
      ) : (
        <p className="text-sm text-text-secondary">
          Your account isn&apos;t linked to a school yet.
        </p>
      )}
    </div>
  );
}
