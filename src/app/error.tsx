"use client";

import { ErrorScreen } from "@/components/error-screen";

/** A page failed to load: a friendly screen, never React's internal message. */
export default function Error({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return <ErrorScreen error={error} reset={reset} />;
}
