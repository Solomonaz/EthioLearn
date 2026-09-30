import type { Metadata } from "next";
import { DashboardLayout } from "@/components/layout/dashboard-layout";
import { NO_INDEX } from "@/lib/site";

// Signed-in surfaces: nothing here belongs in search results.
export const metadata: Metadata = NO_INDEX;

export default function DashboardRouteLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <DashboardLayout>{children}</DashboardLayout>;
}
