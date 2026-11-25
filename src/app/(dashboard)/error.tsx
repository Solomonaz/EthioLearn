"use client";

import { ErrorScreen } from "@/components/error-screen";

/**
 * A page inside the app failed: shown inside the menu and top bar (when the
 * layout itself loaded), so the student can still go elsewhere.
 */
export default function DashboardError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return <ErrorScreen error={error} reset={reset} inline />;
}
